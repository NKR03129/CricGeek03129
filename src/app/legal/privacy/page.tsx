import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | CricGeek",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-black text-white mb-8">Privacy Policy</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
        <p className="text-gray-400 text-sm">
          Last updated: February 11, 2026
        </p>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            1. Information We Collect
          </h2>
          <p>
            We collect information you provide when creating an account (name, email, phone number),
            content you post (blogs, comments), and usage data (pages visited, match preferences).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            2. How We Use Your Information
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To provide and improve our cricket platform services</li>
            <li>To personalize your experience with relevant match updates</li>
            <li>To communicate with you about your account and platform updates</li>
            <li>To moderate community content and maintain platform safety</li>
            <li>To display relevant advertisements through Google AdSense</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            3. Data Sharing
          </h2>
          <p>
            We do not sell your personal data. We may share anonymized usage data with
            advertising partners (Google AdSense) to serve relevant ads. Cricket data
            is sourced from third-party APIs and displayed as-is.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            4. Cookies & Tracking
          </h2>
          <p>
            We use cookies for authentication, preferences, and analytics. Third-party
            advertising partners may also use cookies. You can manage cookie preferences
            in your browser settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            5. Data Security
          </h2>
          <p>
            We implement industry-standard security measures including encrypted passwords,
            HTTPS encryption, and secure session management. However, no system is 100% secure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            6. Your Rights
          </h2>
          <p>
            You can request access to, correction, or deletion of your personal data
            by contacting us. You can also delete your account at any time from your
            account settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">
            7. Contact
          </h2>
          <p>
            For privacy-related inquiries, contact us at{" "}
            <a href="mailto:privacy@cricgeek.com" className="text-cg-green hover:underline">
              privacy@cricgeek.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
