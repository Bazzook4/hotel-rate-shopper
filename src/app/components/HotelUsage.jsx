"use client";

import { useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import { ContactLine } from "./PropertyAdmin";
import { useSort, SortTh } from "../dashboard/components/useSort";
import { inr } from "../dashboard/components/WalletPanel";
import PageUsage from "./PageUsage";

/**
 * Super admin only: every onboarded hotel with what it has set up, the
 * bookings it has made and when its staff last opened the app, so new
 * sign-ups that stalled and hotels that went quiet stand out for a call.
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
  types: "room_types",
  rooms: "rooms",
  b30: "bookings_30",
  all: "bookings",
  last: (r) => r.last_booking,
  open: (r) => r.last_open,
  status: (r) => STATUS[r.status].order,
};

export default function HotelUsage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(null);
  // Hotels, or how pages and help are used (PageUsage.jsx).
  const [view, setView] = useState("hotels");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/usage")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Could not load usage");
        return j;
      })
      .then((j) => {
        if (!cancelled) setRows(j.rows.map((r) => ({ ...r, status: statusOf(r) })));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: 0, new: 0, setup: 0, nobook: 0, quiet: 0, active: 0 };
    for (const r of rows || []) {
      c.all += 1;
      c[r.status] += 1;
      if (daysAgo(r.created_at) <= 30) c.new += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    if (!rows || !filter) return rows || [];
    if (filter === "new") return rows.filter((r) => daysAgo(r.created_at) <= 30);
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
  if (!rows) return <p className="sub">Loading...</p>;

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

  const pick = (key) => () => setFilter((f) => (f === key || key === "all" ? null : key));
  const on = (key) => (filter === key ? "ok" : undefined);

  return (
    <div className="space-y-3">
      {switcher}
      <Facts>
        <Fact label="Hotels" onClick={pick("all")}>{counts.all}</Fact>
        <Fact label="New, last 30 days" tone={on("new")} onClick={pick("new")}>{counts.new}</Fact>
        <Fact label="Active" tone={on("active")} onClick={pick("active")}>{counts.active}</Fact>
        <Fact label="Quiet" tone={on("quiet")} onClick={pick("quiet")}>{counts.quiet}</Fact>
        <Fact label="No bookings" tone={on("nobook")} onClick={pick("nobook")}>{counts.nobook}</Fact>
        <Fact label="Not set up" tone={on("setup")} onClick={pick("setup")}>{counts.setup}</Fact>
      </Facts>
      <p className="text-xs muted">
        Bookings are counted by the day they were made, without cancellations. Desk means made in
        the app, not from a channel. Quiet means no booking in 30 days and nobody from the hotel
        has opened the app in {QUIET_DAYS} days.
      </p>

      <div className="card">
        <table className="grid-table min-w-full text-sm">
          <thead>
            <tr>
              <SortTh sorter={sorter} col="name">Hotel</SortTh>
              <SortTh sorter={sorter} col="signed">Signed up</SortTh>
              <SortTh sorter={sorter} col="types">Room types</SortTh>
              <SortTh sorter={sorter} col="rooms">Rooms</SortTh>
              <SortTh sorter={sorter} col="b30">Last 30 days</SortTh>
              <SortTh sorter={sorter} col="all">All bookings</SortTh>
              <SortTh sorter={sorter} col="last">Last booking</SortTh>
              <SortTh sorter={sorter} col="open">Last opened</SortTh>
              <SortTh sorter={sorter} col="status">Status</SortTh>
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
                <td className="muted">
                  {r.created_at ? shortDate(r.created_at) : "-"}
                </td>
                <td>{r.room_types ?? "-"}</td>
                <td>
                  {r.rooms ?? "-"}
                  {r.total_rooms ? <span className="muted"> of {r.total_rooms}</span> : null}
                </td>
                <td>
                  {r.bookings_30}
                  {r.bookings_30 > 0 && <span className="block text-xs muted">{inr(r.value_30)}</span>}
                </td>
                <td>
                  {r.bookings}
                  {r.bookings > 0 && (
                    <span className="block text-xs muted">
                      {inr(r.bookings_value)}, {r.desk_bookings} desk
                    </span>
                  )}
                </td>
                <td className="muted">{r.last_booking ? ago(r.last_booking) : "-"}</td>
                <td className="muted">
                  {ago(r.last_open)}
                  {r.opens_7 > 0 && <span className="block text-xs">{r.opens_7} opens this week</span>}
                </td>
                <td>
                  <span className={`chip ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                </td>
              </tr>
            ))}
            {sorter.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center sub">
                  No hotels here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
