'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FolderOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '../components/Navbar';

interface HistoryEntry {
  title: string;
  url: string;
  type: 'single' | 'playlist-video' | 'playlist-audio';
  timestamp: number;
}

export default function DownloadsPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

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

  const clearHistory = () => {
    localStorage.removeItem('downloads');
    setHistory([]);
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen p-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">
            <FolderOpen className="inline h-6 w-6 mr-1" /> Your Download History
          </h2>
          <div className="flex items-center justify-between mb-4">
            <Link href="/main" className="text-primary underline">
              &larr; Back to Home
            </Link>
            {history.length > 0 && (
              <Button variant="destructive" size="sm" onClick={clearHistory}>
                <Trash2 className="h-4 w-4 mr-1" /> Clear History
              </Button>
            )}
          </div>
          <ul className="bg-card border p-4 rounded-lg shadow space-y-2">
            {history.length > 0 ? (
              history.map((item, index) => (
                <li key={index} className="text-sm border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <strong>{item.title}</strong>{' '}
                      <span className="text-muted-foreground">({item.type})</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No downloads found.</li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
