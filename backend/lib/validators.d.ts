// Type declarations for validators.js -- provides strict types to TypeScript
// consumers while the implementation stays as plain JS for Node + Vitest.

export const YOUTUBE_HOST_REGEX: RegExp;

/** Returns an error message on failure, or null if valid. */
export function validateUrl(url: unknown): string | null;

export function validateItag(itag: unknown): string | null;

export function validatePlaylistType(type: unknown): string | null;

/** Parses "83", "1:23", or "0:01:23" into seconds. Returns null if invalid. */
export function parseTime(t: unknown): number | null;

export function validateTrim(start: unknown, end: unknown): string | null;

export function validateCaptionFormat(format: unknown): string | null;

export function validateLangCode(lang: unknown): string | null;

export function cleanUrl(url: string): string;

declare const _default: {
  YOUTUBE_HOST_REGEX: RegExp;
  validateUrl: typeof validateUrl;
  validateItag: typeof validateItag;
  validatePlaylistType: typeof validatePlaylistType;
  parseTime: typeof parseTime;
  validateTrim: typeof validateTrim;
  validateCaptionFormat: typeof validateCaptionFormat;
  validateLangCode: typeof validateLangCode;
  cleanUrl: typeof cleanUrl;
};

export default _default;
export = _default;
