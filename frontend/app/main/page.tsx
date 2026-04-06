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
import { Video, Search, Volume2, ScrollText } from 'lucide-react';
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

interface ProgressState {
  percent: number;
  downloadedMB: string;
  totalMB: string;
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
    setProgress({ percent: 0, downloadedMB: '0', totalMB: '0' });

    const entry: HistoryEntry = {
      title: videoTitle || url,
      url,
      type: 'single',
      timestamp: Date.now(),
    };
    saveToHistory(entry);
    toast.success('Download started!');

    const eventSource = new EventSource(
      `${BASE_URL}/download-progress?url=${encodeURIComponent(url)}&itag=${selectedItag}`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.percent !== undefined) {
          setProgress({
            percent: data.percent,
            downloadedMB: data.downloadedMB || '0',
            totalMB: data.totalMB || '0',
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.addEventListener('complete', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.filename) {
          window.open(`${BASE_URL}/download-file/${data.filename}`);
        }
      } catch {
        // fallback
      }
      eventSource.close();
      setDownloadLoading(false);
      setProgress(null);
      toast.success('Download complete!');
    });

    eventSource.onerror = () => {
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

                <div className="mt-4">
                  {formats.length > 0 && (
                    <>
                      <h4 className="font-semibold mb-4">Available Formats:</h4>
                      <div className="flex gap-4">
                        <div className="w-1/2">
                          <h5 className="font-medium mb-2">
                            <Video className="inline h-4 w-4 mr-1" /> Video Only
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

                {/* Progress bar */}
                {progress && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{progress.percent}%</span>
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
