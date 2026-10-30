"use client";

import { useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import Icon from "./Icon";
import { ContactLine } from "./PropertyAdmin";
import { STATUS, statusOf, ago } from "./HotelUsage";
import { useEscape } from "./useEscape";
import { useSort, SortTh } from "../dashboard/components/useSort";
import { whatsappNumber } from "../dashboard/components/frontDesk";

/**
 * Super admin only: draft a WhatsApp message to a hotel asking whether they
 * have questions or where they are stuck, written around what that hotel has
 * actually done (set up, bookings, pages used, guides). Each message opened
 * in WhatsApp is saved with what the hotel had done by then and a note of
 * their reply (migration 062), so the next follow-up starts from the last.
 */

const DAY = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 7;
const TOP_PAGES = 4;

const KINDS = {
  questions: "Any questions",
  setup: "Stuck in setup",
  first_booking: "First booking",
  quiet: "Gone quiet",
};

// The message that fits a hotel's status best, picked first.
const KIND_FOR_STATUS = { setup: "setup", nobook: "first_booking", quiet: "quiet", active: "questions" };

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);

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

function draft(kind, hotel, a) {
  const name = hotel.contact_name ? hotel.contact_name.split(" ")[0] : "there";
  const toAdd = a.total_rooms && a.rooms < a.total_rooms ? a.total_rooms - a.rooms : 0;
  const ask = {
    questions:
      "Do you have any questions or queries about the app? If anything is stuck or not clear, just reply here and I will help.",
    setup: !a.room_types
      ? "It looks like the room setup has not been started yet. Where are you stuck? I can help you finish it on a short call."
      : `It looks like the room setup is not finished yet${toAdd ? `, with ${toAdd} rooms still to add` : ""}. Where are you stuck? I can help you finish it on a short call.`,
    first_booking:
      "Your rooms are ready, but no booking has been made yet. Is anything stopping you from making the first one? I can walk you through it.",
    quiet:
      "We have not seen you in the app for a while. Is something not working for you, or is anything missing that you need?",
  }[kind];
  return [
    `Hello ${name}, this is Online Hotelier support about ${hotel.name}.`,
    "",
    "Here is where your account is today:",
    ...activityLines(a).map((l) => `- ${l}`),
    "",
    ask,
    "",
    "Thank you",
  ].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function send(method, body) {
  const r = await fetch("/api/admin/followups", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not save");
  return j.row;
}

const SORT = {
  name: "name",
  status: (r) => STATUS[r.status].order,
  open: (r) => r.last_open,
  last: (r) => r.last_follow?.sent_at ?? "",
};

export default function FollowUps() {
  const [hotels, setHotels] = useState(null);
  const [follows, setFollows] = useState([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/usage").then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Could not load hotels");
        return j.rows;
      }),
      fetch("/api/admin/followups").then(async (r) => {
        const j = await r.json().catch(() => ({}));
        return r.ok ? { rows: j.rows } : { rows: [], missing: j.missing, error: j.error };
      }),
    ])
      .then(([rows, f]) => {
        if (cancelled) return;
        setHotels(rows.map((r) => ({ ...r, status: statusOf(r) })));
        setFollows(f.rows);
        if (f.missing) setMissing(true);
        else if (f.error) setError(f.error);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const last = new Map();
    for (const f of follows) if (!last.has(f.property_id)) last.set(f.property_id, f);
    return (hotels || []).map((h) => ({ ...h, last_follow: last.get(h.id) || null }));
  }, [hotels, follows]);

  const counts = useMemo(() => {
    const c = { never: 0, recent: 0, setup: 0, nobook: 0, quiet: 0 };
    for (const r of rows) {
      if (!r.last_follow) c.never += 1;
      else if (daysSince(r.last_follow.sent_at) < RECENT_DAYS) c.recent += 1;
      if (c[r.status] != null) c[r.status] += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    if (!filter) return rows;
    if (filter === "never") return rows.filter((r) => !r.last_follow);
    if (filter === "recent") return rows.filter((r) => r.last_follow && daysSince(r.last_follow.sent_at) < RECENT_DAYS);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  // Hotels that need a nudge first: not set up, no bookings, quiet, active.
  const sorter = useSort(shown, SORT, { key: "status", dir: "asc" });

  if (error && !hotels) {
    return (
      <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">
        {error}
      </div>
    );
  }
  if (!hotels) return <p className="sub">Loading...</p>;

  const pick = (key) => () => setFilter((f) => (f === key || key === "all" ? null : key));
  const on = (key) => (filter === key ? "ok" : undefined);
  const open = rows.find((r) => r.id === openId);

  return (
    <div className="space-y-3">
      {missing && (
        <div className="rounded-xl border border-[var(--warn)] px-4 py-2 text-sm" style={{ color: "var(--warn)" }}>
          Messages can be drafted, but are not saved yet: run migration 062.
        </div>
      )}
      {error && hotels && (
        <div className="rounded-xl border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)]">{error}</div>
      )}
      <Facts>
        <Fact label="Hotels" onClick={pick("all")}>{rows.length}</Fact>
        <Fact label="Never followed up" tone={on("never")} onClick={pick("never")}>{counts.never}</Fact>
        <Fact label={`Followed up, last ${RECENT_DAYS} days`} tone={on("recent")} onClick={pick("recent")}>{counts.recent}</Fact>
        <Fact label="Not set up" tone={on("setup")} onClick={pick("setup")}>{counts.setup}</Fact>
        <Fact label="No bookings" tone={on("nobook")} onClick={pick("nobook")}>{counts.nobook}</Fact>
        <Fact label="Quiet" tone={on("quiet")} onClick={pick("quiet")}>{counts.quiet}</Fact>
      </Facts>

      <div className="card">
        <table className="grid-table min-w-full text-sm">
          <thead>
            <tr>
              <SortTh sorter={sorter} col="name">Hotel</SortTh>
              <SortTh sorter={sorter} col="status">Status</SortTh>
              <SortTh sorter={sorter} col="open">Last opened</SortTh>
              <SortTh sorter={sorter} col="last">Last followed up</SortTh>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorter.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="block text-ink">{r.name}</span>
                  {r.city && <span className="block text-xs muted">{r.city}</span>}
                  {(r.contact_name || r.contact_phone) && (
                    <ContactLine name={r.contact_name} phone={r.contact_phone} />
                  )}
                </td>
                <td>
                  <span className={`chip ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                </td>
                <td className="muted">{ago(r.last_open)}</td>
                <td className="muted">
                  {r.last_follow ? (
                    <>
                      {ago(r.last_follow.sent_at)}
                      <span className="block text-xs">{KINDS[r.last_follow.kind] || r.last_follow.kind}</span>
                    </>
                  ) : (
                    "Never"
                  )}
                </td>
                <td className="text-right">
                  <button type="button" className="btn btn-secondary text-sm" onClick={() => setOpenId(r.id)}>
                    Follow up
                  </button>
                </td>
              </tr>
            ))}
            {sorter.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center sub">
                  No hotels here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <FollowUpPanel
          hotel={open}
          history={follows.filter((f) => f.property_id === open.id)}
          canSave={!missing}
          onSaved={(row) =>
            setFollows((all) => [row, ...all.filter((f) => f.id !== row.id)].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)))
          }
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function FollowUpPanel({ hotel, history, canSave, onSaved, onClose }) {
  useEscape(onClose);
  const [usage, setUsage] = useState(null);
  const [kind, setKind] = useState(KIND_FOR_STATUS[hotel.status]);
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [status, setStatus] = useState("");

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

  useEffect(() => {
    if (!edited) setMessage(draft(kind, hotel, activity));
  }, [kind, hotel, activity, edited]);

  const digits = whatsappNumber(hotel.contact_phone, "IN");
  const href = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;

  async function save() {
    if (!canSave) return;
    try {
      onSaved(await send("POST", { property_id: hotel.id, kind, message, activity }));
      setStatus("Saved to this hotel's follow-ups.");
    } catch (e) {
      setStatus(e.message);
    }
  }

  const chooseKind = (k) => {
    setKind(k);
    setEdited(false);
  };

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
              {Object.entries(KINDS).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"}
                  aria-pressed={kind === k}
                  onClick={() => chooseKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              className="input mt-2 w-full"
              rows={12}
              style={{ resize: "vertical" }}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setEdited(true);
              }}
            />
            {edited && (
              <button type="button" className="btn btn-ghost mt-1 text-sm" onClick={() => setEdited(false)}>
                Start again from the draft
              </button>
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
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-primary" onClick={save}>
              <Icon name="chat" size={16} />
              Open in WhatsApp
            </a>
          ) : (
            <span className="text-sm" style={{ color: "var(--warn)" }}>
              No contact mobile on this hotel.
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              const ok = await copyText(message);
              if (!ok) return setStatus("Could not copy. Select the message and copy it.");
              await save();
              setStatus((s) => (s.startsWith("Saved") ? "Copied and saved." : "Copied."));
            }}
          >
            Copy
          </button>
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
      onSaved(await send("PATCH", { id: item.id, note }));
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
