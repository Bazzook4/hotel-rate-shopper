"use client";

import { useEffect, useState } from "react";
import { isUpiId } from "@/lib/bookingEngineShared";
import { useToast } from "../../components/Toast";

/**
 * The Booking Engine's Link & payment tab: on or off, the UPI ID guests pay
 * to, whether they may pay at the hotel, a note for guests, and once saved
 * the ways to send guests to the page -- the link, a Book now button for the
 * hotel's website, and the full page to sit inside it.
 *
 * Started from what the page already loaded and kept on screen when another
 * tab is open, so nothing typed here is lost by looking at Rooms. Leaving
 * with it unsaved asks first, as the grids do.
 */

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-1.5 text-sm" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** The booking page in a frame on the hotel's website, growing to fit it. */
function embedCode(url) {
  return [
    `<iframe id="oh-booking" src="${url}" title="Book a room" allow="clipboard-write" style="width:100%;min-height:760px;border:0" loading="lazy"></iframe>`,
    `<script>window.addEventListener("message",function(e){if(e.data&&e.data.ohBookingHeight){document.getElementById("oh-booking").style.height=e.data.ohBookingHeight+"px"}});</script>`,
  ].join("\n");
}

const BUTTON_COLOURS = [
  { id: "#1d4ed8", label: "Blue" },
  { id: "#15803d", label: "Green" },
  { id: "#9f1239", label: "Maroon" },
  { id: "#111827", label: "Black" },
];

function buttonStyle(colour) {
  return {
    display: "inline-block",
    padding: "12px 24px",
    background: colour,
    color: "#fff",
    borderRadius: 8,
    font: "600 16px/1.2 system-ui, sans-serif",
    textDecoration: "none",
  };
}

/**
 * A Book now button for the hotel's website, or any page it can paste into:
 * a plain link styled as a button, which opens the booking page. Works on
 * every website builder, since it needs no script.
 */
function buttonCode(url, colour, label) {
  const safe = String(label || "Book now").replace(/[<>&"]/g, "");
  return `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:${colour};color:#fff;border-radius:8px;font:600 16px/1.2 system-ui,sans-serif;text-decoration:none">${safe}</a>`;
}

function CopyRow({ label, value, multiline, copyLabel = "Copy" }) {
  const toast = useToast();
  const [show, setShow] = useState(!multiline);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`);
    } catch {
      setShow(true);
      toast("Could not copy. Select the text and copy it yourself.", { tone: "error" });
    }
  }
  return (
    <div className="space-y-1">
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-start gap-2">
        {show &&
          (multiline ? (
            <textarea className="input w-full font-mono text-xs" rows={3} readOnly value={value} onFocus={(e) => e.target.select()} />
          ) : (
            <input className="input min-w-0 flex-1" readOnly value={value} onFocus={(e) => e.target.select()} />
          ))}
        <button type="button" className="btn btn-secondary text-sm" onClick={copy}>
          {copyLabel}
        </button>
        {multiline && !show && (
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setShow(true)}>
            Show code
          </button>
        )}
      </div>
    </div>
  );
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function BookingEngineSettings({ propertyId, initial, canChange = true, onSaved, hidden }) {
  const [saved, setSaved] = useState(initial.prefs);
  const [prefs, setPrefs] = useState(initial.prefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [colour, setColour] = useState(BUTTON_COLOURS[0].id);
  const [label, setLabel] = useState("Book now");
  const toast = useToast();
  const dirty = !same(prefs, saved);
  const upiAllowed = initial.currency === "INR";

  // Leaving with the payment details unsaved loses them otherwise.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch) => {
    setError("");
    setPrefs((p) => ({ ...p, ...patch }));
  };

  async function save(e) {
    e.preventDefault();
    if (prefs.upiId && !isUpiId(prefs.upiId)) {
      setError("That UPI ID does not look right. It is written like hotelname@okaxis.");
      return;
    }
    // The first save with a way to pay opens the page: nobody adds a UPI ID
    // meaning to keep it closed, and a forgotten tick is the usual reason
    // "it does not work".
    const sending = !initial.key && !prefs.enabled && (prefs.upiId || prefs.payAtHotel) ? { ...prefs, enabled: true } : prefs;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/setup/bookingEngine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertyId || undefined, prefs: sending }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the booking engine settings.");
      setPrefs(json.prefs);
      setSaved(json.prefs);
      onSaved?.(json);
      toast(json.prefs.enabled ? "Saved. Your booking page is open." : "Saved. Your booking page is closed to guests.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const url = initial.key && typeof window !== "undefined" ? `${window.location.origin}/book/${initial.key}` : null;
  const locked = !canChange;

  return (
    <div className="space-y-3" style={hidden ? { display: "none" } : undefined}>
      <form onSubmit={save} className="card card-pad space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="h2">How guests pay</h3>
          <Check checked={prefs.enabled} disabled={locked} onChange={(v) => set({ enabled: v })}>
            <span className="font-medium">Booking page open</span>
          </Check>
        </div>

        <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="flex items-end pb-2">
            <Check checked={prefs.payAtHotel} disabled={locked} onChange={(v) => set({ payAtHotel: v })}>
              Guests may also pay at the hotel
            </Check>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-0 flex-1 space-y-1">
            <span className="label">Note for guests (optional)</span>
            <input
              className="input w-full"
              value={prefs.note}
              maxLength={300}
              disabled={locked}
              placeholder="Check-in from 12 noon. Free parking."
              onChange={(e) => set({ note: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || locked || (!dirty && Boolean(initial.key))}>
            {busy ? "Saving..." : dirty || !initial.key ? "Save" : "Saved"}
          </button>
        </div>
        {locked && <p className="sub">Only someone who may change property setup can change how guests pay.</p>}
        {prefs.upiId && isUpiId(prefs.upiId) && (
          <p className="sub">Before you share the link, book a test stay and pay yourself 1 rupee, to check the money reaches you.</p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </form>

      {url && saved.enabled && (
        <section className="card card-pad space-y-4">
          <div>
            <h3 className="h2">Send guests to your booking page</h3>
            <p className="sub">Share the link on WhatsApp and Instagram, and put a Book now button on your website.</p>
          </div>
          <CopyRow label="Booking page link" value={url} copyLabel="Copy link" />

          <div className="space-y-2">
            <span className="label">Book now button for your website</span>
            <div className="flex flex-wrap items-center gap-3">
              <a href={url} target="_blank" rel="noreferrer" style={buttonStyle(colour)}>
                {label || "Book now"}
              </a>
              <div className="seg" role="radiogroup" aria-label="Button colour">
                {BUTTON_COLOURS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={colour === c.id}
                    className={colour === c.id ? "seg-on" : ""}
                    onClick={() => setColour(c.id)}
                  >
                    <span
                      aria-hidden="true"
                      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: c.id, marginRight: 6 }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
              <input
                className="input"
                style={{ width: "12rem" }}
                value={label}
                maxLength={30}
                onChange={(e) => setLabel(e.target.value)}
                aria-label="Button words"
              />
            </div>
            <p className="sub text-xs">
              The button takes guests straight to your booking page. Give the code to whoever looks after your website.
            </p>
            <CopyRow label="Button code" value={buttonCode(url, colour, label)} multiline copyLabel="Copy button code" />
          </div>

          <CopyRow label="Whole booking page inside your website" value={embedCode(url)} multiline copyLabel="Copy page code" />
        </section>
      )}
    </div>
  );
}
