"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Login failed");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-20%] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[420px] w-[420px] rounded-full bg-purple-500/20 blur-3xl" />
      </div>

      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-200/70">Rate Shopper</p>
          <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
          <p className="text-xs text-slate-200/70">
            Sign in to access your property dashboard.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block space-y-2 text-left">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder-slate-300/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm"
            />
          </label>

          <label className="block space-y-2 text-left">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder-slate-300/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm"
            />
          </label>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400 disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
