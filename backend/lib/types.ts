// Shared API contract types for the YT downloader backend.
// These shapes are what the HTTP/WebSocket endpoints produce and consume.

// ---------------------------------------------------------------------------
// /info response
// ---------------------------------------------------------------------------
export type FormatKind = 'video+audio' | 'video only' | 'audio only';

export interface VideoFormat {
  itag: number | string;
  mimeType?: string;
  container: string;
  qualityLabel: string;
  bitrate?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  approxSizeMB: string;
  type: FormatKind;
}

export interface CaptionTrack {
  languageCode: string;
  name: string;
  isAuto: boolean;
}

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface InfoResponse {
  title: string;
  thumbnail: string;
  thumbnails: Thumbnail[];
  channel: string;
  duration: number;
  viewCount: string;
  uploadDate: string;
  formats: VideoFormat[];
  captions: CaptionTrack[];
}

// ---------------------------------------------------------------------------
// Progress events (sent over SSE and WebSocket)
// ---------------------------------------------------------------------------
export type DownloadPhase =
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'trimming'
  | 'uploading'
  | 'complete';

export interface ProgressEvent {
  type: 'progress';
  phase: DownloadPhase;
  percent: number | null;
  downloadedMB: string;
  totalMB: string;
  speedMBs?: string;
  etaSec?: number | null;
}

export interface CompleteEvent {
  type: 'complete';
  filename: string;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface CancelledEvent {
  type: 'cancelled';
}

export type DownloadEvent = ProgressEvent | CompleteEvent | ErrorEvent | CancelledEvent;

// ---------------------------------------------------------------------------
// Conversion presets
// ---------------------------------------------------------------------------
export type ConvertAudioTarget = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';
export type ConvertVideoTarget = 'mp4' | 'webm' | 'mkv';
export type ConvertTarget = ConvertAudioTarget | ConvertVideoTarget;

// ---------------------------------------------------------------------------
// Job parameters (passed between SSE/WS endpoint and BullMQ worker)
// ---------------------------------------------------------------------------
export interface DownloadJobParams {
  url: string;
  itag: string;
  convertTo: ConvertTarget | null;
  startSec: number | null;
  endSec: number | null;
  trimRequested: boolean;
}

// ---------------------------------------------------------------------------
// Client-initiated messages over WebSocket
// ---------------------------------------------------------------------------
export interface CancelRequest {
  type: 'cancel';
}

// ---------------------------------------------------------------------------
// History entry (shared between frontend and backend responses)
// ---------------------------------------------------------------------------
export type HistoryType = 'single' | 'playlist-video' | 'playlist-audio';

export interface HistoryEntry {
  title: string;
  url: string;
  type: HistoryType;
  timestamp: number;
}
