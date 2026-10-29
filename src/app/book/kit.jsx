"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/app/components/Icon";
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

/**
 * Photos full screen, one at a time: arrows or a swipe to move, the
 * keyboard's arrows and Escape on a computer, and small pictures along the
 * bottom to jump. Opened from a room's photo or the banner.
 */
export function Gallery({ photos, start = 0, title, onClose }) {
  const [at, setAt] = useState(start);
  const touch = useRef(null);
  const closeRef = useRef(null);
  const count = photos.length;
  const go = useCallback((step) => setAt((i) => (i + step + count) % count), [count]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    // The page behind stays put while the gallery is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);

  const arrow = (step, label, icon) =>
    count > 1 && (
      <button
        type="button"
        onClick={() => go(step)}
        aria-label={label}
        className="absolute top-1/2 -translate-y-1/2 rounded-full"
        style={{
          [step < 0 ? "left" : "right"]: 12,
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.35)",
          color: "#fff",
        }}
      >
        <Icon name={icon} size={22} />
      </button>
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} photos`}
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 100, background: "rgba(0,0,0,0.92)", color: "#fff" }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 truncate">
          {title}
          {count > 1 ? `, ${at + 1} of ${count}` : ""}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close photos"
          className="rounded-full"
          style={{ width: 40, height: 40, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.15)", color: "#fff" }}
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photos[at]}
          src={photos[at]}
          alt={`${title}, photo ${at + 1} of ${count}`}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", userSelect: "none" }}
          draggable={false}
        />
        {arrow(-1, "Previous photo", "left")}
        {arrow(1, "Next photo", "right")}
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-1.5 overflow-x-auto px-4 py-3">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === at}
              className="shrink-0 rounded"
              style={{ padding: 0, border: i === at ? "2px solid #fff" : "2px solid transparent", opacity: i === at ? 1 : 0.6 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="block rounded" style={{ width: 64, height: 48, objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
