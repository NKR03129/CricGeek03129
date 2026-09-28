import Link from "next/link";

const footerLinks = {
  Cricket: [
    { href: "/matches", label: "Live Matches" },
    { href: "/calendar", label: "Match Calendar" },
    { href: "/blog", label: "Community Expressions" },
  ],
  Legal: [
    { href: "/legal/privacy", label: "Privacy Policy" },
    { href: "/legal/terms", label: "Terms of Use" },
    { href: "/legal/guidelines", label: "Community Guidelines" },
    { href: "/legal/content-policy", label: "Content & IP Policy" },
  ],
  Company: [
    { href: "/contact", label: "Contact Us" },
    { href: "/about", label: "About CricGeek" },
  ],
};

export default function Footer() {
  return (
    <footer className="bg-cg-dark border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-cg-green rounded-lg flex items-center justify-center">
                <span className="text-black font-black text-lg">CG</span>
              </div>
              <span className="text-white font-bold text-xl">CricGeek</span>
            </div>
            <p className="text-gray-400 text-sm">
              Your ultimate cricket companion. Live scores, expert analysis,
              and community-driven cricket discussion.
            </p>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-white font-semibold mb-4">{category}</h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-gray-400 hover:text-cg-green text-sm transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} CricGeek. All rights reserved.
          </p>
          <p className="text-gray-600 text-xs">
            Cricket data provided by SportMonks. Not affiliated with ICC or BCCI.
          </p>
        </div>
      </div>
    </footer>
  );
}
