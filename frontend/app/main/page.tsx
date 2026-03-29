// yt-downloader-frontend/app/page.tsx
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import axios from 'axios';
import BASE_URL from '@/config';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';


export default function Main() {
  const [url, setUrl] = useState('');
  const [formats, setFormats] = useState<any[]>([]);
  const [audioFormats, setAudioFormats] = useState<any[]>([]);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [type, setType] = useState<'video' | 'audio'>('video');
  const [selectedItag, setSelectedItag] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [history, setHistory] = useState<{ title: string; type: string }[]>([]);
  const [show, setShow] = useState(false)
  const router = useRouter();

  const fetchInfo = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${BASE_URL}/info`, { url });
      const allFormats = res.data.formats;
      const seen = new Set();
      const uniqueFormats = allFormats.filter(f => {
        const key = `${f.itag}-${f.container}-${f.qualityLabel}-${f.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setFormats(uniqueFormats);


    } catch (err) {
      alert('Failed to fetch video info');
    }
    setShow(true);
    setLoading(false);
    console.log(formats)
  };


const handleDownload = () => {
  if (!selectedItag) return alert('Select a quality first');

  setDownloadLoading(true); 

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = `${BASE_URL}/download?url=${encodeURIComponent(url)}&itag=${selectedItag}`;
  iframe.onload = () => {
    setDownloadLoading(false); 
  };
  iframe.onerror = () => {
    alert('Download failed');
    setDownloadLoading(false);
  };

  document.body.appendChild(iframe);

  setTimeout(() => {
    setDownloadLoading(false);
    // document.body.removeChild(iframe);
  }, 10000);

  setHistory([...history, { title: url, type: 'single' }]);
};



  const handlePlaylist = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${BASE_URL}/playlist`, {
        url,
        type,
      });
      alert('Playlist downloaded:\n' + res.data.downloads.map((f: any) => f.title).join('\n'));
      setHistory([...history, { title: url, type: 'playlist-' + type }]);
    } catch (err) {
      alert('Failed to download playlist');
    }
    setLoading(false);
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen p-6">
        <Card className="max-w-xl mx-auto p-4 space-y-4">
          <CardContent>
            <h2 className="text-2xl font-bold mb-8 text-center">🎥 YouTube Video Downloader</h2>
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
                  {loading ? 'Loading formats...' : '🔍 Formats'}
                </Button>

                <div className="mt-4">
                  {show && (
                    <>
                      <h4 className="font-semibold mb-4">Available Formats:</h4>
                      <div className="flex gap-4">
                        <div className="w-1/2">
                          <h5 className="font-medium mb-2">🎥 Video Only</h5>
                          <div className="grid gap-2">
                            {formats
                              .filter(f => f.type === 'video only' && f.approxSizeMB !== 'N/A' )
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
                                    <span className="text-xs text-gray-500">
                                      {f.container}, ~{f.approxSizeMB} MB
                                    </span>
                                  </div>
                                </Button>
                              ))}
                          </div>
                        </div>

                        <div className="w-1/2">
                          <h5 className="font-medium mb-2">🔊 Audio Only</h5>
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
                                    <span className="text-xs text-gray-500">
                                      {f.container}, ~{f.approxSizeMB} MB
                                    </span>
                                  </div>
                                </Button>
                              ))}
                          </div>
                          <hr className="my-4" />
                          
                          <h5 className="font-medium mb-2">🔊 Audio + Video </h5>
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
                                    <span className="text-xs text-gray-500">
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

                {/* <Button disabled={!selectedItag || loading} onClick={handleDownload} className="mt-4 w-full">
                  Download
                </Button> */}

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
                        Preparing Download...
                      </>
                    ) : (
                      'Download'
                    )}
                  </Button>


              </>
            )}

            <div className="mt-8">
              <div className='flex items-center justify-between'>
                <h3 className="font-bold text-lg mb-2">📜 Download History</h3>
                <Button onClick={()=> router.push("/downloads")}>History</Button>
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {history.map((h, i) => (
                  <li key={i}>{h.title} <span className="text-gray-500">({h.type})</span></li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
