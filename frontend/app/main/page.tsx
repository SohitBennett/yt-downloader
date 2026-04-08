'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import axios from 'axios';
import BASE_URL from '@/config';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import { Video, Search, Volume2, ScrollText, Captions } from 'lucide-react';
import { toast } from 'sonner';

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

interface ProgressState {
  percent: number;
  downloadedMB: string;
  totalMB: string;
  phase: 'downloading' | 'merging' | 'converting' | 'trimming' | 'complete';
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
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [convertTo, setConvertTo] = useState<string>('');
  const [trimStart, setTrimStart] = useState<string>('');
  const [trimEnd, setTrimEnd] = useState<string>('');
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const router = useRouter();

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('downloads');
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

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
      setCaptions(res.data.captions || []);
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
        <Card className="max-w-xl mx-auto p-4 space-y-4">
          <CardContent>
            <h2 className="text-2xl font-bold mb-8 text-center">
              <Video className="inline h-6 w-6 mr-1" /> YouTube Video Downloader
            </h2>
            <Input
              placeholder="Paste YouTube video or playlist URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="flex items-center justify-between py-2">
              <span>Download whole Playlist?</span>
              <Switch checked={isPlaylist} onCheckedChange={setIsPlaylist} />
            </div>

            {isPlaylist ? (
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
            ) : (
              <>
                <Button onClick={fetchInfo} disabled={loading} className="mt-4">
                  {loading ? 'Loading formats...' : <><Search className="inline h-4 w-4 mr-1" /> Formats</>}
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
                      <p className="font-bold text-sm leading-snug">{videoTitle}</p>
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
                      <span>{progress.downloadedMB} / {progress.totalMB} MB</span>
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
                    'Download'
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
