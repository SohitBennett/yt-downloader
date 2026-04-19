// Pure validation + parsing helpers. Extracted so they're testable without
// booting the full Express server.
//
// Type declarations live in validators.d.ts alongside this file — that gives
// strict typing for consumers while keeping the source runnable by Node
// without a TypeScript loader.

const YOUTUBE_HOST_REGEX = /^(www\.)?youtube\.com$|^youtu\.be$|^m\.youtube\.com$/;

function validateUrl(url) {
  if (!url || typeof url !== 'string') return 'URL is required and must be a string.';
  if (url.length > 500) return 'URL must not exceed 500 characters.';
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
  if (type !== 'audio' && type !== 'video') return 'type must be "audio" or "video".';
  return null;
}

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
    if (parseTime(end) <= parseTime(start)) return 'end must be greater than start.';
  }
  return null;
}

function validateCaptionFormat(format) {
  if (format !== 'srt' && format !== 'vtt') return 'format must be "srt" or "vtt".';
  return null;
}

function validateLangCode(lang) {
  if (!lang || typeof lang !== 'string' || !/^[a-zA-Z0-9-]{1,15}$/.test(lang)) {
    return 'lang must be a valid language code (e.g. "en", "es-419").';
  }
  return null;
}

function cleanUrl(url) {
  return url.includes('&') ? url.split('&')[0] : url;
}

module.exports = {
  YOUTUBE_HOST_REGEX,
  validateUrl,
  validateItag,
  validatePlaylistType,
  parseTime,
  validateTrim,
  validateCaptionFormat,
  validateLangCode,
  cleanUrl,
};
