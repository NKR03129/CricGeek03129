"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { Eye, EyeOff, Mail, Lock, ArrowRight, Chrome } from "lucide-react";

const CRICKET_FACTS = [
  "Don Bradman's batting average of 99.94 remains the greatest in Test history.",
  "Sachin Tendulkar scored 100 international centuries across all formats.",
  "The first ever cricket World Cup was held in 1975 in England.",
  "A cricket ball weighs between 155.9g and 163g.",
  "The longest Test match lasted 12 days — England vs South Africa in 1939.",
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const next = searchParams.get("next");
  const redirect = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [factIdx] = useState(() => Math.floor(Math.random() * CRICKET_FACTS.length));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const requestedCallbackUrl = next || redirect || "/";

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: requestedCallbackUrl,
      });

      if (!result || result.error) {
        setError("Invalid email or password");
        return;
      }

      const session = await getSession();
      const defaultCallbackUrl =
        !next && !redirect && (session?.user as { role?: string } | undefined)?.role === "admin"
          ? "/admin"
          : requestedCallbackUrl;

      router.replace(result.url || defaultCallbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);

    try {
      const callbackUrl = next || redirect || "/";
      await signIn("google", { callbackUrl });
    } catch {
      setError("Google sign-in could not be started. Please try again.");
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-0 bg-cg-dark-2 rounded-2xl border border-gray-800 overflow-hidden">
        {/* Left — Branding Panel */}
        <div className="hidden lg:flex flex-col justify-between p-8 bg-gradient-to-br from-cg-green/10 via-cg-dark-2 to-cg-dark-3 border-r border-gray-800">
          <div>
            <div className="flex items-center gap-2 mb-10">
              <div className="w-10 h-10 bg-cg-green rounded-lg flex items-center justify-center">
                <span className="text-black font-black text-lg">CG</span>
              </div>
              <span className="text-white font-bold text-xl">CricGeek</span>
            </div>

            <h2 className="text-3xl font-black text-white leading-tight mb-3">
              Your cricket <br />
              <span className="text-cg-green">analysis hub</span>
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Write, analyze, and compete with AI-powered scoring. Join thousands of cricket enthusiasts shaping the game&apos;s narrative.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-4 mt-8">
            {[
              { icon: "📝", label: "Write and publish cricket expressions" },
              { icon: "🤖", label: "Get AI-scored Expression Quality Scores" },
              { icon: "🏆", label: "Climb the leaderboard and earn badges" },
              { icon: "🧬", label: "Discover your Writer DNA" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 text-sm">
                <span className="text-lg">{item.icon}</span>
                <span className="text-gray-300">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Cricket fact */}
          <div className="mt-8 bg-cg-dark-3/50 rounded-lg p-4 border border-gray-800">
            <p className="text-[10px] text-cg-green font-bold uppercase mb-1.5">🏏 Did you know?</p>
            <p className="text-gray-400 text-xs leading-relaxed">{CRICKET_FACTS[factIdx]}</p>
          </div>
        </div>

        {/* Right — Login Form */}
        <div className="p-6 sm:p-8 lg:p-10 flex flex-col justify-center">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-6">
            <div className="w-14 h-14 bg-cg-green rounded-xl flex items-center justify-center mx-auto mb-3">
              <span className="text-black font-black text-2xl">CG</span>
            </div>
          </div>

          <h1 className="text-2xl font-black text-white mb-1">Welcome back</h1>
          <p className="text-gray-400 text-sm mb-6">Sign in to your CricGeek account</p>

          {registered && (
            <div className="bg-cg-green/10 border border-cg-green/20 rounded-lg p-3 text-cg-green text-sm mb-4 flex items-center gap-2">
              ✅ Account created! Sign in to get started.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  id="login-email"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-sm font-medium text-gray-300">Password</label>
                <button type="button" className="text-xs text-cg-green hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-10 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  id="login-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              id="login-submit"
              className="w-full bg-cg-green text-black py-3 rounded-xl font-bold text-sm hover:bg-cg-green-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-gray-700 flex-1" />
            <span className="text-xs text-gray-500">or continue with</span>
            <div className="h-px bg-gray-700 flex-1" />
          </div>

          {/* Social buttons */}
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="flex items-center justify-center gap-2 bg-cg-dark-3 border border-gray-700 rounded-xl py-2.5 text-sm text-gray-300 hover:border-gray-500 hover:bg-gray-800 transition-all disabled:opacity-50"
            >
              <Chrome size={16} />
              {googleLoading ? "Redirecting to Google..." : "Continue with Google"}
            </button>
          </div>

          <p className="text-center text-gray-400 text-sm mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="text-cg-green font-bold hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[85vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-cg-green/30 border-t-cg-green rounded-full animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
