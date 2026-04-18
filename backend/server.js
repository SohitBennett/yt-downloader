// Sentry must be initialized before any other imports for auto-instrumentation
// to hook into them. No-op when SENTRY_DSN is unset.
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  });
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const http = require('http');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { WebSocketServer } = require('ws');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');

// ---------------------------------------------------------------------------
// Prometheus metrics -- default Node process metrics + custom app metrics
// ---------------------------------------------------------------------------
const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry });

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests received, labeled by method, route, and status code.',
  labelNames: ['method', 'route', 'status'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by method, route, and status code.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

const downloadsTotal = new promClient.Counter({
  name: 'downloads_total',
  help: 'Total number of downloads, labeled by outcome.',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

const downloadsInProgress = new promClient.Gauge({
  name: 'downloads_in_progress',
  help: 'Number of downloads currently running.',
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Structured logger -- pretty-printed in dev, JSON in production
// ---------------------------------------------------------------------------
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

const app = express();
const PORT = process.env.PORT || 5001;

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

// ---------------------------------------------------------------------------
// Structured HTTP request logger (pino-http)
// ---------------------------------------------------------------------------
app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// HTTP metrics middleware -- record counts and durations per route
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id') || 'unknown';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, durationSec);
  });
  next();
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const infoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many info requests, please try again later.' }
});

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests, please try again later.' }
});

app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Downloads directory
// ---------------------------------------------------------------------------
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// Tracks filenames currently being downloaded so we don't serve incomplete
// files as "already done" on a resume attempt. Works for both local + S3.
const activeDownloads = new Set();

// ---------------------------------------------------------------------------
// Storage backend -- local disk (default) or S3-compatible object storage.
// Enabled when S3_BUCKET env var is set. Works with AWS S3, Cloudflare R2,
// MinIO, etc. (use S3_ENDPOINT for non-AWS providers).
// ---------------------------------------------------------------------------
const S3_BUCKET = process.env.S3_BUCKET || '';
const storageEnabled = !!S3_BUCKET;
let s3Client = null;

if (storageEnabled) {
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
  logger.info({ bucket: S3_BUCKET }, 'Storage backend: S3/R2');
} else {
  logger.info('Storage backend: local disk');
}

async function uploadToStorage(localPath, key) {
  if (!storageEnabled) return;
  const { Upload } = require('@aws-sdk/lib-storage');
  const fileStream = fs.createReadStream(localPath);
  const upload = new Upload({
    client: s3Client,
    params: { Bucket: S3_BUCKET, Key: key, Body: fileStream },
  });
  await upload.done();
}

async function getDownloadUrl(filename) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: filename,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3Client, cmd, { expiresIn: 3600 });
}

async function storageExists(filename) {
  if (!storageEnabled) {
    return fs.existsSync(path.join(DOWNLOAD_DIR, filename));
  }
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: filename }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory cache for video info (TTL = 10 min, max 100 entries)
// ---------------------------------------------------------------------------
const infoCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 100;

function getCachedInfo(key) {
  const entry = infoCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    infoCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedInfo(key, data) {
  if (infoCache.size >= CACHE_MAX) {
    // Evict the oldest entry (first key inserted)
    const oldestKey = infoCache.keys().next().value;
    infoCache.delete(oldestKey);
  }
  infoCache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
const YOUTUBE_HOST_REGEX = /^(www\.)?youtube\.com$|^youtu\.be$|^m\.youtube\.com$/;

function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return 'URL is required and must be a string.';
  }
  if (url.length > 500) {
    return 'URL must not exceed 500 characters.';
  }
  try {
    const parsed = new URL(url);
    if (!YOUTUBE_HOST_REGEX.test(parsed.hostname)) {
      return 'URL must be a valid YouTube domain (youtube.com, youtu.be, m.youtube.com).';
    }
  } catch {
    return 'URL is not a valid URL.';
  }
  return null;
}

function validateItag(itag) {
  if (!itag || !/^\d+$/.test(String(itag))) {
    return 'itag is required and must be a numeric string.';
  }
  return null;
}

function validatePlaylistType(type) {
  if (type !== 'audio' && type !== 'video') {
    return 'type must be "audio" or "video".';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Format conversion presets -- maps target extension to ffmpeg codec args.
// Audio targets strip video. Video targets re-encode (mp4/webm) or remux (mkv).
// ---------------------------------------------------------------------------
const CONVERSION_PRESETS = {
  // Audio
  mp3:  { kind: 'audio', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  m4a:  { kind: 'audio', args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  wav:  { kind: 'audio', args: ['-vn', '-c:a', 'pcm_s16le'] },
  ogg:  { kind: 'audio', args: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'] },
  flac: { kind: 'audio', args: ['-vn', '-c:a', 'flac'] },
  // Video
  mp4:  { kind: 'video', args: ['-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k'] },
  webm: { kind: 'video', args: ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus'] },
  mkv:  { kind: 'video', args: ['-c', 'copy'] },
};

function validateConvertTo(convertTo) {
  if (convertTo === undefined || convertTo === null || convertTo === '') return null;
  if (typeof convertTo !== 'string') return 'convertTo must be a string.';
  if (!CONVERSION_PRESETS[convertTo]) {
    return `convertTo must be one of: ${Object.keys(CONVERSION_PRESETS).join(', ')}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time parsing -- accepts "83", "1:23", "0:01:23" (returns seconds, or null).
// ---------------------------------------------------------------------------
function parseTime(t) {
  if (t === undefined || t === null || t === '') return null;
  const s = String(t).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return n >= 0 ? n : null;
  }
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every(p => /^\d+(\.\d+)?$/.test(p))) return null;
  let seconds;
  if (parts.length === 3) {
    seconds = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  } else {
    seconds = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return seconds >= 0 ? seconds : null;
}

// ---------------------------------------------------------------------------
// Caption (subtitle) helpers -- parse YouTube timedtext XML and emit SRT/VTT.
// ---------------------------------------------------------------------------
function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function parseTimedTextXML(xml) {
  const entries = [];
  const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const dur = parseFloat(match[2]);
    const text = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '')).trim();
    if (text) entries.push({ start, end: start + dur, text });
  }
  return entries;
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function formatTime(seconds, sep) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

function toSRT(entries) {
  return entries
    .map((e, i) => `${i + 1}\n${formatTime(e.start, ',')} --> ${formatTime(e.end, ',')}\n${e.text}\n`)
    .join('\n');
}

function toVTT(entries) {
  const lines = ['WEBVTT', ''];
  for (const e of entries) {
    lines.push(`${formatTime(e.start, '.')} --> ${formatTime(e.end, '.')}`);
    lines.push(e.text);
    lines.push('');
  }
  return lines.join('\n');
}

function extractCaptionTracks(info) {
  const tracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  return tracks.map(t => ({
    languageCode: t.languageCode,
    name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
    isAuto: t.kind === 'asr',
  }));
}

function validateCaptionFormat(format) {
  if (format !== 'srt' && format !== 'vtt') {
    return 'format must be "srt" or "vtt".';
  }
  return null;
}

function validateLangCode(lang) {
  if (!lang || typeof lang !== 'string' || !/^[a-zA-Z0-9-]{1,15}$/.test(lang)) {
    return 'lang must be a valid language code (e.g. "en", "es-419").';
  }
  return null;
}

function validateTrim(start, end) {
  const startProvided = start !== undefined && start !== '';
  const endProvided = end !== undefined && end !== '';
  if (!startProvided && !endProvided) return null;

  if (startProvided && parseTime(start) === null) {
    return 'start must be a number (seconds) or time format like 1:23 or 0:01:23.';
  }
  if (endProvided && parseTime(end) === null) {
    return 'end must be a number (seconds) or time format like 1:23 or 0:01:23.';
  }
  if (startProvided && endProvided) {
    const s = parseTime(start);
    const e = parseTime(end);
    if (e <= s) return 'end must be greater than start.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Post-process a downloaded file: optional trim (start/end seconds) and/or
// optional format conversion. Both operations run in a single ffmpeg pass when
// combined. Deletes the source file on success and returns the new file path.
// ---------------------------------------------------------------------------
async function processFile({ inputPath, targetExt, startSec, endSec, isAborted, signal }) {
  const trimRequested = startSec !== null || endSec !== null;
  const convertRequested = !!targetExt;
  if (!trimRequested && !convertRequested) return inputPath;

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outExt = targetExt || path.extname(inputPath).slice(1) || 'mp4';
  const suffix = trimRequested ? '_clip' : '';
  const outputPath = path.join(dir, `${base}${suffix}.${outExt}`);

  // Build ffmpeg args:
  //   trim flags BEFORE -i = fast seek (keyframe accurate, near-instant)
  //   when trimming with -c copy that's fine; when re-encoding it's also fine
  //   for our purposes.
  const trimArgs = [];
  if (startSec !== null) trimArgs.push('-ss', String(startSec));
  if (endSec !== null) trimArgs.push('-to', String(endSec));

  // If converting, use the preset codec args. Otherwise stream-copy (fast).
  const codecArgs = convertRequested
    ? CONVERSION_PRESETS[targetExt].args
    : ['-c', 'copy'];

  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y',
      ...trimArgs,
      '-i', inputPath,
      ...codecArgs,
      '-loglevel', 'error',
      outputPath,
    ]);
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg post-process exited with code ${code}`));
    });
    if ((isAborted && isAborted()) || signal?.aborted) ff.kill('SIGKILL');
    if (signal) {
      const onAbort = () => ff.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      ff.on('close', () => signal.removeEventListener('abort', onAbort));
    }
  });

  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
  return outputPath;
}

function cleanUrl(url) {
  return url.includes('&') ? url.split('&')[0] : url;
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile CAPTCHA -- protects high-value endpoints from scraping.
// No-op when TURNSTILE_SECRET_KEY is unset (graceful fallback).
// ---------------------------------------------------------------------------
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
const turnstileEnabled = !!TURNSTILE_SECRET;

async function verifyTurnstile(token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

function requireTurnstile(getToken) {
  return async (req, res, next) => {
    if (!turnstileEnabled) return next();
    const token = getToken(req);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
    const valid = await verifyTurnstile(token, ip);
    if (!valid) {
      return res.status(403).json({ error: 'CAPTCHA verification failed.' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Pick the best audio-only format that matches a video format's container,
// so ffmpeg can mux with `-c copy` (no re-encode).
// ---------------------------------------------------------------------------
function pickBestAudioForVideo(formats, videoFormat) {
  const audioOnly = formats.filter(f => f.hasAudio && !f.hasVideo);
  if (audioOnly.length === 0) return null;
  const matching = audioOnly.filter(f => f.container === videoFormat.container);
  const pool = matching.length > 0 ? matching : audioOnly;
  return pool.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
}

// ---------------------------------------------------------------------------
// Download video-only + audio-only streams in parallel and mux with ffmpeg.
// onProgress receives { phase, percent, downloadedMB, totalMB }.
// ---------------------------------------------------------------------------
async function downloadAndMerge({ url, videoFormat, audioFormat, outputPath, onProgress, isAborted, signal }) {
  const tempVideo = `${outputPath}.video.tmp`;
  const tempAudio = `${outputPath}.audio.tmp`;

  const videoSize = Number(videoFormat.contentLength) || 0;
  const audioSize = Number(audioFormat.contentLength) || 0;
  const totalSize = videoSize + audioSize;

  let videoBytes = 0;
  let audioBytes = 0;
  let throttleLast = 0;
  const downloadStartTime = Date.now();

  const reportDownloadProgress = () => {
    const now = Date.now();
    if (now - throttleLast < 500) return;
    throttleLast = now;
    const downloaded = videoBytes + audioBytes;
    const downloadedMB = (downloaded / (1024 * 1024)).toFixed(2);
    const totalMB = totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : 'unknown';
    const percent = totalSize
      ? Number(Math.min((downloaded / totalSize) * 95, 95).toFixed(1))
      : null;
    const elapsedSec = (now - downloadStartTime) / 1000;
    const speedBps = elapsedSec > 0 ? downloaded / elapsedSec : 0;
    const speedMBs = (speedBps / (1024 * 1024)).toFixed(2);
    const remainingBytes = totalSize - downloaded;
    const etaSec = speedBps > 0 && totalSize ? Math.ceil(remainingBytes / speedBps) : null;
    onProgress({ phase: 'downloading', percent, downloadedMB, totalMB, speedMBs, etaSec });
  };

  const cleanupTemps = () => {
    try { if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo); } catch {}
    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch {}
  };

  const downloadStream = (format, dest, onByte) => new Promise((resolve, reject) => {
    const stream = ytdl(url, { format });
    const file = fs.createWriteStream(dest);
    stream.on('data', (chunk) => {
      if (signal?.aborted) { stream.destroy(); return; }
      onByte(chunk.length);
    });
    stream.on('error', reject);
    file.on('error', reject);
    file.on('finish', resolve);
    if (signal) {
      const onAbort = () => { stream.destroy(new Error('Cancelled')); };
      signal.addEventListener('abort', onAbort, { once: true });
      file.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    stream.pipe(file);
  });

  try {
    await Promise.all([
      downloadStream(videoFormat, tempVideo, (n) => { videoBytes += n; reportDownloadProgress(); }),
      downloadStream(audioFormat, tempAudio, (n) => { audioBytes += n; reportDownloadProgress(); }),
    ]);
  } catch (err) {
    cleanupTemps();
    throw err;
  }

  if (signal?.aborted) {
    cleanupTemps();
    throw new Error('Cancelled');
  }

  // Merge phase — continue even if client disconnected so the file is ready
  // for a resume attempt.
  if (!isAborted()) {
    onProgress({
      phase: 'merging',
      percent: 95,
      downloadedMB: ((videoBytes + audioBytes) / (1024 * 1024)).toFixed(2),
      totalMB: totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : 'unknown',
    });
  }

  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y',
      '-i', tempVideo,
      '-i', tempAudio,
      '-c', 'copy',
      '-loglevel', 'error',
      outputPath,
    ]);
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    if (signal) {
      const onAbort = () => ff.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      ff.on('close', () => signal.removeEventListener('abort', onAbort));
    }
  });

  cleanupTemps();

  onProgress({
    phase: 'complete',
    percent: 100,
    downloadedMB: totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : '0',
    totalMB: totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : 'unknown',
  });
}

// ---------------------------------------------------------------------------
// Cleanup cron job -- delete local files older than 1 hour. Only runs in
// local mode; S3/R2 cleanup should be configured via bucket lifecycle rules.
// ---------------------------------------------------------------------------
cron.schedule('0 */1 * * * *', () => {
  if (storageEnabled) return;
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.ctimeMs > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        logger.debug({ file }, 'Cleanup: deleted old file');
      }
    });
  } catch (err) {
    logger.warn({ err }, 'Cleanup error');
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Prometheus metrics endpoint
// ---------------------------------------------------------------------------
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /info -- fetch video info and available formats
// ---------------------------------------------------------------------------
app.post('/info', infoLimiter, requireTurnstile(req => req.body?.turnstileToken), async (req, res) => {
  try {
    const { url } = req.body;
    const urlError = validateUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });

    const cleaned = cleanUrl(url);

    if (!ytdl.validateURL(cleaned)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Check cache first
    const cached = getCachedInfo(cleaned);
    if (cached) {
      return res.json(cached);
    }

    const info = await ytdl.getInfo(cleaned);
    const formatsRaw = info.formats;

    const allFormats = formatsRaw.map(format => ({
      itag: format.itag,
      mimeType: format.mimeType,
      container: format.container || 'unknown',
      qualityLabel: format.qualityLabel || 'audio only',
      bitrate: format.bitrate || format.audioBitrate,
      hasAudio: format.hasAudio,
      hasVideo: format.hasVideo,
      approxSizeMB: format.contentLength
        ? (Number(format.contentLength) / (1024 * 1024)).toFixed(2)
        : 'N/A',
      type: format.hasAudio && format.hasVideo
        ? 'video+audio'
        : format.hasVideo
          ? 'video only'
          : 'audio only'
    }));

    const sortedFormats = allFormats.sort((a, b) => {
      const aRes = parseInt(a.qualityLabel) || 0;
      const bRes = parseInt(b.qualityLabel) || 0;
      return bRes - aRes;
    });

    const thumbnails = (info.videoDetails.thumbnails || []).map(t => ({
      url: t.url,
      width: t.width,
      height: t.height,
    }));

    const responseData = {
      title: info.videoDetails.title,
      thumbnail: thumbnails[0]?.url || '',
      thumbnails,
      channel: info.videoDetails.author?.name || '',
      duration: Number(info.videoDetails.lengthSeconds) || 0,
      viewCount: info.videoDetails.viewCount || '0',
      uploadDate: info.videoDetails.uploadDate || info.videoDetails.publishDate || '',
      formats: sortedFormats,
      captions: extractCaptionTracks(info),
    };

    setCachedInfo(cleaned, responseData);
    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch info', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /download -- stream a single video or audio directly to the client
// ---------------------------------------------------------------------------
app.get('/download', downloadLimiter, async (req, res) => {
  try {
    const { url, itag } = req.query;

    const urlError = validateUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });

    const itagError = validateItag(itag);
    if (itagError) return res.status(400).json({ error: itagError });

    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const info = await ytdl.getInfo(url);
    const format = info.formats.find(f => String(f.itag) === String(itag));

    if (!format) {
      return res.status(404).json({ error: 'Format not found for the given itag' });
    }

    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${title}_${itag}.${format.container || 'mp4'}`;

    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    ytdl(url, { format }).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Download failed', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Download pipeline -- self-contained function used by both the BullMQ worker
// and (as fallback) direct SSE execution. Reports progress via onProgress().
// Returns { filename } on success or throws on error.
// ---------------------------------------------------------------------------
async function executeDownload({ url, itag, convertTo, startSec, endSec, trimRequested, onProgress, signal }) {
  const info = await ytdl.getInfo(url);
  const requestedFormat = info.formats.find(f => String(f.itag) === String(itag));
  if (!requestedFormat) throw new Error('Format not found for the given itag');

  const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const targetIsAudio = convertTo && CONVERSION_PRESETS[convertTo]?.kind === 'audio';

  // Smart routing: audio target + video itag → swap to best audio-only
  let format = requestedFormat;
  if (targetIsAudio && requestedFormat.hasVideo) {
    const audioOnly = info.formats.filter(f => f.hasAudio && !f.hasVideo);
    if (audioOnly.length > 0) {
      format = audioOnly.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    }
  }

  const isVideoOnly = format.hasVideo && !format.hasAudio;
  const baseExt = format.container || 'mp4';
  const needsConvert = convertTo && convertTo !== baseExt;

  // Post-process helper (trim + convert in one pass)
  const maybeProcess = async (filePath, currentExt) => {
    if (!needsConvert && !trimRequested) return path.basename(filePath);
    const phase = needsConvert ? 'converting' : 'trimming';
    onProgress({ type: 'progress', phase, percent: 97, downloadedMB: '0', totalMB: '0' });
    const finalPath = await processFile({
      inputPath: filePath,
      targetExt: needsConvert ? convertTo : null,
      startSec,
      endSec,
      isAborted: () => false,
      signal,
    });
    return path.basename(finalPath);
  };

  // Expected final filename (for activeDownloads tracking + instant resume)
  const baseName = isVideoOnly ? `${title}_${itag}_merged` : `${title}_${format.itag}`;
  const finalExt = convertTo || baseExt;
  const trimSuffix = trimRequested ? '_clip' : '';
  const expectedFilename = `${baseName}${trimSuffix}.${finalExt}`;

  activeDownloads.add(expectedFilename);

  // Upload the produced local file to storage (if enabled) and delete locally.
  const finalizeStorage = async (finalFilename) => {
    if (!storageEnabled) return finalFilename;
    const localPath = path.join(DOWNLOAD_DIR, finalFilename);
    if (signal?.aborted) {
      try { if (fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch {}
      throw new Error('Cancelled');
    }
    onProgress({ type: 'progress', phase: 'uploading', percent: 99, downloadedMB: '0', totalMB: '0' });
    await uploadToStorage(localPath, finalFilename);
    try { fs.unlinkSync(localPath); } catch {}
    return finalFilename;
  };

  try {
    // Branch 1: video-only → parallel download + ffmpeg merge
    if (isVideoOnly) {
      const audioFormat = pickBestAudioForVideo(info.formats, format);
      if (!audioFormat) throw new Error('No audio format available to merge.');

      const ext = format.container || 'mp4';
      const filePath = path.join(DOWNLOAD_DIR, `${title}_${itag}_merged.${ext}`);

      await downloadAndMerge({
        url,
        videoFormat: format,
        audioFormat,
        outputPath: filePath,
        isAborted: () => false,
        signal,
        onProgress: (data) => onProgress({ type: 'progress', ...data }),
      });

      const finalFilename = await maybeProcess(filePath, ext);
      return { filename: await finalizeStorage(finalFilename) };
    }

    // Branch 2: single stream (pre-muxed or audio-only)
    const contentLength = Number(format.contentLength) || 0;
    const ext = format.container || 'mp4';
    const filePath = path.join(DOWNLOAD_DIR, `${title}_${format.itag}.${ext}`);

    await new Promise((resolve, reject) => {
      const stream = ytdl(url, { format });
      const fileStream = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      let lastSent = 0;
      const startTime = Date.now();

      stream.on('data', (chunk) => {
        if (signal?.aborted) { stream.destroy(); return; }
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastSent >= 500) {
          lastSent = now;
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          const totalMB = contentLength ? (contentLength / (1024 * 1024)).toFixed(2) : 'unknown';
          const rawPercent = contentLength ? Math.min((downloadedBytes / contentLength) * 100, 100) : null;
          const percent = rawPercent !== null
            ? Number((convertTo ? Math.min(rawPercent * 0.95, 95) : rawPercent).toFixed(1))
            : null;
          const elapsedSec = (now - startTime) / 1000;
          const speedBps = elapsedSec > 0 ? downloadedBytes / elapsedSec : 0;
          const speedMBs = (speedBps / (1024 * 1024)).toFixed(2);
          const remainingBytes = contentLength - downloadedBytes;
          const etaSec = speedBps > 0 && contentLength ? Math.ceil(remainingBytes / speedBps) : null;
          onProgress({ type: 'progress', phase: 'downloading', percent, downloadedMB, totalMB, speedMBs, etaSec });
        }
      });

      stream.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', () => {
        if (signal?.aborted) reject(new Error('Cancelled'));
        else resolve();
      });
      if (signal) {
        const onAbort = () => { stream.destroy(new Error('Cancelled')); };
        signal.addEventListener('abort', onAbort, { once: true });
        fileStream.on('close', () => signal.removeEventListener('abort', onAbort));
      }
      stream.pipe(fileStream);
    });

    const finalFilename = await maybeProcess(filePath, ext);
    return { filename: await finalizeStorage(finalFilename) };
  } finally {
    activeDownloads.delete(expectedFilename);
  }
}

// ---------------------------------------------------------------------------
// BullMQ job queue -- offloads downloads to a worker with concurrency control.
// Falls back to direct execution if Redis is unavailable.
// ---------------------------------------------------------------------------
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

let downloadQueue = null;
let queueEvents = null;

// Maps BullMQ job IDs to AbortControllers so /download-ws can cancel running
// jobs. Only populated for jobs currently being processed in this process.
const activeControllers = new Map();

async function cancelJob(jobId) {
  const controller = activeControllers.get(String(jobId));
  if (controller) {
    controller.abort();
    return true;
  }
  if (downloadQueue) {
    try {
      const { Job } = require('bullmq');
      const job = await Job.fromId(downloadQueue, jobId);
      if (job) {
        await job.remove();
        return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

async function initQueue() {
  // Quick connectivity test using raw ioredis to avoid BullMQ's internal reconnect noise
  const IORedis = require('ioredis');
  const testClient = new IORedis({
    ...redisConnection,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  testClient.on('error', () => {}); // swallow connection noise

  try {
    await testClient.connect();
    await testClient.ping();
    await testClient.quit();
  } catch {
    testClient.disconnect();
    downloadQueue = null;
    queueEvents = null;
    logger.warn('Job queue disabled — Redis not available, using direct downloads');
    return;
  }

  // Connection verified — create the real queue, worker, and event listener
  downloadQueue = new Queue('downloads', { connection: redisConnection });
  queueEvents = new QueueEvents('downloads', { connection: redisConnection });

  new Worker('downloads', async (job) => {
    const controller = new AbortController();
    activeControllers.set(String(job.id), controller);
    downloadsInProgress.inc();
    try {
      const result = await executeDownload({
        ...job.data,
        signal: controller.signal,
        onProgress: (data) => job.updateProgress(data),
      });
      downloadsTotal.inc({ status: 'completed' });
      return result;
    } catch (err) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed';
      downloadsTotal.inc({ status });
      throw err;
    } finally {
      activeControllers.delete(String(job.id));
      downloadsInProgress.dec();
    }
  }, {
    connection: redisConnection,
    concurrency: 3,
  });

  logger.info({ concurrency: 3 }, 'Job queue enabled (Redis connected)');
}

initQueue();

// ---------------------------------------------------------------------------
// GET /download-progress -- SSE endpoint for download progress tracking.
// If Redis is available, creates a BullMQ job and polls progress.
// Otherwise falls back to executing the download directly.
// ---------------------------------------------------------------------------
app.get('/download-progress', downloadLimiter, async (req, res) => {
  const { url, itag, convertTo, start, end } = req.query;

  const urlError = validateUrl(url);
  if (urlError) return res.status(400).json({ error: urlError });

  const itagError = validateItag(itag);
  if (itagError) return res.status(400).json({ error: itagError });

  const convertError = validateConvertTo(convertTo);
  if (convertError) return res.status(400).json({ error: convertError });

  const trimError = validateTrim(start, end);
  if (trimError) return res.status(400).json({ error: trimError });

  const startSec = parseTime(start);
  const endSec = parseTime(end);
  const trimRequested = startSec !== null || endSec !== null;

  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  let closed = false;
  req.on('close', () => { closed = true; });

  // -----------------------------------------------------------------------
  // Instant resume: check if the expected file already exists on disk.
  // -----------------------------------------------------------------------
  try {
    const info = await ytdl.getInfo(url);
    const reqFmt = info.formats.find(f => String(f.itag) === String(itag));
    if (reqFmt) {
      const targetIsAudio = convertTo && CONVERSION_PRESETS[convertTo]?.kind === 'audio';
      let fmt = reqFmt;
      if (targetIsAudio && reqFmt.hasVideo) {
        const ao = info.formats.filter(f => f.hasAudio && !f.hasVideo);
        if (ao.length) fmt = ao.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
      }
      const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const isVO = fmt.hasVideo && !fmt.hasAudio;
      const bExt = fmt.container || 'mp4';
      const bName = isVO ? `${title}_${itag}_merged` : `${title}_${fmt.itag}`;
      const fExt = convertTo || bExt;
      const tSuffix = trimRequested ? '_clip' : '';
      const expectedFilename = `${bName}${tSuffix}.${fExt}`;

      if (!activeDownloads.has(expectedFilename) && await storageExists(expectedFilename)) {
        sendEvent({ type: 'complete', filename: expectedFilename });
        return res.end();
      }
    }
  } catch {
    // Continue to download if resume check fails
  }

  const jobParams = { url, itag, convertTo: convertTo || null, startSec, endSec, trimRequested };

  // -----------------------------------------------------------------------
  // Queue path: create a BullMQ job and poll its progress
  // -----------------------------------------------------------------------
  if (downloadQueue && queueEvents) {
    try {
      const job = await downloadQueue.add('download', jobParams, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
      });

      let lastProgress = null;
      const pollInterval = setInterval(async () => {
        if (closed) { clearInterval(pollInterval); return; }
        try {
          const { Job } = require('bullmq');
          const fresh = await Job.fromId(downloadQueue, job.id);
          if (!fresh) return;

          const progress = fresh.progress;
          if (progress && typeof progress === 'object' && progress.type) {
            const key = JSON.stringify(progress);
            if (key !== lastProgress) {
              lastProgress = key;
              sendEvent(progress);
            }
          }

          const state = await fresh.getState();
          if (state === 'completed') {
            clearInterval(pollInterval);
            sendEvent({ type: 'complete', filename: fresh.returnvalue?.filename });
            res.end();
          } else if (state === 'failed') {
            clearInterval(pollInterval);
            sendEvent({ type: 'error', message: fresh.failedReason || 'Download failed' });
            res.end();
          }
        } catch { /* ignore poll errors */ }
      }, 500);

      req.on('close', () => clearInterval(pollInterval));
      return;
    } catch {
      // Fall through to direct execution if job creation fails
    }
  }

  // -----------------------------------------------------------------------
  // Direct path (no Redis): execute download inline
  // -----------------------------------------------------------------------
  downloadsInProgress.inc();
  try {
    const result = await executeDownload({
      ...jobParams,
      onProgress: (data) => { if (!closed) sendEvent(data); },
    });
    downloadsTotal.inc({ status: 'completed' });
    if (!closed) {
      sendEvent({ type: 'complete', filename: result.filename });
      res.end();
    }
  } catch (err) {
    downloadsTotal.inc({ status: 'failed' });
    if (!closed) {
      sendEvent({ type: 'error', message: err.message });
      res.end();
    }
  } finally {
    downloadsInProgress.dec();
  }
});

// ---------------------------------------------------------------------------
// GET /download-file/:filename -- serve a downloaded file with Range support
// so browsers can resume interrupted downloads (HTTP 206 Partial Content).
// ---------------------------------------------------------------------------
app.get('/download-file/:filename', async (req, res) => {
  const { filename } = req.params;

  // Path traversal protection
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  // S3/R2: redirect to a signed URL (browser handles Range requests against S3)
  if (storageEnabled) {
    try {
      if (!(await storageExists(filename))) {
        return res.status(404).json({ error: 'File not found.' });
      }
      const signedUrl = await getDownloadUrl(filename);
      return res.redirect(302, signedUrl);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate download URL', details: err.message });
    }
  }

  const filePath = path.join(DOWNLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  res.header('Content-Disposition', `attachment; filename="${filename}"`);
  res.header('Accept-Ranges', 'bytes');

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      res.status(416).header('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).header('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    res.status(206);
    res.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.header('Content-Length', String(end - start + 1));
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.header('Content-Length', String(fileSize));
    fs.createReadStream(filePath).pipe(res);
  }
});

// ---------------------------------------------------------------------------
// GET /download-caption -- fetch a caption track and return as SRT or VTT
// ---------------------------------------------------------------------------
app.get('/download-caption', infoLimiter, async (req, res) => {
  try {
    const { url, lang, format } = req.query;

    const urlError = validateUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });

    const langError = validateLangCode(lang);
    if (langError) return res.status(400).json({ error: langError });

    const formatError = validateCaptionFormat(format);
    if (formatError) return res.status(400).json({ error: formatError });

    const cleaned = cleanUrl(url);
    if (!ytdl.validateURL(cleaned)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const info = await ytdl.getInfo(cleaned);
    const tracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track = tracks.find(t => t.languageCode === lang);

    if (!track || !track.baseUrl) {
      return res.status(404).json({ error: 'Caption track not found for that language.' });
    }

    const xmlRes = await fetch(track.baseUrl);
    if (!xmlRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch caption data from YouTube.' });
    }
    const xml = await xmlRes.text();
    const entries = parseTimedTextXML(xml);

    if (entries.length === 0) {
      return res.status(404).json({ error: 'Caption track is empty.' });
    }

    const body = format === 'srt' ? toSRT(entries) : toVTT(entries);
    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${title}_${lang}.${format}`;

    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download caption', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /download-thumbnail -- proxy a YouTube thumbnail and serve as download
// ---------------------------------------------------------------------------
const THUMBNAIL_QUALITIES = {
  maxres: 'maxresdefault',
  sd:     'sddefault',
  hq:     'hqdefault',
  mq:     'mqdefault',
  default: 'default',
};

app.get('/download-thumbnail', infoLimiter, async (req, res) => {
  try {
    const { url, quality } = req.query;

    const urlError = validateUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });

    const q = quality || 'maxres';
    if (!THUMBNAIL_QUALITIES[q]) {
      return res.status(400).json({ error: `quality must be one of: ${Object.keys(THUMBNAIL_QUALITIES).join(', ')}` });
    }

    const cleaned = cleanUrl(url);
    if (!ytdl.validateURL(cleaned)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const videoId = ytdl.getVideoID(cleaned);
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/${THUMBNAIL_QUALITIES[q]}.jpg`;

    const thumbRes = await fetch(thumbUrl);
    if (!thumbRes.ok) {
      return res.status(404).json({ error: 'Thumbnail not available at this quality.' });
    }

    const filename = `${videoId}_${q}.jpg`;
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', 'image/jpeg');

    const arrayBuffer = await thumbRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).json({ error: 'Failed to download thumbnail', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /playlist -- download an entire playlist
// ---------------------------------------------------------------------------
app.post('/playlist', async (req, res) => {
  try {
    const { url, type } = req.body;

    const urlError = validateUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });

    const typeError = validatePlaylistType(type);
    if (typeError) return res.status(400).json({ error: typeError });

    const playlist = await ytpl(url, { pages: Infinity });
    const downloads = [];

    for (const item of playlist.items) {
      const info = await ytdl.getInfo(item.url);
      const format = type === 'audio'
        ? ytdl.filterFormats(info.formats, 'audioonly')[0]
        : ytdl.filterFormats(info.formats, 'audioandvideo')[0];

      const title = item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const ext = format.container || (type === 'audio' ? 'mp3' : 'mp4');
      const filename = `${title}.${ext}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

      await new Promise((resolve, reject) => {
        ytdl(item.url, { format })
          .pipe(fs.createWriteStream(filePath))
          .on('finish', () => {
            downloads.push({ title: item.title, file: filename });
            resolve();
          })
          .on('error', reject);
      });
    }

    res.json({ message: 'Playlist download completed', downloads });
  } catch (err) {
    res.status(500).json({ error: 'Playlist download failed', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// WebSocket server -- /download-ws bidirectional endpoint with real cancel
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/download-ws' });

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const url = params.get('url');
  const itag = params.get('itag');
  const convertTo = params.get('convertTo') || '';
  const start = params.get('start') || '';
  const end = params.get('end') || '';

  const send = (data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  };

  // Validation
  const urlError = validateUrl(url);
  if (urlError) { send({ type: 'error', message: urlError }); ws.close(); return; }
  const itagError = validateItag(itag);
  if (itagError) { send({ type: 'error', message: itagError }); ws.close(); return; }
  const convertError = validateConvertTo(convertTo);
  if (convertError) { send({ type: 'error', message: convertError }); ws.close(); return; }
  const trimError = validateTrim(start, end);
  if (trimError) { send({ type: 'error', message: trimError }); ws.close(); return; }
  if (!ytdl.validateURL(url)) { send({ type: 'error', message: 'Invalid URL' }); ws.close(); return; }

  const startSec = parseTime(start);
  const endSec = parseTime(end);
  const trimRequested = startSec !== null || endSec !== null;

  // Instant resume check
  try {
    const info = await ytdl.getInfo(url);
    const reqFmt = info.formats.find(f => String(f.itag) === String(itag));
    if (reqFmt) {
      const targetIsAudio = convertTo && CONVERSION_PRESETS[convertTo]?.kind === 'audio';
      let fmt = reqFmt;
      if (targetIsAudio && reqFmt.hasVideo) {
        const ao = info.formats.filter(f => f.hasAudio && !f.hasVideo);
        if (ao.length) fmt = ao.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
      }
      const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const isVO = fmt.hasVideo && !fmt.hasAudio;
      const bExt = fmt.container || 'mp4';
      const bName = isVO ? `${title}_${itag}_merged` : `${title}_${fmt.itag}`;
      const fExt = convertTo || bExt;
      const tSuffix = trimRequested ? '_clip' : '';
      const expectedFilename = `${bName}${tSuffix}.${fExt}`;
      if (!activeDownloads.has(expectedFilename) && await storageExists(expectedFilename)) {
        send({ type: 'complete', filename: expectedFilename });
        ws.close();
        return;
      }
    }
  } catch { /* continue */ }

  const jobParams = { url, itag, convertTo: convertTo || null, startSec, endSec, trimRequested };

  // Queue path
  if (downloadQueue && queueEvents) {
    try {
      const job = await downloadQueue.add('download', jobParams, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
      });

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'cancel') {
            await cancelJob(job.id);
            send({ type: 'cancelled' });
            ws.close();
          }
        } catch { /* ignore */ }
      });

      let lastProgress = null;
      const pollInterval = setInterval(async () => {
        if (ws.readyState !== ws.OPEN) { clearInterval(pollInterval); return; }
        try {
          const { Job } = require('bullmq');
          const fresh = await Job.fromId(downloadQueue, job.id);
          if (!fresh) return;

          const progress = fresh.progress;
          if (progress && typeof progress === 'object' && progress.type) {
            const key = JSON.stringify(progress);
            if (key !== lastProgress) {
              lastProgress = key;
              send(progress);
            }
          }

          const state = await fresh.getState();
          if (state === 'completed') {
            clearInterval(pollInterval);
            send({ type: 'complete', filename: fresh.returnvalue?.filename });
            ws.close();
          } else if (state === 'failed') {
            clearInterval(pollInterval);
            send({ type: 'error', message: fresh.failedReason || 'Download failed' });
            ws.close();
          }
        } catch { /* ignore */ }
      }, 500);

      ws.on('close', () => clearInterval(pollInterval));
      return;
    } catch {
      // Fall through to direct mode
    }
  }

  // Direct path (no Redis)
  const controller = new AbortController();
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'cancel') {
        controller.abort();
        send({ type: 'cancelled' });
        ws.close();
      }
    } catch { /* ignore */ }
  });

  downloadsInProgress.inc();
  try {
    const result = await executeDownload({
      ...jobParams,
      signal: controller.signal,
      onProgress: (data) => send(data),
    });
    downloadsTotal.inc({ status: 'completed' });
    send({ type: 'complete', filename: result.filename });
  } catch (err) {
    const status = controller.signal.aborted ? 'cancelled' : 'failed';
    downloadsTotal.inc({ status });
    if (!controller.signal.aborted) {
      send({ type: 'error', message: err.message });
    }
  } finally {
    downloadsInProgress.dec();
    ws.close();
  }
});

// ---------------------------------------------------------------------------
// Sentry error handler -- must be registered AFTER all routes and middleware
// ---------------------------------------------------------------------------
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);
  logger.info(`WebSocket available at ws://localhost:${PORT}/download-ws`);
});
