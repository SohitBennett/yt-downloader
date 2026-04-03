import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://ytdownloader.app";

export const metadata: Metadata = {
  title: {
    default: "YT Downloader - Free YouTube Video & Audio Downloader",
    template: "%s | YT Downloader",
  },
  description:
    "Download YouTube videos and audio in multiple formats and qualities. Fast, free, and easy-to-use YouTube downloader with playlist support.",
  keywords: [
    "youtube downloader",
    "download youtube video",
    "youtube to mp4",
    "youtube to mp3",
    "video downloader",
    "audio downloader",
    "playlist downloader",
  ],
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "YT Downloader - Free YouTube Video & Audio Downloader",
    description:
      "Download YouTube videos and audio in multiple formats and qualities. Fast, free, and easy-to-use.",
    url: SITE_URL,
    siteName: "YT Downloader",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "YT Downloader - Free YouTube Video & Audio Downloader",
    description:
      "Download YouTube videos and audio in multiple formats and qualities.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
