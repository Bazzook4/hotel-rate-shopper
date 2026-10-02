"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../components/Icon";
import { canOpenPage } from "../modules";
import { longDate, shortDate, useBookingOpener } from "./reportKit";

/**
 * Ctrl+K (⌘K on a Mac): go to any page, or find a booking by guest,
 * reference, email or phone, without first working out which page it is on.
 *
 * Stays mounted while closed, so a booking opened from it keeps its folio
 * open after the palette itself has gone.
 */

// The pages whose rights let someone read bookings -- the same list the
// reservations route checks.
const BOOKING_PAGES = ["calendar", "reservations", "nightaudit", "invoicing", "payments"];

const STATUS_LABEL = {
  inquiry: "Inquiry",
  confirmed: "Confirmed",
  in_house: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** A stay's date, with the year only when it is not this one -- a search reaches back years. */
function stayDate(iso) {
  if (!iso) return "–";
  return iso.slice(0, 4) === String(new Date().getFullYear()) ? shortDate(iso) : longDate(iso);
}

/** Does every word typed appear somewhere in the text? */
function matches(text, query) {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export default function CommandPalette({ open, onClose, areas, session, onOpenPage }) {
  const [query, setQuery] = useState("");
  const [bookings, setBookings] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const { openBooking, modal } = useBookingOpener(session);
  const propertyId = session?.propertyId || null;
  const canSeeBookings = BOOKING_PAGES.some((p) => canOpenPage(areas, p));

  // Each opening starts clean, with the cursor in the box.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setBookings([]);
    setCursor(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const pages = useMemo(() => {
    const all = areas.flatMap((a) => a.pages.map((p) => ({ ...p, area: a.label })));
    const q = query.trim();
    return q ? all.filter((p) => matches(`${p.label} ${p.area}`, q)) : all;
  }, [areas, query]);

  // Bookings are looked up once typing pauses. A slower earlier answer that
  // lands after a later one is dropped, so the list matches the box.
  useEffect(() => {
    // The search is put into a filter expression on the server, where commas
    // and brackets have meaning, so they are left out of it.
    const q = query.trim().replace(/[,()]/g, " ").trim();
    if (!open || !canSeeBookings || q.length < 2) {
      setBookings([]);
      setSearching(false);
      return undefined;
    }
    let stale = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ search: q });
        if (propertyId) qs.set("propertyId", propertyId);
        const res = await fetch(`/api/pms/reservations?${qs}`);
        const body = await res.json().catch(() => ({}));
        if (!stale) setBookings(res.ok ? (body.reservations || []).slice(0, 8) : []);
      } catch {
        if (!stale) setBookings([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, open, canSeeBookings, propertyId]);

  const items = useMemo(
    () => [
      ...pages.map((p) => ({ kind: "page", key: `p-${p.id}`, page: p })),
      ...bookings.map((b) => ({ kind: "booking", key: `b-${b.id}`, booking: b })),
    ],
    [pages, bookings]
  );

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function choose(item) {
    if (!item) return;
    onClose();
    if (item.kind === "page") onOpenPage(item.page.id);
    else openBooking(item.booking.id);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[cursor]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const firstBooking = pages.length;

  return (
    <>
      {open && (
        <div className="palette-backdrop" onMouseDown={onClose}>
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Go to a page or find a booking"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--text-faint)" }}>
                <Icon name="search" />
              </span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={canSeeBookings ? "Go to a page, or find a booking by guest, reference or phone" : "Go to a page"}
                className="w-full bg-transparent py-3 text-sm outline-none"
                style={{ color: "var(--text)" }}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[cursor] ? `palette-${items[cursor].key}` : undefined}
              />
              <span className="kbd">Esc</span>
            </div>

            <div id="palette-list" ref={listRef} role="listbox" className="overflow-y-auto py-1">
              {pages.length > 0 && (
                <p className="px-3 pb-1 pt-2 text-xs font-semibold" style={{ color: "var(--text-faint)" }}>
                  Pages
                </p>
              )}
              {items.map((item, i) => (
                <div key={item.key}>
                  {i === firstBooking && (
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold" style={{ color: "var(--text-faint)" }}>
                      Bookings
                    </p>
                  )}
                  <button
                    type="button"
                    id={`palette-${item.key}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === cursor}
                    className="palette-item"
                    onMouseMove={() => setCursor(i)}
                    onClick={() => choose(item)}
                  >
                    {item.kind === "page" ? (
                      <>
                        <Icon name={item.page.icon} />
                        <span className="flex-1">{item.page.label}</span>
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                          {item.page.area}
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon name="calendar" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{item.booking.guest_name}</span>
                          <span style={{ color: "var(--text-muted)" }}> · {item.booking.reference}</span>
                        </span>
                        <span className="whitespace-nowrap text-xs" style={{ color: "var(--text-faint)" }}>
                          {stayDate(item.booking.check_in)} – {stayDate(item.booking.check_out)} ·{" "}
                          {STATUS_LABEL[item.booking.status] || item.booking.status}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ))}

              {searching && (
                <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  Searching bookings…
                </p>
              )}
              {!searching && items.length === 0 && (
                <p className="px-3 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  Nothing matches “{query.trim()}”.
                  {canSeeBookings && query.trim().length < 2 ? " Type two letters or more to search bookings." : ""}
                </p>
              )}
            </div>

            <div
              className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs"
              style={{ borderTop: "1px solid var(--border)", color: "var(--text-faint)" }}
            >
              <span>
                <span className="kbd">↑</span> <span className="kbd">↓</span> move
              </span>
              <span>
                <span className="kbd">Enter</span> open
              </span>
            </div>
          </div>
        </div>
      )}
      {modal}
    </>
  );
}
