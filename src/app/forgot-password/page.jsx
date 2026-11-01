"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not send the email. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-ink/70">HMS | Online Hotelier</p>
          <h1 className="h1">Forgot password</h1>
        </div>

        {sent ? (
          <p className="text-sm text-ink" role="status">
            If {email} has a login, a link to set a new password is on its way. It lasts one hour. Check your spam folder too.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink/70">Type your login email and we will send you a link to set a new password.</p>
            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="input"
              />
            </label>
            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Sending..." : "Send me a link"}
            </button>
            <p className="text-center text-xs text-ink/70">No access to this email? Ask your hotel admin to reset your password.</p>
          </>
        )}

        <a href="/login" className="btn btn-ghost w-full">
          Back to sign in
        </a>
      </form>
    </div>
  );
}
