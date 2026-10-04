"use client";

import { useEffect, useState } from "react";
import { EMPTY_PROFILE, ProfileFields } from "../dashboard/components/PropertyProfile";
import { profileGaps } from "@/lib/eventTags";

const labelClass = "text-xs font-semibold uppercase tracking-[0.2em] text-ink/70";

export default function OnboardPage() {
  const [token, setToken] = useState("");
  // "checking" until the link is validated, then "open" or "gone".
  const [linkState, setLinkState] = useState("checking");
  const [propertyName, setPropertyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    if (!t) {
      setLinkState("gone");
      return;
    }
    fetch(`/api/auth/onboard?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.propertyName) setPropertyName(data.propertyName);
        setLinkState("open");
      })
      .catch(() => setLinkState("gone"));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    const gaps = profileGaps(profile);
    if (gaps.length) {
      setError(`Still needed: ${gaps.join(", ")}.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, propertyName, email, password, profile }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 410) setLinkState("gone");
        throw new Error(data?.error || "Sign up failed");
      }
      window.location.href = "/";
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
        className="w-full max-w-lg space-y-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-ink/70">HMS · Online Hotelier</p>
          <h1 className="h1">Set up your hotel</h1>
          <p className="text-xs text-ink/70">
            Choose the email and password you will sign in with.
          </p>
        </div>

        {linkState === "checking" && <p className="sub text-center">Checking your link…</p>}

        {linkState === "gone" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-[var(--danger)]">
              This onboarding link has expired or has already been used.
            </p>
            <p className="text-xs text-ink/70">
              Ask us for a new one, or <a href="/login" className="underline">sign in</a> if
              you already have an account.
            </p>
          </div>
        )}

        {linkState === "open" && (
          <>
            <div className="space-y-4">
              <label className="block space-y-2 text-left">
                <span className={labelClass}>Hotel name</span>
                <input
                  type="text"
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  required
                  autoComplete="organization"
                  className="input"
                />
              </label>

              <div className="space-y-2 text-left">
                <span className={labelClass}>Where and what kind</span>
                <p className="text-xs text-ink/70">
                  So we can show you the festivals, holidays and events that fill hotels like yours.
                </p>
                <ProfileFields value={profile} onChange={setProfile} idPrefix="onboard" />
              </div>

              <label className="block space-y-2 text-left">
                <span className={labelClass}>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="input"
                />
              </label>

              <label className="block space-y-2 text-left">
                <span className={labelClass}>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="input"
                />
              </label>

              <label className="block space-y-2 text-left">
                <span className={labelClass}>Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="input"
                />
              </label>
            </div>

            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Creating your account…" : "Create account"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
