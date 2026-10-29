"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { HotelHeader, ask, day, lastBookingKey, money, plural, useFrameHeight } from "../../../kit";

/**
 * A guest's booking, from its private link: where the stay stands and, while
 * money is owed on a UPI booking, how to pay. On a phone the big button opens
 * the guest's UPI app with the hotel's ID and the amount already filled in;
 * on a computer the QR code is scanned with the phone. Either way the guest
 * then presses I have paid, adding the UPI reference if they have it, and
 * the hotel checks its bank.
 *
 * The money goes straight to the hotel; this page never sees it, so it can
 * only say what the guest and the hotel have told it.
 */

export default function GuestBooking() {
  const { key, token } = useParams();
  const [fresh, setFresh] = useState(false);
  useFrameHeight();
  useEffect(() => setFresh(new URLSearchParams(window.location.search).get("new") === "1"), []);

  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setView(await ask(`/api/book/status?token=${encodeURIComponent(token)}`));
      try {
        localStorage.setItem(lastBookingKey(key), token);
      } catch {}
    } catch (err) {
      setError(err.message);
    }
  }, [key, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function paid(e) {
    e.preventDefault();
    setBusy(true);
    setSaveError("");
    try {
      setView(
        await ask("/api/book/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, reference }),
        })
      );
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Copying can be refused inside an app's browser or a website's frame;
  // the ID is then selected, so a long press copies it.
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyUpi(e) {
    try {
      await navigator.clipboard.writeText(view.pay.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
      const box = e.currentTarget.parentElement.querySelector("input");
      box?.focus();
      box?.select();
    }
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-xl space-y-3 px-4 py-6 text-center">
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={load}>
            Try again
          </button>
          <a className="btn btn-ghost" href={`/book/${key}/my`}>
            Sign in
          </a>
        </div>
      </main>
    );
  }
  if (!view) return <p className="sub py-10 text-center">Opening your booking...</p>;

  const cancelled = view.status === "cancelled" || view.status === "no_show";
  const statusTone = cancelled ? "var(--danger)" : "var(--accent-text)";

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
      <HotelHeader
        name={view.hotel.name}
        logoUrl={view.hotel.logoUrl}
        sub="Your booking"
        right={
          <a className="btn btn-ghost text-sm" href={`/book/${key}`}>
            Book again
          </a>
        }
      />

      {fresh && !cancelled && (
        <p className="text-sm font-medium" style={{ color: "var(--accent-text)" }}>
          Your room is booked. Keep your booking number {view.reference} to see this page again.
        </p>
      )}

      <section className="card card-pad space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Booking {view.reference}
          </span>
          <span className="text-sm font-semibold" style={{ color: statusTone }}>
            {view.statusText}
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--text)" }}>
          {view.guestName}
          <br />
          {day(view.checkIn)} to {day(view.checkOut)}, {plural(view.nights, "night")}
          <br />
          {[view.roomType, view.ratePlan].filter(Boolean).join(", ")}
          {view.roomType ? ", " : ""}
          {plural(view.adults, "adult")}
          {view.children ? `, ${plural(view.children, "child", "children")}` : ""}
        </p>
        <div className="flex flex-wrap justify-between gap-2 pt-2 text-sm" style={{ borderTop: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-muted)" }}>
            Total {money(view.total, view.currency)}
            {view.paid > 0 ? `, paid ${money(view.paid, view.currency)}` : ""}
          </span>
          {!cancelled && <span style={{ color: "var(--text)" }}>{view.paymentText}</span>}
        </div>
      </section>

      {view.pay && (
        <section className="card card-pad space-y-3">
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Pay {money(view.pay.amount, view.currency)} by UPI
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            The money goes straight to {view.pay.payeeName}. Check that name in your UPI app before you pay.
          </p>

          <a className="btn btn-primary w-full justify-center sm:hidden" href={view.pay.link} target="_top">
            Pay with a UPI app
          </a>

          <div className="flex flex-wrap items-center gap-4">
            <div
              className="rounded p-2"
              style={{ width: 176, height: 176, background: "#fff", border: "1px solid var(--border)" }}
              role="img"
              aria-label="UPI QR code"
              dangerouslySetInnerHTML={{ __html: view.pay.qrSvg }}
            />
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p style={{ color: "var(--text-muted)" }}>Scan with any UPI app, or pay to:</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input font-mono font-medium"
                  style={{ width: `${Math.max(12, view.pay.upiId.length + 2)}ch`, maxWidth: "100%" }}
                  readOnly
                  value={view.pay.upiId}
                  onFocus={(e) => e.target.select()}
                  aria-label="Hotel UPI ID"
                />
                <button type="button" className="btn btn-secondary text-xs" onClick={copyUpi}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {copyFailed && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Press and hold the UPI ID to copy it.
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Add {view.reference} in the note, so the hotel can find your payment.
              </p>
            </div>
          </div>

          {view.paymentStatus === "guest_paid" ? (
            <p className="text-sm" style={{ color: "var(--text)" }}>
              Thank you. The hotel is checking its bank and will mark your payment received.
              {view.guestReference ? ` Your UPI reference: ${view.guestReference}.` : ""}
            </p>
          ) : (
            <form onSubmit={paid} className="space-y-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
              <label className="block space-y-1 pt-2">
                <span className="label">UPI reference (optional)</span>
                <input
                  className="input w-full"
                  inputMode="numeric"
                  placeholder="12-digit number from your UPI app"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Sending..." : "I have paid"}
              </button>
              {saveError && (
                <p className="text-sm" style={{ color: "var(--danger)" }}>
                  {saveError}
                </p>
              )}
            </form>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost text-sm" onClick={load}>
          Refresh
        </button>
        {view.hotel.phone && (
          <a className="btn btn-ghost text-sm" href={`tel:${view.hotel.phone.replace(/[^\d+]/g, "")}`}>
            Call the hotel
          </a>
        )}
      </div>
    </main>
  );
}
