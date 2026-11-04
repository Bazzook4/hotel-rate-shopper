"use client";

import { useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import Icon from "./Icon";
import { ContactLine } from "./PropertyAdmin";
import { STATUS, ago } from "./HotelUsage";
import Select from "./Select";
import { useEscape } from "./useEscape";
import { whatsappNumber } from "../dashboard/components/frontDesk";

/**
 * Super admin only, opened from Admin > Usage: draft a WhatsApp message to a hotel asking whether they
 * have questions or where they are stuck, written around what that hotel has
 * actually done (set up, bookings, pages used, guides). Each message opened
 * in WhatsApp is saved with what the hotel had done by then and a note of
 * their reply (migration 062), so the next follow-up starts from the last.
 */

const TOP_PAGES = 4;

// What can be sent now: two approved templates and a typed message.
export const SEND_KINDS = {
  setup_reminder: "Setup reminder",
  no_bookings: "No bookings lately",
  custom: "Custom message",
};

// Every kind ever kept, for the history; the last four were typed drafts.
export const KINDS = {
  ...SEND_KINDS,
  questions: "Any questions",
  setup: "Stuck in setup",
  first_booking: "First booking",
  quiet: "Gone quiet",
};

// The template that fits a hotel's status best, picked first.
const KIND_FOR_STATUS = { setup: "setup_reminder" };

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const list = (items) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** What the hotel has done, as kept with each follow-up. */
function activityOf(hotel, usage) {
  const pages = (usage?.pages || [])
    .filter((p) => p.opens > 0)
    .sort((a, b) => b.opens - a.opens)
    .slice(0, TOP_PAGES)
    .map((p) => ({ label: p.label, opens: p.opens }));
  const tours = usage?.tours || [];
  return {
    status: hotel.status,
    signed_up: hotel.created_at,
    room_types: hotel.room_types ?? 0,
    rooms: hotel.rooms ?? 0,
    total_rooms: hotel.total_rooms ?? null,
    bookings: hotel.bookings,
    desk_bookings: hotel.desk_bookings,
    bookings_30: hotel.bookings_30,
    last_booking: hotel.last_booking,
    last_open: hotel.last_open,
    opens_7: hotel.opens_7,
    pages: usage ? pages : null,
    guides_done: tours.filter((t) => t.done > 0).map((t) => t.title),
    guides_quit: tours.filter((t) => t.quit > 0 && !t.done).map((t) => t.title),
    help_asked: usage?.totals?.help ?? 0,
  };
}

/** The activity in plain sentences, for the panel and the message alike. */
function activityLines(a) {
  const lines = [];
  if (a.signed_up) lines.push(`Signed up on ${shortDate(a.signed_up)}.`);
  if (!a.room_types) lines.push("No room types set up yet.");
  else {
    const of = a.total_rooms ? ` of ${a.total_rooms}` : "";
    lines.push(`${a.room_types} room type${a.room_types === 1 ? "" : "s"} and ${a.rooms}${of} rooms set up.`);
  }
  if (!a.bookings) lines.push("No bookings made yet.");
  else {
    const desk = a.desk_bookings ? `, ${a.desk_bookings} at the desk` : "";
    lines.push(
      `${a.bookings} booking${a.bookings === 1 ? "" : "s"} made${desk}, the last one ${ago(a.last_booking).toLowerCase()}.`
    );
  }
  lines.push(a.last_open ? `Last opened the app ${ago(a.last_open).toLowerCase()}.` : "Has not opened the app yet.");
  if (a.pages?.length) lines.push(`Pages used most: ${list(a.pages.map((p) => p.label))}.`);
  if (a.guides_done.length) lines.push(`Finished the guide${a.guides_done.length === 1 ? "" : "s"} ${list(a.guides_done)}.`);
  if (a.guides_quit.length) lines.push(`Left part way through ${list(a.guides_quit)}.`);
  return lines;
}

/** What a WhatsApp plan (migration 070) sends each morning. */
export const PLAN_KINDS = {
  daily_report: "Daily report",
  reminder: "Reminder",
};

const PLAN_DAYS = [3, 5, 7, 14, 30];

/** A plan in a few words: "Reminder, day 2 of 7". */
export function planLabel(plan) {
  if (!plan) return null;
  return `${PLAN_KINDS[plan.kind] || plan.kind}, day ${plan.sent} of ${plan.days}`;
}

/** Why the last morning message failed, in plain words. */
export function planError(message) {
  if (!message) return null;
  if (/131026|not a valid whatsapp|undeliverable|recipient/i.test(message)) return "This number is not on WhatsApp";
  if (/131049|ecosystem|healthy/i.test(message)) return "WhatsApp held it back, will try tomorrow";
  if (/template|132\d{3}/i.test(message)) return "The message template was refused";
  if (/not connected/i.test(message)) return "WhatsApp is not connected";
  return "Could not send";
}

/** The message type that fits a hotel: the report once it is busy, else a reminder. */
export const planKindFor = (status) => (status === "active" ? "daily_report" : "reminder");

export async function savePlans(method, body) {
  const r = await fetch("/api/admin/wa-schedules", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not save");
  return j.rows;
}

/**
 * Start or stop the morning WhatsApp for one hotel or many: what to send
 * and for how many days. The reminder asks about setup or bookings,
 * whichever the hotel needs, and stops once it needs neither.
 */
export function PlanControls({ ids, live, defaultKind = "reminder", onSaved, disabled }) {
  const [kind, setKind] = useState(defaultKind);
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => setKind(defaultKind), [defaultKind]);

  const hotels = `${ids.length} hotel${ids.length === 1 ? "" : "s"}`;

  async function run(method, body, said) {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const rows = await savePlans(method, body);
      setDone(said);
      onSaved(rows, said);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }} aria-label="What to send">
        {Object.entries(PLAN_KINDS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      <span>every morning for</span>
      <Select value={days} onChange={(e) => setDays(e.target.value)} style={{ width: "auto" }} aria-label="How many days">
        {PLAN_DAYS.map((d) => (
          <option key={d} value={String(d)}>
            {d} days
          </option>
        ))}
      </Select>
      <button
        type="button"
        className="btn btn-primary text-sm"
        disabled={disabled || busy}
        title={live ? "Ends the plan running now and starts again from day 1" : undefined}
        onClick={() =>
          run(
            "POST",
            { property_ids: ids, kind, days: Number(days) },
            `${PLAN_KINDS[kind]} starts tomorrow 8 AM for ${hotels}, ${days} days.`
          )
        }
      >
        {live ? "Restart" : "Start"}
      </button>
      {live && (
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={disabled || busy}
          onClick={() => run("DELETE", { property_ids: ids }, `Stopped for ${hotels}.`)}
        >
          Stop
        </button>
      )}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      {done && !error && <span className="text-xs muted">{done}</span>}
    </div>
  );
}

async function send(method, body) {
  const r = await fetch("/api/admin/followups", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not save");
  return j;
}

export function FollowUpPanel({ hotel, history, canSave, onSaved, plan, plansReady, onPlans, onClose }) {
  useEscape(onClose);
  const [usage, setUsage] = useState(null);
  const [kind, setKind] = useState(KIND_FOR_STATUS[hotel.status] || "no_bookings");
  const [words, setWords] = useState(null);
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  // Pages and guides from the last 90 days; without them the draft still works.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/usage/events?days=90&property=${hotel.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => !cancelled && setUsage(j || {}));
    return () => {
      cancelled = true;
    };
  }, [hotel.id]);

  const activity = useMemo(() => activityOf(hotel, usage && usage.pages ? usage : null), [hotel, usage]);

  // What each template would say to this hotel.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/followups?preview=${hotel.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => !cancelled && setWords(j?.templates || {}));
    return () => {
      cancelled = true;
    };
  }, [hotel.id]);

  const isCustom = kind === "custom";
  const message = isCustom ? custom : words?.[kind] || "";

  const digits = whatsappNumber(hotel.contact_phone, "IN");

  // Sends on the business WhatsApp number.
  async function sendNow() {
    setSending(true);
    setStatus("");
    try {
      const j = await send("POST", { property_id: hotel.id, kind, message, activity, send: true });
      onSaved(j.row);
      setStatus("Sent.");
    } catch (e) {
      setStatus(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={onClose} className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={`Follow up ${hotel.name}`}>
      <div className="side-panel flex flex-col" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent-strong)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>Follow up: {hotel.name}</h3>
          <button type="button" className="head-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="card-pad flex-1 space-y-4">
          <Facts>
            <Fact label="Status">{STATUS[hotel.status].label}</Fact>
            <Fact label="Contact">{hotel.contact_name || "-"}</Fact>
            <Fact label="Mobile" tone={digits ? undefined : "warn"}>{hotel.contact_phone || "None"}</Fact>
          </Facts>

          <div>
            <div className="label">Morning WhatsApp</div>
            <p className="mt-1 text-sm">
              {!plan ? "None sent yet." : plan.stopped_at ? `Ended: ${plan.stop_reason || "stopped"}. ${planLabel(plan)}.` : planLabel(plan)}
              {plan?.last_error && (
                <span className="block text-xs text-[var(--danger)]">Last one failed: {planError(plan.last_error)}</span>
              )}
            </p>
            <div className="mt-2">
              {plansReady ? (
                digits ? (
                  <PlanControls
                    ids={[hotel.id]}
                    live={Boolean(plan && !plan.stopped_at)}
                    defaultKind={planKindFor(hotel.status)}
                    onSaved={onPlans}
                  />
                ) : (
                  <span className="text-sm" style={{ color: "var(--warn)" }}>Add a contact mobile to send these.</span>
                )
              ) : (
                <span className="text-sm muted">Run migration 070 to switch these on.</span>
              )}
            </div>
          </div>

          <div>
            <div className="label">What they have done</div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {activityLines(activity).map((l) => (
                <li key={l}>{l}</li>
              ))}
              {!usage && <li className="muted">Loading pages and guides...</li>}
            </ul>
          </div>

          <div>
            <div className="label">Message</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(SEND_KINDS).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {isCustom ? (
              <>
                <textarea
                  className="input mt-2 w-full"
                  rows={8}
                  style={{ resize: "vertical" }}
                  placeholder="Type your message"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <p className="mt-1 text-xs muted">
                  WhatsApp delivers a typed message only if they wrote to you in the last 24 hours. Otherwise use a template.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 whitespace-pre-wrap rounded-xl border border-[var(--border)] p-3 text-sm">
                  {words ? message : "Loading..."}
                </p>
                <p className="mt-1 text-xs muted">An approved WhatsApp template. It always reaches them.</p>
              </>
            )}
          </div>

          <div>
            <div className="label">Earlier follow-ups</div>
            {history.length === 0 ? (
              <p className="sub mt-1 text-sm">None yet.</p>
            ) : (
              <div className="mt-1 space-y-2">
                {history.map((f) => (
                  <HistoryItem key={f.id} item={f} onSaved={onSaved} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="side-panel-foot card-pad flex flex-wrap items-center gap-2">
          {digits ? (
            <button type="button" className="btn btn-primary" disabled={sending || !canSave || !message.trim()} onClick={sendNow}>
              <Icon name="chat" size={16} />
              {sending ? "Sending..." : "Send on WhatsApp"}
            </button>
          ) : (
            <span className="text-sm" style={{ color: "var(--warn)" }}>
              No contact mobile on this hotel.
            </span>
          )}
          {status && <span className="text-xs muted">{status}</span>}
        </div>
      </div>
    </div>
  );
}

function HistoryItem({ item, onSaved }) {
  const [note, setNote] = useState(item.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = note.trim() !== (item.note || "");

  async function saveNote() {
    setBusy(true);
    setError("");
    try {
      onSaved((await send("PATCH", { id: item.id, note })).row);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink">
          {shortDate(item.sent_at)}: {KINDS[item.kind] || item.kind}
        </span>
        {item.sent_by && <span className="text-xs muted">{item.sent_by}</span>}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs muted">Message sent</summary>
        <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ fontFamily: "inherit" }}>
          {item.message}
        </pre>
      </details>
      <div className="mt-2 flex items-start gap-2">
        <textarea
          className="input w-full"
          rows={2}
          style={{ resize: "vertical" }}
          placeholder="What they said, or where they are stuck"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="btn btn-secondary text-sm" disabled={!changed || busy} onClick={saveNote}>
          Save note
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
