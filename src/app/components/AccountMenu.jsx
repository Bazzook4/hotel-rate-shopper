"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import RowMenu from "./RowMenu";
import { useEscape } from "./useEscape";
import { useToast } from "./Toast";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordRules";

/**
 * The top bar's Account button: changing your own password and signing out,
 * in one menu, so the bar keeps room on a phone for things used every day.
 */
export default function AccountMenu({ email }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Signed out or not, the login page is where this ends.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <RowMenu
        title={email || "Account"}
        buttonClass="btn btn-ghost flex-shrink-0 text-xs"
        label={
          <>
            <Icon name="user" size={16} />
            {/* The icon alone on a phone, like the theme button beside it. */}
            <span className="sr-only sm:not-sr-only">Account</span>
          </>
        }
        items={[
          { label: "Change password", onClick: () => setChanging(true) },
          { label: "Sign out", onClick: signOut },
        ]}
      />
      {changing && <PasswordWindow onClose={() => setChanging(false)} />}
    </>
  );
}

function PasswordWindow({ onClose }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Not while saving, or a failure would vanish with the window and leave
  // them unsure whether the password changed.
  const close = () => {
    if (!busy) onClose();
  };
  useEscape(close);

  // Said while typing, so the button never has to refuse.
  const hint =
    next && next.length < MIN_PASSWORD_LENGTH
      ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
      : again && again !== next
        ? "The two new passwords do not match."
        : null;
  const ready = current && next.length >= MIN_PASSWORD_LENGTH && again === next;

  // Typing again is the retry, so an old error goes as soon as they do.
  const typed = (set) => (e) => {
    set(e.target.value);
    setError(null);
  };

  async function save(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Password not changed. Please try again.");
      toast("Password changed.");
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <form
        className="dialog card"
        role="dialog"
        aria-modal="true"
        aria-label="Change your password"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Change your password
        </h3>
        <div className="mt-3 space-y-2">
          <div>
            <label className="label" htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              className="input w-full"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={current}
              onChange={typed(setCurrent)}
            />
          </div>
          <div>
            <label className="label" htmlFor="pw-next">New password</label>
            <input
              id="pw-next"
              className="input w-full"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={typed(setNext)}
            />
          </div>
          <div>
            <label className="label" htmlFor="pw-again">New password again</label>
            <input
              id="pw-again"
              className="input w-full"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={typed(setAgain)}
            />
          </div>
        </div>
        {(error || hint) && (
          <p className="mt-2 text-sm" style={{ color: error ? "var(--danger)" : "var(--text-muted)" }}>
            {error || hint}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary text-sm" disabled={!ready || busy}>
            {busy ? "Saving..." : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
