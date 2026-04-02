// yt-downloader-frontend/app/downloads/page.tsx
'use client';

import Link from 'next/link';
import { FolderOpen } from 'lucide-react';

export default function DownloadsPage() {
  const storedHistory = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('downloads') || '[]') : [];

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4"><FolderOpen className="inline h-6 w-6 mr-1" /> Your Download History</h2>
        <Link href="/" className="text-blue-600 underline mb-4 block">← Back to Home</Link>
        <ul className="bg-white p-4 rounded shadow space-y-2">
          {storedHistory.length > 0 ? (
            storedHistory.map((item: any, index: number) => (
              <li key={index} className="text-sm border-b pb-2">
                <strong>{item.title}</strong> <span className="text-gray-500">({item.type})</span>
              </li>
            ))
          ) : (
            <li className="text-gray-600">No downloads found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
