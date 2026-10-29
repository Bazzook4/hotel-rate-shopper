"use client";

import { useEffect } from "react";
import { formatMoney } from "@/lib/money";

/**
 * What the booking engine's guest pages share: the hotel's name at the top,
 * dates and money written the same way, and telling the hotel's website how
 * tall the page is, so the frame it sits in grows to fit and the guest never
 * scrolls inside a box.
 */

export function day(iso) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsOf(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000));
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function money(value, currency) {
  return formatMoney(value, { currency, decimals: 2 });
}

/** Tells a parent page (the hotel's website) how tall this page is. */
export function useFrameHeight() {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return undefined;
    const send = () => {
      window.parent.postMessage({ ohBookingHeight: document.documentElement.scrollHeight }, "*");
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
}

export function HotelHeader({ name, logoUrl, sub, right }) {
  return (
    <header className="flex items-center gap-3">
      {logoUrl && (
        <img
          src={logoUrl}
          alt=""
          width={96}
          height={44}
          onError={(e) => (e.currentTarget.style.display = "none")}
          style={{ height: 44, width: "auto", maxWidth: 96, objectFit: "contain", flexShrink: 0 }}
        />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="h1" style={{ overflowWrap: "break-word" }}>
          {name}
        </h1>
        {sub && <p className="sub text-xs uppercase tracking-wide">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Field({ label, error, required, wide, className = "", children }) {
  return (
    <label className={`block min-w-0 space-y-1 ${wide ? "sm:col-span-2" : ""} ${className}`}>
      <span className="label">
        {label}
        {required && <span style={{ color: "var(--danger)" }}> *</span>}
      </span>
      {children}
      {error && (
        <span className="block text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

export const OFFLINE = "No internet connection. Check your signal and try again.";

/** A fetch that answers with JSON or throws the server's message. */
export async function ask(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(OFFLINE);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || "Something went wrong. Please try again.");
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** The guest's last booking at this hotel, kept on their phone so they can get back to it. */
export const lastBookingKey = (key) => `oh-booking:${key}`;
