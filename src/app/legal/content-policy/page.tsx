import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Content & IP Policy | CricGeek",
};

export default function ContentPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-black text-white mb-8">Content & IP Policy</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
        <p className="text-gray-400 text-sm">Last updated: February 11, 2026</p>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">1. Intellectual Property</h2>
          <p>
            The CricGeek name, logo, design, and original content are the intellectual
            property of CricGeek. All rights reserved. Team logos, player images, and
            cricket board logos belong to their respective owners and are used for
            informational purposes only.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">2. Cricket Data Attribution</h2>
          <p>
            Live scores, scorecards, and match data are sourced from third-party cricket
            APIs. We display this data for informational purposes and do not claim ownership
            of cricket statistics or results.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">3. User-Generated Content</h2>
          <p>
            Users retain copyright to their original blog posts and comments. By posting
            on CricGeek, you grant us a license to display your content. You may request
            removal of your content at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">4. Copyright Complaints</h2>
          <p>
            If you believe content on CricGeek infringes your copyright, please contact us
            at{" "}
            <a href="mailto:legal@cricgeek.com" className="text-cg-green hover:underline">
              legal@cricgeek.com
            </a>{" "}
            with details of the alleged infringement. We will investigate and take
            appropriate action.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mt-8 mb-3">5. Fair Use</h2>
          <p>
            CricGeek&apos;s analysis and commentary content constitutes fair use of cricket
            statistics and public information for the purpose of news reporting, criticism,
            and commentary.
          </p>
        </section>
      </div>
    </div>
  );
}
