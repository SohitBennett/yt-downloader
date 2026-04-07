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
      formats: sortedFormats
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
  const { url, itag } = req.query;

  const urlError = validateUrl(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  const itagError = validateItag(itag);
  if (itagError) {
    return res.status(400).json({ error: itagError });
  }

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

  try {
    const info = await ytdl.getInfo(url);
    const format = info.formats.find(f => String(f.itag) === String(itag));

    if (!format) {
      sendEvent({ type: 'error', message: 'Format not found for the given itag' });
      return res.end();
    }

    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
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
      const filename = `${title}_${itag}_merged.${ext}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

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
        sendEvent({ type: 'complete', filename });
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
    const filename = `${title}_${itag}.${ext}`;
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
        const percent = contentLength
          ? Math.min(((downloadedBytes / contentLength) * 100).toFixed(1), 100)
          : null;

        sendEvent({ type: 'progress', phase: 'downloading', percent, downloadedMB, totalMB });
      }
    });

    stream.pipe(fileStream);

    fileStream.on('finish', () => {
      if (aborted) return;
      sendEvent({ type: 'complete', filename });
      res.end();
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
