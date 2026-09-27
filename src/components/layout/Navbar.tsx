"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  Menu,
  X,
  Zap,
  Radio,
  Calendar,
  PenSquare,
  Shield,
  Search,
  User,
  Trophy,
  LogOut,
  ChevronDown,
  BrainCircuit,
} from "lucide-react";

const navLinks = [
  { href: "/matches", label: "Live Matches", icon: Zap },
  { href: "/insights", label: "AI Insights", icon: BrainCircuit },
  { href: "/commentary", label: "Commentary", icon: Radio },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/blog", label: "Expressions", icon: PenSquare },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
];

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function Navbar() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const user = (session?.user as UserSession | undefined) ?? null;
  const authLoading = status === "loading";

  const handleSignOut = () => {
    setShowDropdown(false);
    void signOut({ redirectTo: "/" });
  };

  const visibleNavLinks = user?.role === "admin"
    ? [...navLinks, { href: "/admin", label: "Admin", icon: Shield }]
    : navLinks;

  return (
    <nav className="bg-cg-dark border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-cg-green rounded-lg flex items-center justify-center">
              <span className="text-black font-black text-lg">CG</span>
            </div>
            <span className="text-white font-bold text-xl hidden sm:block">
              CricGeek
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {visibleNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-gray-300 hover:text-cg-green hover:bg-gray-800/50 px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
              >
                <link.icon size={16} />
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-3">
            <button className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800/50 transition-all">
              <Search size={18} />
            </button>

            {authLoading ? (
              <div className="h-10 w-28 animate-pulse rounded-xl border border-gray-700 bg-cg-dark-2" />
            ) : user ? (
              /* Logged in — User Dropdown */
              <div className="relative">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2 bg-cg-dark-2 border border-gray-700 rounded-xl px-3 py-1.5 hover:border-gray-500 transition-all"
                >
                  <div className="w-7 h-7 rounded-full bg-cg-green/20 flex items-center justify-center text-xs font-bold text-cg-green">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-white text-sm font-medium max-w-[100px] truncate">
                    {user.name}
                  </span>
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
                </button>

                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 mt-2 w-52 bg-cg-dark-2 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-800">
                        <p className="text-sm font-medium text-white truncate">{user.name}</p>
                        <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
                      </div>
                      <div className="py-1">
                        <Link href={`/writer/${user.id}`} onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-all">
                          <User size={14} /> My Profile
                        </Link>
                        <Link href="/blog/write" onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-all">
                          <PenSquare size={14} /> {user.role === "user" ? "Become a Writer" : "Write Expression"}
                        </Link>
                        <Link href="/leaderboard" onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-all">
                          <Trophy size={14} /> Leaderboard
                        </Link>
                        {user.role === "admin" && (
                          <Link href="/admin" onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-cg-green hover:bg-gray-800 transition-all">
                            <Shield size={14} /> Admin Dashboard
                          </Link>
                        )}
                      </div>
                      <div className="border-t border-gray-800 py-1">
                        <button
                          onClick={handleSignOut}
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 w-full transition-all"
                        >
                          <LogOut size={14} /> Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Not logged in */
              <>
                <Link
                  href="/auth/login"
                  className="text-gray-300 hover:text-white px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
                >
                  <User size={16} />
                  Sign In
                </Link>
                <Link
                  href="/auth/register"
                  className="bg-cg-green text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cg-green-dark transition-all"
                >
                  Join Free
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden text-gray-300 hover:text-white p-2"
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden bg-cg-dark border-t border-gray-800 pb-4">
          <div className="px-4 pt-2 space-y-1">
            {visibleNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-gray-300 hover:text-cg-green hover:bg-gray-800/50 px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2"
              >
                <link.icon size={18} />
                {link.label}
              </Link>
            ))}
            <hr className="border-gray-800 my-2" />

            {authLoading ? (
              <div className="px-3 py-3 text-sm text-gray-500">Checking session...</div>
            ) : user ? (
              <>
                <div className="flex items-center gap-3 px-3 py-3">
                  <div className="w-9 h-9 rounded-full bg-cg-green/20 flex items-center justify-center text-sm font-bold text-cg-green">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{user.name}</p>
                    <p className="text-[10px] text-gray-500">{user.email}</p>
                  </div>
                </div>
                <Link href={`/writer/${user.id}`} onClick={() => setIsOpen(false)} className="text-gray-300 hover:text-white px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2">
                  <User size={18} /> My Profile
                </Link>
                <Link href="/blog/write" onClick={() => setIsOpen(false)} className="text-gray-300 hover:text-white px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2">
                  <PenSquare size={18} /> {user.role === "user" ? "Become a Writer" : "Write Expression"}
                </Link>
                {user.role === "admin" && (
                  <Link href="/admin" onClick={() => setIsOpen(false)} className="text-cg-green hover:text-cg-green-dark px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2">
                    <Shield size={18} /> Admin Dashboard
                  </Link>
                )}
                <button onClick={() => { handleSignOut(); setIsOpen(false); }} className="text-red-400 hover:text-red-300 px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2 w-full">
                  <LogOut size={18} /> Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/login" onClick={() => setIsOpen(false)} className="text-gray-300 hover:text-white px-3 py-3 rounded-lg text-base font-medium transition-all flex items-center gap-2">
                  <User size={18} /> Sign In
                </Link>
                <Link href="/auth/register" onClick={() => setIsOpen(false)} className="bg-cg-green text-black px-4 py-3 rounded-lg text-base font-bold hover:bg-cg-green-dark transition-all block text-center mt-2">
                  Join Free
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
