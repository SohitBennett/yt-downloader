// Pure validation + parsing helpers built on Zod. Extracted so they're
// testable without booting the full Express server.
//
// Type declarations live in validators.d.ts alongside this file -- that gives
// strict typing for consumers while keeping the source runnable by Node
// without a TypeScript loader.

const { z } = require('zod');

const YOUTUBE_HOST_REGEX = /^(www\.)?youtube\.com$|^youtu\.be$|^m\.youtube\.com$/;

// ---------------------------------------------------------------------------
// Zod schemas -- the actual validation rules. Exported for consumers that
// want to use `.safeParse()` directly.
// ---------------------------------------------------------------------------
const urlSchema = z
  .string({ message: 'URL is required and must be a string.' })
  .max(500, 'URL must not exceed 500 characters.')
  .superRefine((val, ctx) => {
    let parsed;
    try {
      parsed = new URL(val);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL is not a valid URL.' });
      return;
    }
    if (!YOUTUBE_HOST_REGEX.test(parsed.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'URL must be a valid YouTube domain (youtube.com, youtu.be, m.youtube.com).',
      });
    }
  });

const itagSchema = z
  .string({ message: 'itag is required and must be a numeric string.' })
  .regex(/^\d+$/, 'itag is required and must be a numeric string.');

const playlistTypeSchema = z.enum(['audio', 'video'], {
  message: 'type must be "audio" or "video".',
});

const captionFormatSchema = z.enum(['srt', 'vtt'], {
  message: 'format must be "srt" or "vtt".',
});

const langCodeSchema = z
  .string({ message: 'lang must be a valid language code (e.g. "en", "es-419").' })
  .regex(/^[a-zA-Z0-9-]{1,15}$/, 'lang must be a valid language code (e.g. "en", "es-419").');

/**
 * Parses time strings like "83", "1:23", or "0:01:23" into seconds.
 * Returns null (never throws) when the input is empty OR unparseable --
 * keeping the old function's lenient contract.
 */
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
// Public helpers -- each returns an error message string on failure, or null
// on success. Thin wrappers around the schemas above.
// ---------------------------------------------------------------------------
function firstError(result, fallback) {
  if (result.success) return null;
  return result.error.issues[0]?.message || fallback;
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') return 'URL is required and must be a string.';
  return firstError(urlSchema.safeParse(url), 'Invalid URL.');
}

function validateItag(itag) {
  if (!itag) return 'itag is required and must be a numeric string.';
  return firstError(itagSchema.safeParse(String(itag)), 'Invalid itag.');
}

function validatePlaylistType(type) {
  return firstError(playlistTypeSchema.safeParse(type), 'Invalid playlist type.');
}

function validateCaptionFormat(format) {
  return firstError(captionFormatSchema.safeParse(format), 'Invalid caption format.');
}

function validateLangCode(lang) {
  if (!lang) return 'lang must be a valid language code (e.g. "en", "es-419").';
  return firstError(langCodeSchema.safeParse(lang), 'Invalid language code.');
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

function cleanUrl(url) {
  return url.includes('&') ? url.split('&')[0] : url;
}

module.exports = {
  YOUTUBE_HOST_REGEX,
  // Zod schemas (for future TS consumers)
  urlSchema,
  itagSchema,
  playlistTypeSchema,
  captionFormatSchema,
  langCodeSchema,
  // Public helpers (string | null return -- server.js uses these)
  validateUrl,
  validateItag,
  validatePlaylistType,
  validateCaptionFormat,
  validateLangCode,
  validateTrim,
  parseTime,
  cleanUrl,
};
