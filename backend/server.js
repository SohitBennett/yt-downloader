const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

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
// Simple request logger (morgan-style, no extra dependency)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
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
async function processFile({ inputPath, targetExt, startSec, endSec, isAborted }) {
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
    if (isAborted && isAborted()) ff.kill('SIGKILL');
  });

  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
  return outputPath;
}

function cleanUrl(url) {
  return url.includes('&') ? url.split('&')[0] : url;
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
async function downloadAndMerge({ url, videoFormat, audioFormat, outputPath, onProgress, isAborted }) {
  const tempVideo = `${outputPath}.video.tmp`;
  const tempAudio = `${outputPath}.audio.tmp`;

  const videoSize = Number(videoFormat.contentLength) || 0;
  const audioSize = Number(audioFormat.contentLength) || 0;
  const totalSize = videoSize + audioSize;

  let videoBytes = 0;
  let audioBytes = 0;
  let throttleLast = 0;

  const reportDownloadProgress = () => {
    const now = Date.now();
    if (now - throttleLast < 500) return;
    throttleLast = now;
    const downloaded = videoBytes + audioBytes;
    const downloadedMB = (downloaded / (1024 * 1024)).toFixed(2);
    const totalMB = totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : 'unknown';
    // Cap download phase at 95% so the merge phase has the last 5%.
    const percent = totalSize
      ? Number(Math.min((downloaded / totalSize) * 95, 95).toFixed(1))
      : null;
    onProgress({ phase: 'downloading', percent, downloadedMB, totalMB });
  };

  const cleanupTemps = () => {
    try { if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo); } catch {}
    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch {}
  };

  const downloadStream = (format, dest, onByte) => new Promise((resolve, reject) => {
    const stream = ytdl(url, { format });
    const file = fs.createWriteStream(dest);
    stream.on('data', (chunk) => {
      if (isAborted()) {
        stream.destroy();
        return;
      }
      onByte(chunk.length);
    });
    stream.on('error', reject);
    file.on('error', reject);
    file.on('finish', resolve);
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

  if (isAborted()) {
    cleanupTemps();
    return;
  }

  // Merge phase
  onProgress({
    phase: 'merging',
    percent: 95,
    downloadedMB: ((videoBytes + audioBytes) / (1024 * 1024)).toFixed(2),
    totalMB: totalSize ? (totalSize / (1024 * 1024)).toFixed(2) : 'unknown',
  });

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
    if (isAborted()) ff.kill('SIGKILL');
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
// Cleanup cron job -- delete files older than 1 hour
// ---------------------------------------------------------------------------
cron.schedule('0 */1 * * * *', () => {
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.ctimeMs > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`Cleanup: deleted ${file}`);
      }
    });
  } catch (err) {
    console.log(`Cleanup error: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// GET /info -- fetch video info and available formats
// ---------------------------------------------------------------------------
app.post('/info', infoLimiter, async (req, res) => {
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

    const responseData = {
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails?.[0]?.url || '',
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
// GET /download-progress -- SSE endpoint for download progress tracking
// ---------------------------------------------------------------------------
app.get('/download-progress', downloadLimiter, async (req, res) => {
  const { url, itag, convertTo, start, end } = req.query;

  const urlError = validateUrl(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  const itagError = validateItag(itag);
  if (itagError) {
    return res.status(400).json({ error: itagError });
  }

  const convertError = validateConvertTo(convertTo);
  if (convertError) {
    return res.status(400).json({ error: convertError });
  }

  const trimError = validateTrim(start, end);
  if (trimError) {
    return res.status(400).json({ error: trimError });
  }

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

  let aborted = false;
  let stream = null;

  req.on('close', () => {
    aborted = true;
    if (stream) {
      stream.destroy();
    }
  });

  // Helper to run optional trim + conversion phase after a download/merge.
  // Returns the final filename to serve.
  const maybeProcess = async (filePath, currentExt) => {
    const needsConvert = convertTo && convertTo !== currentExt;
    if (!needsConvert && !trimRequested) {
      return path.basename(filePath);
    }
    const phase = needsConvert ? 'converting' : 'trimming';
    sendEvent({
      type: 'progress',
      phase,
      percent: 97,
      downloadedMB: '0',
      totalMB: '0',
    });
    const finalPath = await processFile({
      inputPath: filePath,
      targetExt: needsConvert ? convertTo : null,
      startSec,
      endSec,
      isAborted: () => aborted,
    });
    return path.basename(finalPath);
  };

  try {
    const info = await ytdl.getInfo(url);
    const requestedFormat = info.formats.find(f => String(f.itag) === String(itag));

    if (!requestedFormat) {
      sendEvent({ type: 'error', message: 'Format not found for the given itag' });
      return res.end();
    }

    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const targetIsAudio = convertTo && CONVERSION_PRESETS[convertTo].kind === 'audio';

    // -----------------------------------------------------------------------
    // Smart routing: if user wants audio output but picked a video itag,
    // skip the video stream entirely and download best audio-only instead.
    // -----------------------------------------------------------------------
    let format = requestedFormat;
    if (targetIsAudio && requestedFormat.hasVideo) {
      const audioOnly = info.formats.filter(f => f.hasAudio && !f.hasVideo);
      if (audioOnly.length > 0) {
        format = audioOnly.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
      }
    }

    const isVideoOnly = format.hasVideo && !format.hasAudio;

    // -----------------------------------------------------------------------
    // Branch 1: video-only format -> download + audio + ffmpeg merge
    // -----------------------------------------------------------------------
    if (isVideoOnly) {
      const audioFormat = pickBestAudioForVideo(info.formats, format);
      if (!audioFormat) {
        sendEvent({ type: 'error', message: 'No audio format available to merge.' });
        return res.end();
      }

      const ext = format.container || 'mp4';
      const mergedFilename = `${title}_${itag}_merged.${ext}`;
      const filePath = path.join(DOWNLOAD_DIR, mergedFilename);

      try {
        await downloadAndMerge({
          url,
          videoFormat: format,
          audioFormat,
          outputPath: filePath,
          isAborted: () => aborted,
          onProgress: (data) => {
            if (aborted) return;
            sendEvent({ type: 'progress', ...data });
          },
        });

        if (aborted) return;
        const finalFilename = await maybeProcess(filePath, ext);
        if (aborted) return;
        sendEvent({ type: 'complete', filename: finalFilename });
        res.end();
      } catch (err) {
        if (!aborted) {
          sendEvent({ type: 'error', message: err.message });
          res.end();
        }
      }
      return;
    }

    // -----------------------------------------------------------------------
    // Branch 2: pre-muxed (video+audio) or audio-only -> single stream
    // -----------------------------------------------------------------------
    const contentLength = Number(format.contentLength) || 0;
    const ext = format.container || 'mp4';
    const filename = `${title}_${format.itag}.${ext}`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    stream = ytdl(url, { format });
    const fileStream = fs.createWriteStream(filePath);

    let downloadedBytes = 0;
    let lastSent = 0;
    const THROTTLE_MS = 500;

    stream.on('data', (chunk) => {
      if (aborted) return;
      downloadedBytes += chunk.length;

      const now = Date.now();
      if (now - lastSent >= THROTTLE_MS) {
        lastSent = now;
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
        const totalMB = contentLength
          ? (contentLength / (1024 * 1024)).toFixed(2)
          : 'unknown';
        // Cap at 95% if we'll convert afterwards
        const rawPercent = contentLength
          ? Math.min((downloadedBytes / contentLength) * 100, 100)
          : null;
        const percent = rawPercent !== null
          ? Number((convertTo ? Math.min(rawPercent * 0.95, 95) : rawPercent).toFixed(1))
          : null;

        sendEvent({ type: 'progress', phase: 'downloading', percent, downloadedMB, totalMB });
      }
    });

    stream.pipe(fileStream);

    fileStream.on('finish', async () => {
      if (aborted) return;
      try {
        const finalFilename = await maybeProcess(filePath, ext);
        if (aborted) return;
        sendEvent({ type: 'complete', filename: finalFilename });
        res.end();
      } catch (err) {
        if (!aborted) {
          sendEvent({ type: 'error', message: err.message });
          res.end();
        }
      }
    });

    stream.on('error', (err) => {
      if (aborted) return;
      sendEvent({ type: 'error', message: err.message });
      res.end();
    });

    fileStream.on('error', (err) => {
      if (aborted) return;
      sendEvent({ type: 'error', message: err.message });
      res.end();
    });
  } catch (err) {
    if (!aborted) {
      sendEvent({ type: 'error', message: err.message });
      res.end();
    }
  }
});

// ---------------------------------------------------------------------------
// GET /download-file/:filename -- serve a downloaded file from DOWNLOAD_DIR
// ---------------------------------------------------------------------------
app.get('/download-file/:filename', (req, res) => {
  const { filename } = req.params;

  // Path traversal protection
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(DOWNLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.header('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
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
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
