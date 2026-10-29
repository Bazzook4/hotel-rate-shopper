"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { HotelHeader, Field, ask, lastBookingKey, useFrameHeight } from "../../kit";

/**
 * Signing in to see a booking: the booking number and the mobile number or
 * email it was made with. No password to forget. A booking made on this
 * phone opens with one tap, without typing either.
 */
export default function MyBooking() {
  const { key } = useParams();
  const router = useRouter();
  useFrameHeight();

  const [hotel, setHotel] = useState(null);
  const [last, setLast] = useState(null);
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setLast(localStorage.getItem(lastBookingKey(key)));
    } catch {}
    ask(`/api/book?key=${encodeURIComponent(key)}`)
      .then(setHotel)
      .catch((err) => setError(err.message));
  }, [key]);

  async function signIn(e) {
    e.preventDefault();
    if (!reference.trim() || !contact.trim()) {
      setError("Enter your booking number and your mobile number or email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { token } = await ask("/api/book/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, reference, contact }),
      });
      router.push(`/book/${key}/b/${token}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
      <HotelHeader
        name={hotel?.name || ""}
        logoUrl={hotel?.logoUrl}
        sub="My booking"
        right={
          <a className="btn btn-ghost text-sm" href={`/book/${key}`}>
            Book a room
          </a>
        }
      />

      {last && (
        <a className="btn btn-secondary w-full justify-center" href={`/book/${key}/b/${last}`}>
          Open the booking made on this phone
        </a>
      )}

      <form onSubmit={signIn} className="card card-pad space-y-3">
        <Field label="Booking number">
          <input
            className="input w-full"
            placeholder="RS-ABC12"
            autoCapitalize="characters"
            spellCheck={false}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoFocus={!last}
          />
        </Field>
        <Field label="Mobile number or email">
          <input
            className="input w-full"
            autoComplete="tel"
            placeholder="As given when booking"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? "Opening..." : "See my booking"}
        </button>
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
