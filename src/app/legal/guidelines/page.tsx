import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Community Guidelines | CricGeek",
};

export default function GuidelinesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-black text-white mb-8">Community Guidelines</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
        <p className="text-gray-400 text-sm">Last updated: February 11, 2026</p>

        <div className="bg-cg-green/5 border border-cg-green/20 rounded-xl p-4 mb-6">
          <p className="text-cg-green font-medium text-sm">
            CricGeek is a community for passionate cricket fans. We expect respectful,
            thoughtful, and cricket-focused discussions.
          </p>
        </div>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">Blog Posting Rules</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>All blogs must be 120–200 words</li>
            <li>Content must be cricket-related</li>
            <li>Original content only — no plagiarism</li>
            <li>All blogs are reviewed before publication</li>
            <li>No promotional or affiliate content</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">Community Standards</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Respect other fans even when you disagree</li>
            <li>No hate speech, racism, sexism, or discrimination</li>
            <li>No personal attacks on players, commentators, or other users</li>
            <li>No match-fixing discussions or promotion of illegal betting</li>
            <li>Constructive criticism is welcome; toxicity is not</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">Reporting & Moderation</h2>
          <p>
            If you see content that violates these guidelines, use the report button on
            any blog post. Our moderation team reviews all reports within 24 hours.
            Repeated violations will result in account suspension or permanent ban.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">Consequences</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>First violation:</strong> Content removed + warning</li>
            <li><strong>Second violation:</strong> 7-day posting suspension</li>
            <li><strong>Third violation:</strong> Permanent ban</li>
            <li><strong>Severe violations:</strong> Immediate permanent ban</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
