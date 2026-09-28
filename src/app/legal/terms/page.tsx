import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use | CricGeek",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-black text-white mb-8">Terms of Use</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
        <p className="text-gray-400 text-sm">Last updated: February 11, 2026</p>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing and using CricGeek, you agree to be bound by these Terms of Use.
            If you do not agree, please do not use the platform.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">2. User Accounts</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You must provide accurate information during registration</li>
            <li>You are responsible for maintaining the security of your account</li>
            <li>One account per person; duplicate accounts may be terminated</li>
            <li>You must be at least 13 years old to create an account</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">3. User Content</h2>
          <p>
            By posting blogs or comments on CricGeek, you grant us a non-exclusive,
            worldwide license to display, distribute, and promote your content on our
            platform. You retain ownership of your original content.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">4. Prohibited Conduct</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Posting spam, misleading, or harmful content</li>
            <li>Impersonating other users or public figures</li>
            <li>Attempting to exploit, hack, or disrupt the platform</li>
            <li>Using the platform for illegal activities</li>
            <li>Circumventing moderation or content policies</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">5. Cricket Data</h2>
          <p>
            Live scores and cricket data are sourced from third-party APIs. While we
            strive for accuracy, we do not guarantee real-time accuracy of scores and
            statistics. CricGeek is not affiliated with ICC, BCCI, or any cricket board.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">6. Limitation of Liability</h2>
          <p>
            CricGeek is provided &quot;as is&quot; without warranties. We are not liable for
            any damages arising from your use of the platform, including but not limited
            to data loss, service interruptions, or inaccurate cricket data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">7. Modifications</h2>
          <p>
            We reserve the right to modify these terms at any time. Continued use of the
            platform after changes constitutes acceptance of the updated terms.
          </p>
        </section>
      </div>
    </div>
  );
}
