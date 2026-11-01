"use client";

import { useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import { ContactLine } from "./PropertyAdmin";
import { useSort, SortTh } from "../dashboard/components/useSort";
import { inr } from "../dashboard/components/WalletPanel";
import PageUsage from "./PageUsage";
import { FollowUpPanel, KINDS, PlanControls, planError, planKindFor, planLabel } from "./FollowUps";
import Hint from "./Hint";
import { whatsappNumber } from "../dashboard/components/frontDesk";

/**
 * Super admin only: every onboarded hotel with what it has set up, the
 * bookings it has made and when its staff last opened the app, so new
 * sign-ups that stalled and hotels that went quiet stand out for a call.
 *
 * Each row also shows the last follow-up (migration 062) and its morning
 * WhatsApp plan (migration 070). Follow up opens the message panel; ticked
 * hotels can be given a plan together.
 */

const DAY = 24 * 60 * 60 * 1000;
const QUIET_DAYS = 14;

export const STATUS = {
  setup: { label: "Not set up", chip: "chip-warn", order: 0 },
  nobook: { label: "No bookings", chip: "chip-warn", order: 1 },
  quiet: { label: "Quiet", chip: "chip-off", order: 2 },
  active: { label: "Active", chip: "chip-ok", order: 3 },
};

const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);

export function statusOf(r) {
  if (!r.room_types || !r.rooms) return "setup";
  if (!r.bookings) return "nobook";
  const open = daysAgo(r.last_open);
  if ((open == null || open > QUIET_DAYS) && !r.bookings_30) return "quiet";
  return "active";
}

export function ago(iso) {
  const d = daysAgo(iso);
  if (d == null) return "Never";
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const SORT = {
  name: "name",
  signed: (r) => r.created_at,
  rooms: "rooms",
  b30: "bookings_30",
  all: "bookings",
  open: (r) => r.last_open,
  status: (r) => STATUS[r.status].order,
  follow: (r) => r.last_follow?.sent_at ?? "",
  plan: (r) => (r.plan && !r.plan.stopped_at ? 1 : 0),
};

const RECENT_DAYS = 7;

/** A list from one of the admin routes, or why it could not load. */
async function load(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  return r.ok ? { rows: j.rows || [] } : { rows: [], missing: Boolean(j.missing), error: j.error || "Could not load" };
}

export default function HotelUsage() {
  const [hotels, setHotels] = useState(null);
  const [follows, setFollows] = useState([]);
  const [plans, setPlans] = useState([]);
  const [followsReady, setFollowsReady] = useState(true);
  const [plansReady, setPlansReady] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  // Hotels, or how pages and help are used (PageUsage.jsx).
  const [view, setView] = useState("hotels");

  useEffect(() => {
    let cancelled = false;
    Promise.all([load("/api/admin/usage"), load("/api/admin/followups"), load("/api/admin/wa-schedules")]).then(
      ([u, f, w]) => {
        if (cancelled) return;
        if (u.error) return setError(u.error);
        setHotels(u.rows.map((r) => ({ ...r, status: statusOf(r) })));
        setFollows(f.rows);
        setPlans(w.rows);
        setFollowsReady(!f.missing);
        setPlansReady(!w.missing);
        const other = [f, w].find((x) => x.error && !x.missing);
        if (other) setNote(other.error);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const last = new Map();
    for (const f of follows) if (!last.has(f.property_id)) last.set(f.property_id, f);
    const plan = new Map(plans.map((p) => [p.property_id, p]));
    return (hotels || []).map((h) => ({ ...h, last_follow: last.get(h.id) || null, plan: plan.get(h.id) || null }));
  }, [hotels, follows, plans]);

  const counts = useMemo(() => {
    const c = { all: 0, new: 0, setup: 0, nobook: 0, quiet: 0, active: 0, never: 0, recent: 0, plan: 0 };
    for (const r of rows) {
      c.all += 1;
      c[r.status] += 1;
      if (daysAgo(r.created_at) <= 30) c.new += 1;
      if (!r.last_follow) c.never += 1;
      else if (daysAgo(r.last_follow.sent_at) < RECENT_DAYS) c.recent += 1;
      if (r.plan && !r.plan.stopped_at) c.plan += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    if (!filter) return rows;
    if (filter === "new") return rows.filter((r) => daysAgo(r.created_at) <= 30);
    if (filter === "never") return rows.filter((r) => !r.last_follow);
    if (filter === "recent") return rows.filter((r) => r.last_follow && daysAgo(r.last_follow.sent_at) < RECENT_DAYS);
    if (filter === "plan") return rows.filter((r) => r.plan && !r.plan.stopped_at);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const sorter = useSort(shown, SORT);

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">
        {error}
      </div>
    );
  }
  if (!hotels) return <p className="sub">Loading...</p>;

  const switcher = (
    <div className="flex gap-2">
      {[
        ["hotels", "Hotels"],
        ["pages", "Pages & help"],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={view === id ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"}
          aria-pressed={view === id}
          onClick={() => setView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  if (view === "pages") {
    return (
      <div className="space-y-3">
        {switcher}
        <PageUsage hotels={rows} />
      </div>
    );
  }

  // A new filter starts with nothing ticked, so a send only goes to hotels in view.
  const pick = (key) => () => {
    setPicked(new Set());
    setFilter((f) => (f === key || key === "all" ? null : key));
  };
  const on = (key) => (filter === key ? "ok" : undefined);
  const open = rows.find((r) => r.id === openId);

  // Only hotels with a usable mobile can be given a plan.
  const canPlan = (r) => Boolean(whatsappNumber(r.contact_phone, "IN"));
  const pickable = sorter.rows.filter(canPlan);
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(pickable.map((r) => r.id)));
  const pickedIds = [...picked].filter((id) => rows.some((r) => r.id === id));
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const pickedLive = pickedRows.some((r) => r.plan && !r.plan.stopped_at);
  const pickedKind = pickedRows.length && pickedRows.every((r) => r.status === "active") ? "daily_report" : "reminder";

  const mergePlans = (changed) =>
    setPlans((all) => [...changed, ...all.filter((p) => !changed.some((c) => c.property_id === p.property_id))]);
  const mergeFollow = (row) =>
    setFollows((all) => [row, ...all.filter((f) => f.id !== row.id)].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)));

  return (
    <div className="space-y-3">
      {switcher}
      {!followsReady && (
        <div className="rounded-xl border border-[var(--warn)] px-4 py-2 text-sm" style={{ color: "var(--warn)" }}>
          Follow-up messages can be drafted, but are not saved yet: run migration 062.
        </div>
      )}
      {note && <div className="rounded-xl border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)]">{note}</div>}
      <Facts>
        <Fact label="Hotels" onClick={pick("all")}>{counts.all}</Fact>
        <Fact label="New, last 30 days" tone={on("new")} onClick={pick("new")}>{counts.new}</Fact>
        <Fact label="Active" tone={on("active")} onClick={pick("active")}>{counts.active}</Fact>
        <Fact label="Quiet" tone={on("quiet")} onClick={pick("quiet")}>{counts.quiet}</Fact>
        <Fact label="No bookings" tone={on("nobook")} onClick={pick("nobook")}>{counts.nobook}</Fact>
        <Fact label="Not set up" tone={on("setup")} onClick={pick("setup")}>{counts.setup}</Fact>
        <Fact label="Never followed up" tone={on("never")} onClick={pick("never")}>{counts.never}</Fact>
        <Fact label={`Followed up, last ${RECENT_DAYS} days`} tone={on("recent")} onClick={pick("recent")}>{counts.recent}</Fact>
        <Fact label="Morning WhatsApp" tone={on("plan")} onClick={pick("plan")}>{counts.plan}</Fact>
      </Facts>
      <p className="text-xs muted">
        Bookings are counted by the day they were made, without cancellations. Desk means made in
        the app, not from a channel. Quiet means no booking in 30 days and nobody from the hotel
        has opened the app in {QUIET_DAYS} days.
      </p>
      <Hint id="usage-morning-whatsapp">
        Tick hotels to send them a WhatsApp every morning at 8 AM for the days you pick. The daily report shows
        their day at a glance. The reminder asks about setup or bookings, whichever the hotel needs, and stops
        once it needs neither.
      </Hint>

      {pickedIds.length > 0 && (
        <div className="card card-pad flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink">
            {pickedIds.length} hotel{pickedIds.length === 1 ? "" : "s"} ticked
          </span>
          {plansReady ? (
            <PlanControls
              ids={pickedIds}
              live={pickedLive}
              defaultKind={pickedKind}
              onSaved={(changed) => {
                mergePlans(changed);
                setPicked(new Set());
              }}
            />
          ) : (
            <span className="text-sm muted">Run migration 070 to send morning WhatsApp.</span>
          )}
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setPicked(new Set())}>
            Untick all
          </button>
        </div>
      )}

      <div className="card">
        <table className="grid-table min-w-full text-sm">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Tick all hotels with a mobile" />
              </th>
              <SortTh sorter={sorter} col="name">Hotel</SortTh>
              <SortTh sorter={sorter} col="signed">Signed up</SortTh>
              <SortTh sorter={sorter} col="rooms">Rooms</SortTh>
              <SortTh sorter={sorter} col="b30">Last 30 days</SortTh>
              <SortTh sorter={sorter} col="all">All bookings</SortTh>
              <SortTh sorter={sorter} col="open">Last opened</SortTh>
              <SortTh sorter={sorter} col="status">Status</SortTh>
              <SortTh sorter={sorter} col="follow">Followed up</SortTh>
              <SortTh sorter={sorter} col="plan">Morning WhatsApp</SortTh>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorter.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {canPlan(r) ? (
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Tick ${r.name}`} />
                  ) : (
                    <span className="text-xs muted">No mobile</span>
                  )}
                </td>
                <td>
                  <span className="block text-ink">{r.name}</span>
                  {r.city && <span className="block text-xs muted">{r.city}</span>}
                  {(r.contact_name || r.contact_phone) && (
                    <ContactLine name={r.contact_name} phone={r.contact_phone} />
                  )}
                </td>
                <td className="muted">
                  {r.created_at ? shortDate(r.created_at) : "-"}
                </td>
                <td>
                  {r.rooms ?? "-"}
                  {r.total_rooms ? <span className="muted"> of {r.total_rooms}</span> : null}
                  <span className="block text-xs muted">
                    {r.room_types ?? 0} room type{r.room_types === 1 ? "" : "s"}
                  </span>
                </td>
                <td>
                  {r.bookings_30}
                  {r.bookings_30 > 0 && <span className="block text-xs muted">{inr(r.value_30)}</span>}
                </td>
                <td>
                  {r.bookings}
                  {r.bookings > 0 && (
                    <span className="block text-xs muted">
                      {inr(r.bookings_value)}, {r.desk_bookings} desk, last {ago(r.last_booking).toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="muted">
                  {ago(r.last_open)}
                  {r.opens_7 > 0 && <span className="block text-xs">{r.opens_7} opens this week</span>}
                </td>
                <td>
                  <span className={`chip ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                </td>
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
                <td className={r.plan && !r.plan.stopped_at ? undefined : "muted"}>
                  {!r.plan ? (
                    "-"
                  ) : r.plan.stopped_at ? (
                    <>
                      Ended
                      <span className="block text-xs">{r.plan.stop_reason || "Stopped"}</span>
                    </>
                  ) : (
                    planLabel(r.plan)
                  )}
                  {r.plan?.last_error && (
                    <span className="block text-xs text-[var(--danger)]">{planError(r.plan.last_error)}</span>
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
                <td colSpan={11} className="py-8 text-center sub">
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
          canSave={followsReady}
          onSaved={mergeFollow}
          plan={open.plan}
          plansReady={plansReady}
          onPlans={mergePlans}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
