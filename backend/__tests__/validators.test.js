import { describe, it, expect } from 'vitest';
import validators from '../lib/validators.js';

const {
  validateUrl,
  validateItag,
  validatePlaylistType,
  parseTime,
  validateTrim,
  validateCaptionFormat,
  validateLangCode,
  cleanUrl,
} = validators;

describe('validateUrl', () => {
  it('accepts valid youtube.com URL', () => {
    expect(validateUrl('https://www.youtube.com/watch?v=abc123')).toBeNull();
  });

  it('accepts youtu.be short URL', () => {
    expect(validateUrl('https://youtu.be/abc123')).toBeNull();
  });

  it('accepts m.youtube.com mobile URL', () => {
    expect(validateUrl('https://m.youtube.com/watch?v=abc')).toBeNull();
  });

  it('rejects non-YouTube domain', () => {
    expect(validateUrl('https://example.com/foo')).toMatch(/YouTube domain/);
  });

  it('rejects non-string input', () => {
    expect(validateUrl(null)).toMatch(/required/);
    expect(validateUrl(undefined)).toMatch(/required/);
    expect(validateUrl(123)).toMatch(/required/);
  });

  it('rejects URLs over 500 chars', () => {
    expect(validateUrl('https://youtube.com/watch?v=' + 'a'.repeat(500))).toMatch(/500 characters/);
  });

  it('rejects malformed URL', () => {
    expect(validateUrl('not-a-url')).toMatch(/not a valid URL/);
  });
});

describe('validateItag', () => {
  it('accepts numeric string', () => {
    expect(validateItag('137')).toBeNull();
    expect(validateItag('18')).toBeNull();
  });

  it('rejects non-numeric', () => {
    expect(validateItag('abc')).toMatch(/numeric/);
  });

  it('rejects empty or missing', () => {
    expect(validateItag('')).toMatch(/required/);
    expect(validateItag(undefined)).toMatch(/required/);
  });
});

describe('validatePlaylistType', () => {
  it('accepts "audio" and "video"', () => {
    expect(validatePlaylistType('audio')).toBeNull();
    expect(validatePlaylistType('video')).toBeNull();
  });

  it('rejects other values', () => {
    expect(validatePlaylistType('mixed')).toMatch(/audio.*video/);
  });
});

describe('parseTime', () => {
  it('parses raw seconds', () => {
    expect(parseTime('83')).toBe(83);
    expect(parseTime('0')).toBe(0);
    expect(parseTime('12.5')).toBe(12.5);
  });

  it('parses MM:SS', () => {
    expect(parseTime('1:23')).toBe(83);
    expect(parseTime('0:30')).toBe(30);
  });

  it('parses HH:MM:SS', () => {
    expect(parseTime('0:01:23')).toBe(83);
    expect(parseTime('1:00:00')).toBe(3600);
    expect(parseTime('1:30:45')).toBe(5445);
  });

  it('returns null for empty or invalid', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('1:2:3:4')).toBeNull();
  });
});

describe('validateTrim', () => {
  it('accepts empty (both optional)', () => {
    expect(validateTrim('', '')).toBeNull();
    expect(validateTrim(undefined, undefined)).toBeNull();
  });

  it('accepts valid start and end', () => {
    expect(validateTrim('0:30', '1:00')).toBeNull();
    expect(validateTrim('10', '20')).toBeNull();
  });

  it('rejects end <= start', () => {
    expect(validateTrim('1:00', '0:30')).toMatch(/greater than start/);
    expect(validateTrim('10', '10')).toMatch(/greater than start/);
  });

  it('rejects malformed times', () => {
    expect(validateTrim('bad', '1:00')).toMatch(/start must be/);
    expect(validateTrim('0:30', 'bad')).toMatch(/end must be/);
  });
});

describe('validateCaptionFormat', () => {
  it('accepts srt and vtt', () => {
    expect(validateCaptionFormat('srt')).toBeNull();
    expect(validateCaptionFormat('vtt')).toBeNull();
  });

  it('rejects other formats', () => {
    expect(validateCaptionFormat('ass')).toMatch(/srt.*vtt/);
  });
});

describe('validateLangCode', () => {
  it('accepts simple codes', () => {
    expect(validateLangCode('en')).toBeNull();
    expect(validateLangCode('es-419')).toBeNull();
    expect(validateLangCode('zh-Hant')).toBeNull();
  });

  it('rejects injection attempts', () => {
    expect(validateLangCode('../etc/passwd')).toMatch(/valid language code/);
    expect(validateLangCode('en;drop table')).toMatch(/valid language code/);
    expect(validateLangCode('')).toMatch(/valid language code/);
  });
});

describe('cleanUrl', () => {
  it('strips query params after first &', () => {
    expect(cleanUrl('https://youtu.be/abc?t=30&list=PL123')).toBe('https://youtu.be/abc?t=30');
  });

  it('returns URL unchanged when no &', () => {
    expect(cleanUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
  });
});
