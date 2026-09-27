"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowRight, CheckCircle2, Chrome } from "lucide-react";

const PASSWORD_REQUIREMENTS = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "One uppercase letter" },
  { test: (p: string) => /[0-9]/.test(p), label: "One number" },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const passedChecks = PASSWORD_REQUIREMENTS.filter((r) => r.test(form.password)).length;
  const passwordStrength = Math.round((passedChecks / PASSWORD_REQUIREMENTS.length) * 100);

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required");
      return;
    }
    setError("");
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, password: form.password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      router.push("/auth/login?registered=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
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
              Start your <br />
              <span className="text-cg-green">innings today</span>
            </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Create your free account to write, analyze, and get AI-scored quality ratings on your cricket expressions.
            </p>
          </div>

          {/* Steps indicator */}
          <div className="space-y-4 mt-8">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= 1 ? "bg-cg-green text-black" : "bg-gray-700 text-gray-400"}`}>
                {step > 1 ? "✓" : "1"}
              </div>
              <div>
                <p className={`text-sm font-medium ${step >= 1 ? "text-white" : "text-gray-500"}`}>Your Identity</p>
                <p className="text-[10px] text-gray-500">Name, email, and phone</p>
              </div>
            </div>
            <div className="ml-4 w-px h-4 bg-gray-700" />
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= 2 ? "bg-cg-green text-black" : "bg-gray-700 text-gray-400"}`}>
                2
              </div>
              <div>
                <p className={`text-sm font-medium ${step >= 2 ? "text-white" : "text-gray-500"}`}>Secure Your Account</p>
                <p className="text-[10px] text-gray-500">Set a strong password</p>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="mt-8 bg-cg-dark-3/50 rounded-lg p-4 border border-gray-800">
            <p className="text-[10px] text-cg-green font-bold uppercase mb-2">🎁 Free account includes</p>
            <div className="space-y-1.5">
                {["Unlimited expression publishing", "AI quality scoring (6 models)", "Writer DNA profile & radar chart", "Leaderboard ranking & badges"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-gray-400">
                  <CheckCircle2 size={12} className="text-cg-green shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Registration Form */}
        <div className="p-6 sm:p-8 lg:p-10 flex flex-col justify-center">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-6">
            <div className="w-14 h-14 bg-cg-green rounded-xl flex items-center justify-center mx-auto mb-3">
              <span className="text-black font-black text-2xl">CG</span>
            </div>
          </div>

          <h1 className="text-2xl font-black text-white mb-1">
            {step === 1 ? "Create your account" : "Set your password"}
          </h1>
          <p className="text-gray-400 text-sm mb-6">
            {step === 1 ? "Step 1 of 2 — Your identity" : "Step 2 of 2 — Secure your account"}
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          {/* Step 1: Name, Email, Phone */}
          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">Full Name</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                    placeholder="Your full name"
                    required
                    autoComplete="name"
                    id="register-name"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    id="register-email"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">
                  Phone Number <span className="text-gray-600">(optional)</span>
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                    placeholder="+91 XXXXXXXXXX"
                    autoComplete="tel"
                    id="register-phone"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-cg-green text-black py-3 rounded-xl font-bold text-sm hover:bg-cg-green-dark transition-all flex items-center justify-center gap-2 group"
              >
                Continue
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </form>
          )}

          {/* Step 2: Password */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-gray-500 hover:text-gray-300 mb-2"
              >
                ← Back to step 1
              </button>

              <div className="bg-cg-dark-3/50 rounded-lg px-3 py-2 flex items-center gap-2 text-sm border border-gray-800">
                <User size={14} className="text-cg-green" />
                <span className="text-gray-400">{form.name}</span>
                <span className="text-gray-600 mx-1">·</span>
                <span className="text-gray-500 text-xs truncate">{form.email}</span>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    className="w-full bg-cg-dark-3 border border-gray-700 rounded-xl pl-10 pr-10 py-3 text-white text-sm focus:border-cg-green focus:outline-none focus:ring-1 focus:ring-cg-green/30 transition-all"
                    placeholder="Min. 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    id="register-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {/* Password strength indicator */}
                {form.password.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          passwordStrength >= 100 ? "bg-cg-green" :
                          passwordStrength >= 66 ? "bg-yellow-400" :
                          "bg-red-400"
                        }`}
                        style={{ width: `${passwordStrength}%` }}
                      />
                    </div>
                    <div className="space-y-0.5">
                      {PASSWORD_REQUIREMENTS.map((req) => (
                        <p key={req.label} className={`text-[10px] flex items-center gap-1.5 ${req.test(form.password) ? "text-cg-green" : "text-gray-500"}`}>
                          {req.test(form.password) ? <CheckCircle2 size={10} /> : <span className="w-2.5 h-2.5 rounded-full border border-gray-600 block" />}
                          {req.label}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    className={`w-full bg-cg-dark-3 border rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:outline-none focus:ring-1 transition-all ${
                      form.confirmPassword.length > 0 && form.confirmPassword !== form.password
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500/30"
                        : form.confirmPassword.length > 0 && form.confirmPassword === form.password
                        ? "border-cg-green focus:border-cg-green focus:ring-cg-green/30"
                        : "border-gray-700 focus:border-cg-green focus:ring-cg-green/30"
                    }`}
                    placeholder="Repeat your password"
                    required
                    autoComplete="new-password"
                    id="register-confirm-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                id="register-submit"
                className="w-full bg-cg-green text-black py-3 rounded-xl font-bold text-sm hover:bg-cg-green-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Creating account...
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>

              <p className="text-xs text-gray-500 text-center">
                By creating an account, you agree to our{" "}
                <Link href="/legal/terms" className="text-cg-green hover:underline">Terms of Use</Link>
                {" "}and{" "}
                <Link href="/legal/privacy" className="text-cg-green hover:underline">Privacy Policy</Link>
              </p>
            </form>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-gray-700 flex-1" />
            <span className="text-xs text-gray-500">or sign up with</span>
            <div className="h-px bg-gray-700 flex-1" />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button className="flex items-center justify-center gap-2 bg-cg-dark-3 border border-gray-700 rounded-xl py-2.5 text-sm text-gray-300 hover:border-gray-500 hover:bg-gray-800 transition-all">
              <Chrome size={16} />
              Google
            </button>
          </div>

          <p className="text-center text-gray-400 text-sm mt-6">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-cg-green font-bold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
