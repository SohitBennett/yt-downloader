// // yt-downloader-backend/server.js

// const express = require('express');
// const cors = require('cors');
// const ytdl = require('ytdl-core');
// const ytpl = require('ytpl');
// const fs = require('fs');
// const path = require('path');
// const cron = require('node-cron');

// const app = express();
// const PORT = process.env.PORT || 5001;

// app.use(cors());
// app.use(express.json());

// const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// // Cleanup job: delete files older than 1 hour
// cron.schedule('0 */1 * * * *', () => {
//   const files = fs.readdirSync(DOWNLOAD_DIR);
//   const now = Date.now();
//   files.forEach(file => {
//     const filePath = path.join(DOWNLOAD_DIR, file);
//     const stats = fs.statSync(filePath);
//     if (now - stats.ctimeMs > 60 * 60 * 1000) fs.unlinkSync(filePath);
//   });
// });

// // Get video info & formats
// app.post('/info', async (req, res) => {
//   try {
//     const { url } = req.body;
//     const cleanUrl = url.includes('&') ? url.split('&')[0] : url;
//     if (!ytdl.validateURL(cleanUrl)) return res.status(400).json({ error: 'Invalid URL' });
//     console.log(cleanUrl)
//     const info = await ytdl.getInfo(cleanUrl);
//     const formats = ytdl.filterFormats(info.formats, 'audioandvideo');
//     const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
//     res.json({ title: info.videoDetails.title, formats, audioFormats });
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to fetch info', details: err.message });
//   }
// });

// // Download single video (video or audio)
// app.get('/download', async (req, res) => {
//   try {
//     const { url, itag } = req.query;
//     if (!ytdl.validateURL(url)) return res.status(400).json({ error: 'Invalid URL' });

//     const info = await ytdl.getInfo(url);
//     const format = ytdl.chooseFormat(info.formats, { quality: itag });
//     const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
//     const filename = `${title}_${itag}.${format.container || 'mp4'}`;

//     res.header('Content-Disposition', `attachment; filename="${filename}"`);
//     ytdl(url, { format }).pipe(res);
//   } catch (err) {
//     res.status(500).json({ error: 'Download failed', details: err.message });
//   }
// });

// // Download full playlist (audio/video)
// app.post('/playlist', async (req, res) => {
//   try {
//     const { url, type } = req.body; // type = 'audio' or 'video'
//     const playlist = await ytpl(url, { pages: Infinity });
//     const downloads = [];

//     for (const item of playlist.items) {
//       const info = await ytdl.getInfo(item.url);
//       const format = type === 'audio'
//         ? ytdl.filterFormats(info.formats, 'audioonly')[0]
//         : ytdl.filterFormats(info.formats, 'audioandvideo')[0];

//       const title = item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
//       const ext = format.container || (type === 'audio' ? 'mp3' : 'mp4');
//       const filename = `${title}.${ext}`;
//       const filePath = path.join(DOWNLOAD_DIR, filename);

//       await new Promise((resolve, reject) => {
//         ytdl(item.url, { format })
//           .pipe(fs.createWriteStream(filePath))
//           .on('finish', () => {
//             downloads.push({ title: item.title, file: filename });
//             resolve();
//           })
//           .on('error', reject);
//       });
//     }

//     res.json({ message: 'Playlist download completed', downloads });
//   } catch (err) {
//     res.status(500).json({ error: 'Playlist download failed', details: err.message });
//   }
// });


// app.listen(PORT, () => {
//   console.log(`🚀 Server running on http://localhost:${PORT}`);
// });



// yt-downloader-backend/server.js

const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core'); // ✅ PATCHED
const ytpl = require('ytpl');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// 🧹 Cleanup old files hourly
cron.schedule('0 */1 * * * *', () => {
  const files = fs.readdirSync(DOWNLOAD_DIR);
  const now = Date.now();
  files.forEach(file => {
    const filePath = path.join(DOWNLOAD_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.ctimeMs > 60 * 60 * 1000) fs.unlinkSync(filePath);
  });
});

// // 📦 Get video info
// app.post('/info', async (req, res) => {
//   try {
//     const { url } = req.body;
//     const cleanUrl = url.includes('&') ? url.split('&')[0] : url;

//     if (!ytdl.validateURL(cleanUrl)) {
//       return res.status(400).json({ error: 'Invalid YouTube URL' });
//     }

//     const info = await ytdl.getInfo(cleanUrl);
//     const formats = ytdl.filterFormats(info.formats, 'audioandvideo');
//     const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

//     res.json({ title: info.videoDetails.title, formats, audioFormats });
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to fetch info', details: err.message });
//   }
// });

// 📦 Get video info (yt-dlp -F style)
app.post('/info', async (req, res) => {
  try {
    const { url } = req.body;
    const cleanUrl = url.includes('&') ? url.split('&')[0] : url;

    if (!ytdl.validateURL(cleanUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const info = await ytdl.getInfo(cleanUrl);
    const formatsRaw = info.formats;

    // Process formats like yt-dlp -F
    const allFormats = formatsRaw.map(format => ({
      itag: format.itag,
      mimeType: format.mimeType,
      container: format.container || 'unknown',
      qualityLabel: format.qualityLabel || 'audio only',
      bitrate: format.bitrate || format.audioBitrate,
      hasAudio: format.hasAudio,
      hasVideo: format.hasVideo,
      approxSizeMB: format.contentLength ? (Number(format.contentLength) / (1024 * 1024)).toFixed(2) : 'N/A',
      type: format.hasAudio && format.hasVideo
        ? 'video+audio'
        : format.hasVideo
        ? 'video only'
        : 'audio only'
    }));

    // Sort formats by resolution and type
    const sortedFormats = allFormats.sort((a, b) => {
      const aRes = parseInt(a.qualityLabel) || 0;
      const bRes = parseInt(b.qualityLabel) || 0;
      return bRes - aRes;
    });

    res.json({
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails?.[0]?.url || '',
      formats: sortedFormats
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch info', details: err.message });
  }
});


// // 📥 Download a single video or audio
// app.get('/download', async (req, res) => {
//   try {
//     const { url, itag } = req.query;
//     if (!ytdl.validateURL(url)) return res.status(400).json({ error: 'Invalid URL' });

//     const info = await ytdl.getInfo(url);
//     // const format = ytdl.chooseFormat(info.formats, { quality: itag });
//     if (!format || !format.contentLength) {
//       return res.status(400).json({ error: 'Invalid or unsupported format selected' });
//     }

//     const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
//     const filename = `${title}_${itag}.${format.container || 'mp4'}`;

//     res.header('Content-Disposition', `attachment; filename="${filename}"`);
//     ytdl(url, { format }).pipe(res);
//   } catch (err) {
//     res.status(500).json({ error: 'Download failed', details: err.message });
//   }
// });


// 📥 Download a single video or audio
app.get('/download', async (req, res) => {
  try {
    const { url, itag } = req.query;

    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const info = await ytdl.getInfo(url);
    const formats = info.formats;
    const format = formats.find(f => String(f.itag) === String(itag));

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


// 🎵 Download an entire playlist
app.post('/playlist', async (req, res) => {
  try {
    const { url, type } = req.body;
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
