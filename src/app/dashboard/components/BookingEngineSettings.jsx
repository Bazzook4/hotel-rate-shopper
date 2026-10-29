"use client";

import { useEffect, useState } from "react";
import { useToast } from "../../components/Toast";

/**
 * The hotel's booking engine, for Property Setup: on or off, the UPI ID guests
 * pay to, and whether they may pay at the hotel instead. Once saved, the page
 * link and the code to paste into the hotel's website, each with a Copy
 * button.
 */

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-1.5 text-sm" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/**
 * The code for the hotel's website: the booking page in a frame that grows
 * to fit it, so the guest never scrolls inside a box.
 */
function embedCode(url) {
  return [
    `<iframe id="oh-booking" src="${url}" title="Book a room" allow="clipboard-write" style="width:100%;min-height:760px;border:0" loading="lazy"></iframe>`,
    `<script>window.addEventListener("message",function(e){if(e.data&&e.data.ohBookingHeight){document.getElementById("oh-booking").style.height=e.data.ohBookingHeight+"px"}});</script>`,
  ].join("\n");
}

function CopyRow({ label, value, multiline }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`);
    } catch {
      toast("Could not copy. Select the text and copy it yourself.", { tone: "error" });
    }
  }
  return (
    <div className="space-y-1">
      <span className="label">{label}</span>
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea className="input w-full font-mono text-xs" rows={3} readOnly value={value} onFocus={(e) => e.target.select()} />
        ) : (
          <input className="input w-full" readOnly value={value} onFocus={(e) => e.target.select()} />
        )}
        <button type="button" className="btn btn-secondary text-sm" onClick={copy}>
          Copy
        </button>
      </div>
    </div>
  );
}

export default function BookingEngineSettings({ propertyId, canChange = true, onSaved }) {
  const [state, setState] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setPrefs(null);
    setError("");
    setNotice("");
    setLoadError("");
    fetch(`/api/setup/bookingEngine${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the booking engine settings.");
        if (cancelled) return;
        setState(json);
        setPrefs(json.prefs);
      })
      .catch((err) => {
        // No form to save over the hotel's real choices with defaults.
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, attempt]);

  const set = (patch) => {
    setNotice("");
    setPrefs((p) => ({ ...p, ...patch }));
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/setup/bookingEngine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertyId || undefined, prefs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the booking engine settings.");
      setState(json);
      setPrefs(json.prefs);
      onSaved?.(json);
      setNotice(json.prefs.enabled ? "Saved. Your booking page is open." : "Saved. Your booking page is closed to guests.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <h3 className="h2">Booking engine</h3>
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {loadError}
        </p>
        <button type="button" className="btn btn-secondary text-sm" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (!prefs) {
    return (
      <div className="card card-pad">
        <p className="sub">Loading...</p>
      </div>
    );
  }

  const off = !prefs.enabled || !canChange;
  const upiAllowed = !state || state.currency === "INR";
  const url = state?.key && typeof window !== "undefined" ? `${window.location.origin}/book/${state.key}` : null;

  return (
    <form onSubmit={save} className="card card-pad space-y-3">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="h2">Booking engine</h3>
          <Check checked={prefs.enabled} disabled={!canChange} onChange={(v) => set({ enabled: v })}>
            <span className="font-medium">Turn on</span>
          </Check>
        </div>
        <p className="sub">
          A booking page for your website. Guests see your free rooms and rates, book, and pay to your UPI ID. You check
          your bank and mark the payment received on the booking.
        </p>
      </div>

      <fieldset disabled={off} className="grid gap-3 sm:grid-cols-2" style={{ opacity: off ? 0.5 : 1 }}>
        <legend className="sr-only">How guests pay</legend>
        {upiAllowed ? (
          <>
            <label className="block space-y-1">
              <span className="label">Your UPI ID</span>
              <input
                className="input w-full"
                value={prefs.upiId}
                placeholder="hotelname@okaxis"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => set({ upiId: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="label">Name guests see when paying</span>
              <input
                className="input w-full"
                value={prefs.payeeName}
                placeholder="As on your bank account"
                onChange={(e) => set({ payeeName: e.target.value })}
              />
            </label>
          </>
        ) : (
          <p className="sub sm:col-span-2">UPI works for rupee hotels only, so guests pay at the hotel.</p>
        )}
        <label className="block space-y-1 sm:col-span-2">
          <span className="label">Note for guests (optional)</span>
          <input
            className="input w-full"
            value={prefs.note}
            maxLength={300}
            placeholder="Check-in from 12 noon. Free cancellation up to 2 days before arrival."
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Check checked={prefs.payAtHotel} disabled={off} onChange={(v) => set({ payAtHotel: v })}>
          Guests may also pay at the hotel
        </Check>
        {!canChange && <span className="sub">Only someone who may change property setup can change how guests pay.</span>}
        <button type="submit" className="btn btn-primary sm:ml-auto" disabled={busy || !canChange}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          {notice}
        </p>
      )}

      {url && state?.prefs?.enabled && (
        <div className="space-y-3 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <a className="btn btn-secondary text-sm" href={url} target="_blank" rel="noreferrer">
              Open booking page
            </a>
            <span className="sub">Share the link on WhatsApp or Instagram, or put the code on your website.</span>
          </div>
          <CopyRow label="Booking page link" value={url} />
          <CopyRow label="Code for your website" value={embedCode(url)} multiline />
        </div>
      )}
    </form>
  );
}
