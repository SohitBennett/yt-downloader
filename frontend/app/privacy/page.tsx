import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for YT Downloader',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto prose dark:prose-invert">
      <h1>Privacy Policy</h1>
      <p className="text-muted-foreground">Last updated: April 2026</p>

      <h2>1. Information We Collect</h2>
      <p>
        YT Downloader is designed with privacy in mind. We collect minimal information:
      </p>
      <ul>
        <li>
          <strong>URLs you submit:</strong> YouTube URLs are processed on our server to fetch
          video information and initiate downloads. These URLs are not stored permanently.
        </li>
        <li>
          <strong>Download history:</strong> Your download history is stored locally in your
          browser (localStorage) and is never sent to our servers.
        </li>
        <li>
          <strong>Server logs:</strong> We may log request metadata (IP addresses, timestamps,
          request paths) for security and abuse prevention purposes. These logs are retained
          for a maximum of 30 days.
        </li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To process your download requests.</li>
        <li>To monitor and prevent abuse of the Service.</li>
        <li>To improve the reliability and performance of the Service.</li>
      </ul>

      <h2>3. Data Storage and Security</h2>
      <p>
        Downloaded files are temporarily stored on our servers and automatically deleted within
        one hour. We implement rate limiting and input validation to protect against abuse.
      </p>

      <h2>4. Cookies and Local Storage</h2>
      <p>
        We use browser localStorage to store your download history and theme preferences
        locally on your device. We do not use tracking cookies or third-party analytics.
      </p>

      <h2>5. Third-Party Services</h2>
      <p>
        The Service interacts with YouTube to fetch video information. Your use of downloaded
        content is subject to YouTube&apos;s Privacy Policy and Terms of Service.
      </p>

      <h2>6. Data Sharing</h2>
      <p>
        We do not sell, trade, or otherwise share your personal information with third parties.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        Since we store minimal data, there is very little personal information to manage.
        You can clear your local download history at any time from the Downloads page.
        Server logs are automatically purged after 30 days.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted on this
        page with an updated revision date.
      </p>

      <h2>9. Contact</h2>
      <p>
        If you have questions about this Privacy Policy, please open an issue on our GitHub
        repository.
      </p>
    </main>
  );
}
