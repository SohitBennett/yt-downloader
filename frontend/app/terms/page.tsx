import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for YT Downloader',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto prose dark:prose-invert">
      <h1>Terms of Service</h1>
      <p className="text-muted-foreground">Last updated: April 2026</p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing and using YT Downloader (&quot;the Service&quot;), you agree to be bound by
        these Terms of Service. If you do not agree, please do not use the Service.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        YT Downloader is a free tool that allows users to download YouTube videos and audio
        for personal, non-commercial use. The Service acts as a technical bridge to facilitate
        downloads of publicly available content.
      </p>

      <h2>3. Acceptable Use</h2>
      <ul>
        <li>You may only download content for personal and non-commercial purposes.</li>
        <li>You must comply with YouTube&apos;s Terms of Service and all applicable laws.</li>
        <li>You are solely responsible for ensuring you have the right to download any content.</li>
        <li>You must not use the Service to infringe on any copyright or intellectual property rights.</li>
        <li>You must not use automated tools or bots to access the Service.</li>
      </ul>

      <h2>4. Copyright and DMCA</h2>
      <p>
        We respect intellectual property rights. If you believe that content downloaded through our
        Service infringes your copyright, please contact us with a DMCA takedown notice. We will
        respond to valid notices in accordance with applicable law.
      </p>

      <h2>5. Disclaimer of Warranties</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties
        of any kind, either express or implied. We do not guarantee that the Service will be
        uninterrupted, error-free, or free of viruses or other harmful components.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, we shall not be liable for any indirect,
        incidental, special, consequential, or punitive damages arising from your use of the
        Service.
      </p>

      <h2>7. Changes to Terms</h2>
      <p>
        We reserve the right to modify these Terms at any time. Continued use of the Service
        after changes constitutes acceptance of the updated Terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        If you have questions about these Terms, please open an issue on our GitHub repository.
      </p>
    </main>
  );
}
