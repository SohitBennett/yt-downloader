'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import axios from 'axios';
import BASE_URL from '@/config';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import { Video, Search, Volume2, ScrollText, Captions, CheckCircle2, XCircle, Loader2, Clock, ImageDown, History } from 'lucide-react';
import { toast } from 'sonner';

interface RecentSearch {
  url: string;
  title: string;
  timestamp: number;
}

interface HistoryEntry {
  title: string;
  url: string;
  type: 'single' | 'playlist-video' | 'playlist-audio';
  timestamp: number;
}

interface VideoFormat {
  itag: string;
  mimeType: string;
  container: string;
  qualityLabel: string;
  bitrate: number;
  hasAudio: boolean;
  hasVideo: boolean;
  approxSizeMB: string;
  type: string;
}

interface CaptionTrack {
  languageCode: string;
  name: string;
  isAuto: boolean;
}

interface BatchItem {
  url: string;
  title: string;
  status: 'pending' | 'fetching' | 'downloading' | 'complete' | 'error';
  progress: number;
  error?: string;
}

interface ProgressState {
  percent: number;
  downloadedMB: string;
  totalMB: string;
  phase: 'downloading' | 'merging' | 'converting' | 'trimming' | 'complete';
  speedMBs?: string;
  etaSec?: number | null;
}

export default function Main() {
  const [url, setUrl] = useState('');
  const [formats, setFormats] = useState<VideoFormat[]>([]);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [type, setType] = useState<'video' | 'audio'>('video');
  const [selectedItag, setSelectedItag] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [duration, setDuration] = useState<number>(0);
  const [viewCount, setViewCount] = useState<string>('');
  const [uploadDate, setUploadDate] = useState<string>('');
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [convertTo, setConvertTo] = useState<string>('');
  const [trimStart, setTrimStart] = useState<string>('');
  const [trimEnd, setTrimEnd] = useState<string>('');
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const [isBatch, setIsBatch] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchQuality, setBatchQuality] = useState<'best-video' | 'best-audio'>('best-video');
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const router = useRouter();

  const isYouTubeUrl = (text: string) =>
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/.test(text.trim());

  const formatEta = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const formatDuration = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatViews = (count: string) => {
    const n = parseInt(count, 10);
    if (isNaN(n)) return count;
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  // Load history and recent searches from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('downloads');
      if (stored) setHistory(JSON.parse(stored));
    } catch { /* ignore */ }
    try {
      const stored = localStorage.getItem('recentSearches');
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // Paste detection: auto-fill URL when pasting a YouTube URL outside inputs
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

      const text = e.clipboardData?.getData('text')?.trim();
      if (!text || !isYouTubeUrl(text)) return;

      if (isBatch) {
        setBatchUrls(prev => prev ? `${prev}\n${text}` : text);
      } else {
        setUrl(text);
      }
      toast.success('YouTube URL detected!');
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isBatch]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

      // Ctrl+Enter / Cmd+Enter → start download or batch
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isBatch && !batchRunning) {
          document.getElementById('batch-start-btn')?.click();
        } else if (!isBatch && !isPlaylist && selectedItag && !downloadLoading) {
          document.getElementById('download-btn')?.click();
        }
        return;
      }

      // Escape → clear format selection
      if (e.key === 'Escape' && !inInput) {
        setSelectedItag('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isBatch, isPlaylist, selectedItag, downloadLoading, batchRunning]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide overlay when leaving the card itself, not child elements
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const text = e.dataTransfer.getData('text')?.trim();
    if (!text) return;

    // Support dropping multiple URLs (one per line)
    const lines = text.split('\n').map(l => l.trim()).filter(l => isYouTubeUrl(l));
    if (lines.length === 0) {
      toast.error('No YouTube URL detected');
      return;
    }

    if (isBatch) {
      setBatchUrls(prev => prev ? `${prev}\n${lines.join('\n')}` : lines.join('\n'));
    } else {
      setUrl(lines[0]);
    }
    toast.success(`${lines.length} URL${lines.length > 1 ? 's' : ''} dropped!`);
  }, [isBatch]);

  const saveRecentSearch = (searchUrl: string, title: string) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.url !== searchUrl);
      const updated = [{ url: searchUrl, title, timestamp: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
      return updated;
    });
  };

  const saveToHistory = (entry: HistoryEntry) => {
    const updated = [entry, ...history];
    setHistory(updated);
    localStorage.setItem('downloads', JSON.stringify(updated));
  };

  const fetchInfo = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${BASE_URL}/info`, { url });
      const allFormats = res.data.formats;
      const seen = new Set();
      const uniqueFormats = allFormats.filter((f: VideoFormat) => {
        const key = `${f.itag}-${f.container}-${f.qualityLabel}-${f.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setFormats(uniqueFormats);
      setVideoTitle(res.data.title || '');
      setThumbnailUrl(res.data.thumbnail || '');
      setChannel(res.data.channel || '');
      setDuration(res.data.duration || 0);
      setViewCount(res.data.viewCount || '0');
      setUploadDate(res.data.uploadDate || '');
      setCaptions(res.data.captions || []);
      saveRecentSearch(url, res.data.title || url);
    } catch {
      toast.error('Failed to fetch video info');
    }
    setLoading(false);
  };

  const handleDownload = () => {
    if (!selectedItag) {
      toast.warning('Select a quality first');
      return;
    }

    setDownloadLoading(true);
    setProgress({ percent: 0, downloadedMB: '0', totalMB: '0', phase: 'downloading' });

    const entry: HistoryEntry = {
      title: videoTitle || url,
      url,
      type: 'single',
      timestamp: Date.now(),
    };
    saveToHistory(entry);
    toast.success('Download started!');

    const params = new URLSearchParams({ url, itag: selectedItag });
    if (convertTo) params.set('convertTo', convertTo);
    if (trimStart) params.set('start', trimStart);
    if (trimEnd) params.set('end', trimEnd);
    const eventSource = new EventSource(`${BASE_URL}/download-progress?${params.toString()}`);

    let completed = false;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress({
            percent: data.percent ?? 0,
            downloadedMB: data.downloadedMB || '0',
            totalMB: data.totalMB || '0',
            phase: data.phase || 'downloading',
            speedMBs: data.speedMBs || undefined,
            etaSec: data.etaSec ?? null,
          });
        } else if (data.type === 'complete') {
          completed = true;
          if (data.filename) {
            window.open(`${BASE_URL}/download-file/${data.filename}`);
          }
          eventSource.close();
          setDownloadLoading(false);
          setProgress(null);
          toast.success('Download complete!');
        } else if (data.type === 'error') {
          completed = true;
          eventSource.close();
          setDownloadLoading(false);
          setProgress(null);
          toast.error(data.message || 'Download failed');
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      if (completed) return;
      eventSource.close();
      toast.error('Download failed');
      setDownloadLoading(false);
      setProgress(null);
    };
  };

  const updateBatchItem = (index: number, updates: Partial<BatchItem>) => {
    setBatchQueue(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const pickBestFormat = (formats: VideoFormat[]) => {
    if (batchQuality === 'best-audio') {
      return formats
        .filter(f => f.type === 'audio only' && f.approxSizeMB !== 'N/A')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    }
    // best-video: prefer highest-res video-only (auto-merge), fallback to pre-muxed
    return (
      formats
        .filter(f => f.type === 'video only' && f.approxSizeMB !== 'N/A')
        .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))[0]
      || formats
        .filter(f => f.type === 'video+audio' && f.approxSizeMB !== 'N/A')
        .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))[0]
    );
  };

  const startBatch = async () => {
    const urls = batchUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) {
      toast.warning('Paste at least one URL');
      return;
    }

    const initialQueue: BatchItem[] = urls.map(u => ({
      url: u, title: u, status: 'pending', progress: 0,
    }));
    setBatchQueue(initialQueue);
    setBatchRunning(true);

    for (let i = 0; i < urls.length; i++) {
      updateBatchItem(i, { status: 'fetching' });

      try {
        // Fetch info
        const res = await axios.post(`${BASE_URL}/info`, { url: urls[i] });
        const title = res.data.title || urls[i];
        updateBatchItem(i, { title });

        // Auto-pick best format
        const bestFormat = pickBestFormat(res.data.formats || []);
        if (!bestFormat) {
          updateBatchItem(i, { status: 'error', error: 'No suitable format found' });
          continue;
        }

        // Start SSE download
        updateBatchItem(i, { status: 'downloading' });

        await new Promise<void>((resolve) => {
          const params = new URLSearchParams({ url: urls[i], itag: String(bestFormat.itag) });
          if (convertTo) params.set('convertTo', convertTo);
          if (trimStart) params.set('start', trimStart);
          if (trimEnd) params.set('end', trimEnd);

          const eventSource = new EventSource(`${BASE_URL}/download-progress?${params.toString()}`);
          let done = false;

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'progress') {
                updateBatchItem(i, { progress: data.percent ?? 0 });
              } else if (data.type === 'complete') {
                done = true;
                updateBatchItem(i, { status: 'complete', progress: 100 });
                if (data.filename) {
                  window.open(`${BASE_URL}/download-file/${data.filename}`);
                }
                eventSource.close();
                resolve();
              } else if (data.type === 'error') {
                done = true;
                updateBatchItem(i, { status: 'error', error: data.message });
                eventSource.close();
                resolve();
              }
            } catch { /* ignore */ }
          };

          eventSource.onerror = () => {
            if (done) return;
            updateBatchItem(i, { status: 'error', error: 'Connection failed' });
            eventSource.close();
            resolve();
          };
        });

        // Save to history
        saveToHistory({ title, url: urls[i], type: 'single', timestamp: Date.now() });
      } catch {
        updateBatchItem(i, { status: 'error', error: 'Failed to fetch video info' });
      }
    }

    setBatchRunning(false);
    toast.success('Batch complete!');
  };

  const handlePlaylist = async () => {
    setLoading(true);
    try {
      await axios.post(`${BASE_URL}/playlist`, {
        url,
        type,
      });

      const entry: HistoryEntry = {
        title: url,
        url,
        type: type === 'video' ? 'playlist-video' : 'playlist-audio',
        timestamp: Date.now(),
      };
      saveToHistory(entry);

      toast.success('Playlist downloaded successfully!');
    } catch {
      toast.error('Failed to download playlist');
    }
    setLoading(false);
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen p-6">
        <Card
          className="max-w-xl mx-auto p-4 space-y-4 relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drop zone overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
              <p className="text-primary font-semibold text-lg">Drop YouTube URL here</p>
            </div>
          )}
          <CardContent>
            <h2 className="text-2xl font-bold mb-8 text-center">
              <Video className="inline h-6 w-6 mr-1" /> YouTube Video Downloader
            </h2>
            {/* Mode toggles */}
            <div className="flex items-center justify-between py-2 gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm">Playlist</span>
                <Switch checked={isPlaylist} onCheckedChange={(v) => { setIsPlaylist(v); if (v) setIsBatch(false); }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Batch</span>
                <Switch checked={isBatch} onCheckedChange={(v) => { setIsBatch(v); if (v) setIsPlaylist(false); }} />
              </div>
            </div>

            {/* ---------- Batch mode ---------- */}
            {isBatch ? (
              <div className="space-y-4">
                <textarea
                  placeholder={"Paste YouTube URLs, one per line:\nhttps://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=..."}
                  value={batchUrls}
                  onChange={(e) => setBatchUrls(e.target.value)}
                  rows={5}
                  className="w-full rounded-md border border-input bg-card text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />

                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium">Quality:</label>
                  <select
                    value={batchQuality}
                    onChange={(e) => setBatchQuality(e.target.value as 'best-video' | 'best-audio')}
                    className="flex-1 h-9 rounded-md border border-input bg-card text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="best-video">Best Video (auto-merge)</option>
                    <option value="best-audio">Best Audio</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium">Convert to:</label>
                  <select
                    value={convertTo}
                    onChange={(e) => setConvertTo(e.target.value)}
                    className="flex-1 h-9 rounded-md border border-input bg-card text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Original (no conversion)</option>
                    <optgroup label="Audio">
                      <option value="mp3">MP3</option>
                      <option value="m4a">M4A</option>
                      <option value="wav">WAV</option>
                      <option value="ogg">OGG</option>
                      <option value="flac">FLAC</option>
                    </optgroup>
                    <optgroup label="Video">
                      <option value="mp4">MP4</option>
                      <option value="webm">WebM</option>
                      <option value="mkv">MKV (remux)</option>
                    </optgroup>
                  </select>
                </div>

                <Button
                  id="batch-start-btn"
                  onClick={startBatch}
                  disabled={batchRunning}
                  className="w-full"
                >
                  {batchRunning ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
                  ) : (
                    <>Start Batch Download <kbd className="ml-2 text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded font-mono">Ctrl+Enter</kbd></>
                  )}
                </Button>

                {/* Queue list */}
                {batchQueue.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {batchQueue.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm border rounded-md p-2">
                        {item.status === 'complete' && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                        {item.status === 'error' && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                        {item.status === 'downloading' && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                        {item.status === 'fetching' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                        {item.status === 'pending' && <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}

                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.status === 'downloading' && (
                            <div className="w-full bg-muted rounded h-1.5 mt-1 overflow-hidden">
                              <div
                                className="bg-primary h-1.5 rounded transition-all duration-300"
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                          )}
                          {item.status === 'error' && (
                            <p className="text-xs text-red-500 truncate">{item.error}</p>
                          )}
                        </div>

                        <span className="text-xs text-muted-foreground shrink-0">
                          {item.status === 'downloading' ? `${item.progress}%` : item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            ) : isPlaylist ? (
              /* ---------- Playlist mode ---------- */
              <div>
                <Input
                  placeholder="Paste YouTube playlist URL"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <div className="flex gap-4 mt-4">
                  <Button onClick={() => setType('video')} variant={type === 'video' ? 'default' : 'outline'}>
                    Video
                  </Button>
                  <Button onClick={() => setType('audio')} variant={type === 'audio' ? 'default' : 'outline'}>
                    Audio
                  </Button>
                  <Button disabled={loading} onClick={handlePlaylist}>
                    {loading ? 'Downloading...' : 'Download Playlist'}
                  </Button>
                </div>
              </div>
            ) : (
              /* ---------- Single video mode ---------- */
              <>
                <Input
                  placeholder="Paste YouTube video URL"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && url && !loading) fetchInfo(); }}
                />

                {/* Recent searches */}
                {recentSearches.length > 0 && !url && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <History className="h-3 w-3" /> Recent
                    </p>
                    {recentSearches.slice(0, 5).map((s) => (
                      <button
                        key={s.url}
                        onClick={() => setUrl(s.url)}
                        className="block w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-accent truncate text-foreground/80"
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                )}

                <Button onClick={fetchInfo} disabled={loading} className="mt-4">
                  {loading ? 'Loading formats...' : <><Search className="inline h-4 w-4 mr-1" /> Formats <kbd className="ml-2 text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">Enter</kbd></>}
                </Button>

                {/* Video preview card */}
                {videoTitle && thumbnailUrl && (
                  <Card className="mt-4 overflow-hidden">
                    <CardContent className="p-3 flex gap-4 items-center">
                      <Image
                        src={thumbnailUrl}
                        alt={videoTitle}
                        width={160}
                        height={90}
                        unoptimized
                        className="rounded object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm leading-snug">{videoTitle}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          {channel && <span>{channel}</span>}
                          {duration > 0 && <span>{formatDuration(duration)}</span>}
                          {viewCount && viewCount !== '0' && <span>{formatViews(viewCount)} views</span>}
                          {uploadDate && <span>{new Date(uploadDate).toLocaleDateString()}</span>}
                        </div>
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          <ImageDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {(['maxres', 'hq', 'sd'] as const).map((q) => (
                            <Button
                              key={q}
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => {
                                const params = new URLSearchParams({ url, quality: q });
                                window.open(`${BASE_URL}/download-thumbnail?${params.toString()}`);
                              }}
                            >
                              {q === 'maxres' ? 'HD' : q === 'hq' ? 'MQ' : 'SD'}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Subtitles card */}
                {captions.length > 0 && (
                  <Card className="mt-4">
                    <CardContent className="p-3">
                      <h5 className="font-medium mb-2">
                        <Captions className="inline h-4 w-4 mr-1" /> Subtitles
                      </h5>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {captions.map((c) => (
                          <div
                            key={c.languageCode}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="truncate">
                              {c.name}
                              {c.isAuto && (
                                <span className="text-xs text-muted-foreground ml-1">(auto)</span>
                              )}
                            </span>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const params = new URLSearchParams({
                                    url,
                                    lang: c.languageCode,
                                    format: 'srt',
                                  });
                                  window.open(`${BASE_URL}/download-caption?${params.toString()}`);
                                }}
                              >
                                SRT
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const params = new URLSearchParams({
                                    url,
                                    lang: c.languageCode,
                                    format: 'vtt',
                                  });
                                  window.open(`${BASE_URL}/download-caption?${params.toString()}`);
                                }}
                              >
                                VTT
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="mt-4">
                  {formats.length > 0 && (
                    <>
                      <h4 className="font-semibold mb-4">Available Formats:</h4>
                      <div className="flex gap-4">
                        <div className="w-1/2">
                          <h5 className="font-medium mb-2">
                            <Video className="inline h-4 w-4 mr-1" /> Video <span className="text-xs text-muted-foreground font-normal">(audio auto-merged)</span>
                          </h5>
                          <div className="grid gap-2">
                            {formats
                              .filter(f => f.type === 'video only' && f.approxSizeMB !== 'N/A')
                              .map(f => (
                                <Button
                                  key={f.itag}
                                  variant={selectedItag === f.itag ? 'default' : 'outline'}
                                  onClick={() => setSelectedItag(f.itag)}
                                  className="text-left justify-start mb-1"
                                >
                                  <div className="flex flex-col items-start">
                                    <span className="font-medium">
                                      {f.qualityLabel} - {f.type}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {f.container}, ~{f.approxSizeMB} MB
                                    </span>
                                  </div>
                                </Button>
                              ))}
                          </div>
                        </div>

                        <div className="w-1/2">
                          <h5 className="font-medium mb-2">
                            <Volume2 className="inline h-4 w-4 mr-1" /> Audio Only
                          </h5>
                          <div className="grid gap-2">
                            {formats
                              .filter(f => f.type === 'audio only' && f.approxSizeMB !== 'N/A')
                              .map(f => (
                                <Button
                                  key={f.itag}
                                  variant={selectedItag === f.itag ? 'default' : 'outline'}
                                  onClick={() => setSelectedItag(f.itag)}
                                  className="text-left justify-start mb-1"
                                >
                                  <div className="flex flex-col items-start">
                                    <span className="font-medium">
                                      {f.qualityLabel} - {f.type}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {f.container}, ~{f.approxSizeMB} MB
                                    </span>
                                  </div>
                                </Button>
                              ))}
                          </div>
                          <hr className="my-4" />

                          <h5 className="font-medium mb-2">
                            <Volume2 className="inline h-4 w-4 mr-1" /> Audio + Video
                          </h5>
                          <div className="grid gap-2">
                            {formats
                              .filter(f => f.type === 'video+audio' && f.approxSizeMB !== 'N/A')
                              .map(f => (
                                <Button
                                  key={f.itag}
                                  variant={selectedItag === f.itag ? 'default' : 'outline'}
                                  onClick={() => setSelectedItag(f.itag)}
                                  className="text-left justify-start mb-1"
                                >
                                  <div className="flex flex-col items-start">
                                    <span className="font-medium">
                                      {f.qualityLabel} - {f.type}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {f.container}, ~{f.approxSizeMB} MB
                                    </span>
                                  </div>
                                </Button>
                              ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Trim inputs */}
                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium block">
                    Trim <span className="text-xs text-muted-foreground font-normal">(optional, format: 1:23 or 0:01:23)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Start (e.g. 0:30)"
                      value={trimStart}
                      onChange={(e) => setTrimStart(e.target.value)}
                      className="flex-1"
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                      placeholder="End (e.g. 1:45)"
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>

                {/* Convert to selector */}
                <div className="mt-4 flex items-center gap-3">
                  <label htmlFor="convertTo" className="text-sm font-medium">
                    Convert to:
                  </label>
                  <select
                    id="convertTo"
                    value={convertTo}
                    onChange={(e) => setConvertTo(e.target.value)}
                    className="flex-1 h-9 rounded-md border border-input bg-card text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Original (no conversion)</option>
                    <optgroup label="Audio">
                      <option value="mp3">MP3</option>
                      <option value="m4a">M4A</option>
                      <option value="wav">WAV</option>
                      <option value="ogg">OGG</option>
                      <option value="flac">FLAC</option>
                    </optgroup>
                    <optgroup label="Video">
                      <option value="mp4">MP4</option>
                      <option value="webm">WebM</option>
                      <option value="mkv">MKV (remux)</option>
                    </optgroup>
                  </select>
                </div>

                {/* Progress bar */}
                {progress && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        {progress.phase === 'merging'
                          ? 'Merging audio + video…'
                          : progress.phase === 'converting'
                            ? `Converting to ${convertTo.toUpperCase()}…`
                            : progress.phase === 'trimming'
                              ? 'Trimming clip…'
                              : `${progress.percent}%`}
                      </span>
                      <span className="text-muted-foreground">
                        {progress.downloadedMB} / {progress.totalMB} MB
                        {progress.speedMBs && progress.phase === 'downloading' && (
                          <> &middot; {progress.speedMBs} MB/s</>
                        )}
                        {progress.etaSec != null && progress.etaSec > 0 && progress.phase === 'downloading' && (
                          <> &middot; {formatEta(progress.etaSec)}</>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded h-2 overflow-hidden">
                      <div
                        className="bg-primary h-2 rounded transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  id="download-btn"
                  disabled={!selectedItag || downloadLoading}
                  onClick={handleDownload}
                  className="mt-4 w-full flex items-center justify-center gap-2"
                >
                  {downloadLoading ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      Downloading...
                    </>
                  ) : (
                    <>Download <kbd className="ml-2 text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded font-mono">Ctrl+Enter</kbd></>
                  )}
                </Button>
              </>
            )}

            <div className="mt-8">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg mb-2">
                  <ScrollText className="inline h-5 w-5 mr-1" /> Download History
                </h3>
                <Button onClick={() => router.push('/downloads')}>History</Button>
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {history.slice(0, 5).map((h, i) => (
                  <li key={i}>
                    {h.title} <span className="text-muted-foreground">({h.type})</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
