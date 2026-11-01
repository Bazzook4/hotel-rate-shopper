"use client";

import { useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordRules";

export default function ResetPasswordPage() {
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [badLink, setBadLink] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.badLink) setBadLink(true);
        throw new Error(data?.error || "Password not changed. Please try again.");
      }
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const dead = badLink || token === "";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-ink/70">HMS | Online Hotelier</p>
          <h1 className="h1">Set a new password</h1>
        </div>

        {done ? (
          <>
            <p className="text-sm text-ink" role="status">Your password is changed. Sign in with the new one.</p>
            <a href="/login" className="btn btn-primary w-full">Sign in</a>
          </>
        ) : dead ? (
          <>
            <p className="text-sm text-[var(--danger)]" role="alert">
              {error || "This link is not complete. Ask for a new one."}
            </p>
            <a href="/forgot-password" className="btn btn-primary w-full">Ask for a new link</a>
          </>
        ) : (
          <>
            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">New password</span>
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="input"
              />
              <span className="block text-xs text-ink/70">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </label>
            <button type="button" className="btn btn-ghost w-full" onClick={() => setShow((s) => !s)}>
              {show ? "Hide password" : "Show password"}
            </button>
            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || token === null} className="btn btn-primary w-full">
              {loading ? "Saving..." : "Save new password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
