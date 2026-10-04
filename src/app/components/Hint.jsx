"use client";

import { useEffect, useState } from "react";

/**
 * A how-to tip shown until the reader says they have it, then gone for good
 * on that browser. Instructions are worth reading once, not on every visit,
 * so they do not sit on the page as standing text.
 *
 * Starts hidden and appears once the browser has said it was not dismissed,
 * so a returning user never sees it flash up and vanish.
 */
export default function Hint({ id, className = "", children }) {
  const key = `hms.hint.${id}`;
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(key) !== "seen");
    } catch {
      setShow(true);
    }
  }, [key]);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(key, "seen");
    } catch {}
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm ${className}`}
      style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
      role="note"
    >
      <span className="flex-1">{children}</span>
      <button type="button" className="text-xs font-semibold" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
