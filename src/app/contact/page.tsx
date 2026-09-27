import type { Metadata } from "next";
import { Mail, MapPin, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact Us | CricGeek",
};

export default function ContactPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-black text-white mb-2">Contact Us</h1>
      <p className="text-gray-400 mb-8">
        Have questions, feedback, or partnership inquiries? Reach out to us.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 flex items-start gap-3">
          <Mail size={20} className="text-cg-green mt-0.5 shrink-0" />
          <div>
            <h3 className="text-white font-semibold text-sm">Email</h3>
            <a href="mailto:hello@cricgeek.com" className="text-gray-400 text-sm hover:text-cg-green">
              hello@cricgeek.com
            </a>
          </div>
        </div>
        <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 flex items-start gap-3">
          <Clock size={20} className="text-cg-green mt-0.5 shrink-0" />
          <div>
            <h3 className="text-white font-semibold text-sm">Response Time</h3>
            <p className="text-gray-400 text-sm">Usually within 24-48 hours</p>
          </div>
        </div>
        <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 flex items-start gap-3 md:col-span-2">
          <MapPin size={20} className="text-cg-green mt-0.5 shrink-0" />
          <div>
            <h3 className="text-white font-semibold text-sm">For specific queries</h3>
            <div className="text-gray-400 text-sm space-y-1 mt-1">
              <p>Content moderation: <span className="text-gray-300">moderation@cricgeek.com</span></p>
              <p>Legal & IP issues: <span className="text-gray-300">legal@cricgeek.com</span></p>
              <p>Advertising: <span className="text-gray-300">ads@cricgeek.com</span></p>
              <p>Privacy concerns: <span className="text-gray-300">privacy@cricgeek.com</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Form */}
      <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-bold text-white mb-4">Send us a message</h2>
        <form className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">Name</label>
              <input
                type="text"
                className="w-full bg-cg-dark border border-gray-800 rounded-lg px-4 py-2.5 text-white text-sm focus:border-cg-green focus:outline-none"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">Email</label>
              <input
                type="email"
                className="w-full bg-cg-dark border border-gray-800 rounded-lg px-4 py-2.5 text-white text-sm focus:border-cg-green focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">Subject</label>
            <input
              type="text"
              className="w-full bg-cg-dark border border-gray-800 rounded-lg px-4 py-2.5 text-white text-sm focus:border-cg-green focus:outline-none"
              placeholder="What's this about?"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">Message</label>
            <textarea
              className="w-full bg-cg-dark border border-gray-800 rounded-lg px-4 py-3 text-white text-sm focus:border-cg-green focus:outline-none min-h-[120px] resize-y"
              placeholder="Your message..."
            />
          </div>
          <button
            type="submit"
            className="bg-cg-green text-black px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-cg-green-dark transition-all"
          >
            Send Message
          </button>
        </form>
      </div>
    </div>
  );
}
