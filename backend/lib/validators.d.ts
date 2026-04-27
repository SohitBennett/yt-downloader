// Type declarations for validators.js -- provides strict types to TypeScript
// consumers while the implementation stays as plain JS for Node + Vitest.

import type { ZodType } from 'zod';

export const YOUTUBE_HOST_REGEX: RegExp;

// ---------------------------------------------------------------------------
// Zod schemas -- consumers that want rich validation output can use these
// directly via .safeParse(...) or .parse(...).
// ---------------------------------------------------------------------------
export const urlSchema: ZodType<string>;
export const itagSchema: ZodType<string>;
export const playlistTypeSchema: ZodType<'audio' | 'video'>;
export const captionFormatSchema: ZodType<'srt' | 'vtt'>;
export const langCodeSchema: ZodType<string>;

// ---------------------------------------------------------------------------
// Public helpers -- return an error message on failure, null on success.
// ---------------------------------------------------------------------------
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
  urlSchema: typeof urlSchema;
  itagSchema: typeof itagSchema;
  playlistTypeSchema: typeof playlistTypeSchema;
  captionFormatSchema: typeof captionFormatSchema;
  langCodeSchema: typeof langCodeSchema;
  validateUrl: typeof validateUrl;
  validateItag: typeof validateItag;
  validatePlaylistType: typeof validatePlaylistType;
  validateCaptionFormat: typeof validateCaptionFormat;
  validateLangCode: typeof validateLangCode;
  validateTrim: typeof validateTrim;
  parseTime: typeof parseTime;
  cleanUrl: typeof cleanUrl;
};

export default _default;
export = _default;
