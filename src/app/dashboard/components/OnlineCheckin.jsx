"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { whatsappCheckinLink } from "./frontDesk";
import { toCountryCode, countryName } from "@/lib/countries";
import { CHECKIN_ID_TYPES, CHECKIN_STATUS_LABELS, checkinUrl } from "@/lib/onlineCheckinShared";

/**
 * A booking's online check-in, in the booking window: send the guest their
 * link, see what they sent, and accept it into the guest records.
 *
 * The details are shown beside the photos of the ID so the desk can check
 * one against the other; nothing reaches the guest records until Accept.
 */

const STATUS_CHIP = {
  none: "chip-off",
  sent: "chip-off",
  opened: "chip-off",
  submitted: "chip-warn",
  accepted: "chip-ok",
};

const ID_LABEL = Object.fromEntries(CHECKIN_ID_TYPES.map((t) => [t.id, t.label]));

/** When something happened, for the panel's history. */
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : null;

async function call(method, body, reservationId) {
  const res = await fetch(
    method === "DELETE" ? `/api/pms/checkins?reservationId=${reservationId}` : "/api/pms/checkins",
    method === "DELETE"
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That did not work. Try again.");
  return data;
}

/** The booking's online check-in, loaded with the booking window. Null until loaded. */
export function useOnlineCheckin(reservationId) {
  const [data, setData] = useState(null);
  const reload = useCallback(async () => {
    if (!reservationId) return;
    try {
      const res = await fetch(`/api/pms/checkins?reservationId=${reservationId}`);
      const json = await res.json().catch(() => ({}));
      setData(res.ok ? json : null);
    } catch {
      setData(null);
    }
  }, [reservationId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, reload };
}

/** The link the guest opens, or null before one is made. */
export function onlineCheckinUrl(data) {
  return data?.checkin?.token && typeof window !== "undefined"
    ? checkinUrl(window.location.origin, data.checkin.token)
    : null;
}

/** Whether the booking window should offer online check-in for this booking. */
export function offersOnlineCheckin(data, reservation) {
  if (!data?.ready || !reservation) return false;
  if (data.checkin.status !== "none") return true;
  return data.enabled && (reservation.status === "confirmed" || reservation.status === "inquiry");
}

/** The status as a chip, for the booking window's status bar and the lists. */
export function CheckinChip({ status, onClick }) {
  if (!status || status === "none") return null;
  const label = `Online check-in: ${CHECKIN_STATUS_LABELS[status]}`;
  return onClick ? (
    <button type="button" className={`chip ${STATUS_CHIP[status]}`} onClick={onClick} title="Open online check-in">
      {label}
    </button>
  ) : (
    <span className={`chip ${STATUS_CHIP[status]}`}>{label}</span>
  );
}

/** "1985-03-12" as "12 Mar 1985". */
const date = (iso) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : null;

/**
 * One guest: what they typed on the left, the photos of their ID on the
 * right, so one is checked against the other at a glance.
 */
function Person({ g, index, canSeeIds }) {
  const id =
    g.id_type === "passport"
      ? `Passport ${g.id_number}`
      : g.id_type
        ? `${ID_LABEL[g.id_type] || "ID"} ${g.id_number}`
        : null;
  const files = g.files || [];
  const details = [
    g.phone,
    g.email,
    g.address,
    g.date_of_birth && `born ${date(g.date_of_birth)}`,
    g.passport_expiry && `passport until ${date(g.passport_expiry)}`,
    g.visa_number && `visa ${g.visa_number}${g.visa_expiry ? ` until ${date(g.visa_expiry)}` : ""}`,
    g.arrived_from && `from ${g.arrived_from}`,
    g.next_destination && `next ${g.next_destination}`,
    !files.length && "no ID photo sent",
    files.length > 0 && !canSeeIds && `${files.length} ID photo${files.length === 1 ? "" : "s"} (seeing them needs the Guests page)`,
  ].filter(Boolean);

  return (
    <div
      className="gap-3 sm:flex sm:items-start"
      style={{ borderTop: index ? "1px solid var(--border)" : undefined, paddingTop: index ? 8 : 0 }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-semibold">{g.full_name}</span>
          {[id, g.nationality && countryName(g.nationality)].filter(Boolean).map((x) => (
            <span key={x} style={{ color: "var(--text-muted)" }}>
              
              , {x}
            </span>
          ))}
        </div>
        {details.length > 0 && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {details.join(", ")}
          </div>
        )}
      </div>
      {files.length > 0 && canSeeIds && (
        <div className="mt-1 flex flex-wrap gap-2 sm:mt-0">
          {files.map((f, i) => (
            <a
              key={i}
              href={f.url || undefined}
              target="_blank"
              rel="noreferrer"
              title={`${f.name}: open full size`}
              className="card"
              style={{ padding: 4, width: 120, display: "block" }}
            >
              {f.type === "application/pdf" || !f.url ? (
                <div
                  className="flex items-center justify-center text-xs"
                  style={{ height: 72, background: "var(--surface-2)", borderRadius: 4 }}
                >
                  {f.type === "application/pdf" ? "PDF" : f.name}
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt={f.name} style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 4, display: "block" }} />
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OnlineCheckinPanel({ reservation, data, setData, session, onAccepted }) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shown only when the browser would not copy it, to be copied by hand.
  const [showLink, setShowLink] = useState(false);
  const c = data.checkin;
  const people = c.guests || [];
  const url = onlineCheckinUrl(data);
  const open = !c.closed;
  const ctx = { propertyName: session?.propertyName, countryCode: toCountryCode(session?.propertyCountry) };
  const hasPhone = Boolean(whatsappCheckinLink(reservation, { ...ctx, url: "x" }));

  async function run(job) {
    setBusy(true);
    setError("");
    try {
      return await job();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** The link, made now if there is none yet. */
  async function ensureLink() {
    if (url) return url;
    const next = await call("POST", { action: "create", reservationId: reservation.id });
    setData(next);
    return onlineCheckinUrl(next);
  }

  async function sendWhatsApp() {
    // Opened now, while the click still counts, or the browser blocks it as
    // a pop-up once the link has been made.
    const tab = window.open("", "_blank");
    const link = await run(ensureLink);
    if (!link) {
      tab?.close();
      return;
    }
    const wa = whatsappCheckinLink(reservation, { ...ctx, url: link });
    if (tab) tab.location.href = wa;
    else window.location.href = wa;
  }

  async function copy() {
    const link = await run(ensureLink);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast("Online check-in link copied");
    } catch {
      // Some browsers refuse after a wait; the link goes on screen instead.
      setShowLink(true);
      toast("Couldn't copy. Select the link below and copy it");
    }
  }

  async function switchOff() {
    const yes = await dialog.confirm({
      title: "Switch off this online check-in link?",
      message:
        c.status === "accepted"
          ? "The link stops working. The details already accepted stay on the guest records."
          : "The link stops working and anything the guest filled in through it is deleted. You can send a new link afterwards.",
      confirmLabel: "Switch off",
      danger: true,
    });
    if (!yes) return;
    const next = await run(() => call("DELETE", null, reservation.id));
    if (next) setData(next);
  }

  async function accept() {
    const next = await run(() => call("POST", { action: "accept", reservationId: reservation.id }));
    if (!next) return;
    setData(next);
    toast("Accepted. Details saved to the guest records");
    onAccepted?.();
  }

  const events = [
    c.createdAt && `link made ${when(c.createdAt)}`,
    c.openedAt && `opened ${when(c.openedAt)}`,
    c.submittedAt && `details sent ${when(c.submittedAt)}`,
    c.acceptedAt && `accepted ${when(c.acceptedAt)}`,
  ].filter(Boolean);

  return (
    <section className="card" style={{ padding: "0.75rem 0.9rem" }}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Online check-in
        </h4>
        <span className={`chip ${STATUS_CHIP[c.status]}`}>{CHECKIN_STATUS_LABELS[c.status]}</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} title={events.join("\n") || undefined}>
          {c.status === "none" ? "Guest fills in details + ID before arrival" : events[events.length - 1]}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {open && !hasPhone && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              No phone on booking
            </span>
          )}
          {open && (
            <>
              <button type="button" className="btn btn-secondary text-xs" disabled={busy || !hasPhone} onClick={sendWhatsApp}>
                Send on WhatsApp
              </button>
              <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={copy}>
                Copy link
              </button>
            </>
          )}
          {c.status !== "none" && (
            <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger)" }} disabled={busy} onClick={switchOff}>
              Switch off
            </button>
          )}
        </div>
      </div>

      {url && showLink && (
        <input
          className="input mt-2 w-full text-xs"
          readOnly
          autoFocus
          value={url}
          aria-label="Online check-in link"
          onFocus={(e) => e.target.select()}
        />
      )}

      {people.length > 0 && (
        <div className="mt-3 space-y-2">
          {people.map((g, i) => (
            <Person key={i} g={g} index={i} canSeeIds={data.canSeeIds} />
          ))}
          {(c.arrivalTime || c.requests) && (
            <div className="text-xs" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              {c.arrivalTime && <span>Arriving around {c.arrivalTime}. </span>}
              {c.requests && <span style={{ color: "var(--text-muted)" }}>&quot;{c.requests}&quot;</span>}
            </div>
          )}
        </div>
      )}

      {c.status === "submitted" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary text-sm" disabled={busy} onClick={accept}>
            {busy ? "Saving..." : "Accept into guest records"}
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Check against the ID first; the guest can edit until you accept.
          </span>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
