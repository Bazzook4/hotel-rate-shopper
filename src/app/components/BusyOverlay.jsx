"use client";

import { useEffect, useState } from "react";

/**
 * Holds the whole app still while a change is being saved.
 *
 * Every save in the app is a fetch to one of our own /api routes with a
 * method other than GET, so rather than each page tracking its own "saving"
 * flag -- and some forgetting to -- the browser's fetch is wrapped once here
 * and the screen is covered while any such request is in flight. A room
 * moved on the tape chart can then not be dragged again, or edited in the
 * modal, before the server has said where it actually is.
 *
 * A save is usually followed by a reload of what it changed, and the page is
 * only right once that reload lands. So requests of any method that start
 * while a save is running, or just after one finishes, are waited for too.
 *
 * Plain reads on their own -- loading a page, a live quote -- do not cover
 * the screen.
 */

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A save quicker than this blocks clicks without flashing a spinner. */
const SHOW_AFTER_MS = 250;

/** How long after the last request the screen stays held for its follow-up reload. */
const GRACE_MS = 300;

/** After this, the desk is told it is slow and may carry on regardless. */
const SLOW_AFTER_MS = 15000;

let active = 0;
let graceTimer = null;
const listeners = new Set();

function isBusy() {
  return active > 0 || graceTimer !== null;
}

function emit() {
  const busy = isBusy();
  for (const listener of listeners) listener(busy);
}

function begin() {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  active += 1;
  if (active === 1) emit();
}

function end() {
  active = Math.max(0, active - 1);
  if (active > 0) return;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (active === 0) emit();
  }, GRACE_MS);
}

/** Our own API call, and its method -- or null for anything else. */
function describe(input, init) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";

  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return null;
  }

  const method = (init?.method || (isRequest ? input.method : "GET")).toUpperCase();
  return { method };
}

function install() {
  if (window.fetch.__busyTracked) return;

  const original = window.fetch;
  const tracked = function (input, init) {
    const request = describe(input, init);
    const track = request && (WRITES.has(request.method) || isBusy());
    if (!track) return original.call(this, input, init);

    begin();
    let pending;
    try {
      pending = original.call(this, input, init);
    } catch (err) {
      end();
      throw err;
    }
    return pending.then(
      (res) => {
        end();
        return res;
      },
      (err) => {
        end();
        throw err;
      }
    );
  };
  tracked.__busyTracked = true;
  window.fetch = tracked;
}

export default function BusyOverlay() {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const [released, setReleased] = useState(false);

  useEffect(() => {
    install();
    listeners.add(setBusy);
    setBusy(isBusy());
    return () => listeners.delete(setBusy);
  }, []);

  useEffect(() => {
    if (!busy) {
      setShown(false);
      setSlow(false);
      setReleased(false);
      return;
    }
    const show = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const late = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(late);
    };
  }, [busy]);

  const holding = busy && !released;

  // Covering the screen stops clicks; keys are stopped too, or Enter in a
  // focused form would send the same save a second time.
  useEffect(() => {
    if (!holding) return;
    function stop(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [holding]);

  if (!holding) return null;

  return (
    <div
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        cursor: "progress",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: shown ? "color-mix(in srgb, var(--page) 55%, transparent)" : "transparent",
        transition: "background 150ms ease",
      }}
    >
      <style>{`
        @keyframes busy-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .busy-spinner { animation-duration: 2.4s !important; }
        }
      `}</style>
      {shown && (
        <div
          role="status"
          aria-live="polite"
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            boxShadow: "var(--shadow)",
            cursor: "default",
            maxWidth: 360,
          }}
        >
          <span
            className="busy-spinner"
            aria-hidden
            style={{
              width: 18,
              height: 18,
              flex: "none",
              borderRadius: "50%",
              border: "2px solid var(--border-strong)",
              borderTopColor: "var(--accent)",
              animation: "busy-spin 0.8s linear infinite",
            }}
          />
          <div style={{ fontSize: "0.875rem", color: "var(--text)" }}>
            {slow ? "Still working — this is taking longer than usual." : "Working…"}
            {slow && (
              <div style={{ marginTop: 6 }}>
                <button className="btn btn-ghost text-xs" onClick={() => setReleased(true)}>
                  Carry on without waiting
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
