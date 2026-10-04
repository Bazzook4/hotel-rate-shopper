"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { useFrontDesk } from "./frontDesk";
import { inventoryWarning } from "@/lib/inventoryNotice";
import {
  BookingLink,
  Change,
  FIX_TAB,
  TONE,
  longDate,
  moneyFormatter,
  one,
  timeOf,
  useBookingOpener,
  useReport,
  whole,
} from "./reportKit";

/**
 * The home page: the answer to "how am I doing, and what needs me?" before
 * any other page is opened.
 *
 * Read top to bottom: what is left to set up (until it is all done), what
 * needs doing now, how tonight looks against the same night last week, and
 * how the month is going against last year. Every figure opens the page it
 * comes from, and every problem opens the place it is fixed. Each part is
 * sent only to whoever holds the page it summarises, so a part missing from
 * the answer is simply not drawn.
 */

const KIND_LABEL = {
  rates: "Rates",
  inventory: "Availability",
  restrictions: "Restrictions",
  multiplier: "Channel markups",
  reservation: "Incoming bookings",
};

const pct = (v) => (v == null ? "–" : `${one.format(v)}%`);

/** A grey block the shape of what is loading, so the page does not jump when it arrives. */
function Skeleton({ height = 16, width = "100%" }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden />;
}

function LoadingCards() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="card card-pad space-y-4">
          <Skeleton height={18} width="30%" />
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="space-y-2">
                <Skeleton height={12} width="60%" />
                <Skeleton height={24} width="80%" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A card heading with a link to the page behind it, when this user may open it. */
function CardHead({ title, sub, page, linkLabel, onOpenPage, canOpen }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        {sub && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {sub}
          </p>
        )}
      </div>
      {page && canOpen(page) && (
        <button type="button" className="btn btn-ghost text-xs" onClick={() => onOpenPage(page)}>
          {linkLabel} →
        </button>
      )}
    </div>
  );
}

/**
 * One headline figure. The whole tile opens its page, so the number is the
 * link -- there is no separate "details" control to find.
 */
function Tile({ label, value, sub, change, page, view, onOpenPage, canOpen }) {
  const body = (
    <>
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--text)" }}>
        {value}
      </p>
      {(change || sub) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {change}
          {sub && (
            <span className="text-xs tabular-nums" style={{ color: "var(--text-faint)" }}>
              {sub}
            </span>
          )}
        </div>
      )}
    </>
  );
  if (!page || !canOpen(page)) return <div className="p-2">{body}</div>;
  return (
    <button type="button" className="today-tile p-2 text-left" onClick={() => onOpenPage(page, view)}>
      {body}
    </button>
  );
}

function PartError({ title, error }) {
  return (
    <div className="card card-pad text-sm" style={{ color: "var(--danger)" }}>
      {title} could not be loaded: {error}
    </div>
  );
}

// ------------------------------------------------------------------
// Setup checklist
// ------------------------------------------------------------------

function SetupChecklist({ setup, onOpenPage, canOpen }) {
  const left = setup.steps.filter((s) => !s.done);
  const share = Math.round((setup.done / setup.total) * 100);
  return (
    <div className="card card-pad">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Finish setting up
        </h3>
        <span className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
          {setup.done} of {setup.total} done
        </span>
      </div>
      <div
        className="mb-4 h-2 overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        role="progressbar"
        aria-valuenow={setup.done}
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: "var(--accent)" }} />
      </div>
      <ol className="space-y-1">
        {setup.steps.map((s) => {
          const next = s === left[0];
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded px-2 py-2"
              style={{ background: next ? "var(--accent-soft)" : "transparent" }}
            >
              <span
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={
                  s.done
                    ? { background: "var(--accent)", color: "#fff" }
                    : { border: "1px solid var(--border-strong)", color: "var(--text-muted)" }
                }
                aria-label={s.done ? "Done" : "Not done"}
              >
                {s.done ? "✓" : setup.steps.indexOf(s) + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-medium"
                  style={{
                    color: s.done ? "var(--text-muted)" : "var(--text)",
                    textDecoration: s.done ? "line-through" : "none",
                  }}
                >
                  {s.label}
                </p>
                {!s.done && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {s.hint}
                  </p>
                )}
              </div>
              {!s.done && canOpen(s.page) && (
                <button
                  type="button"
                  className={`btn text-xs ${next ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => onOpenPage(s.page)}
                >
                  {next ? "Start" : "Open"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------
// Needs attention
// ------------------------------------------------------------------

/** One problem: a count, what it is, how to fix it, and -- opened -- the bookings it is about. */
function Problem({ tone, count, title, hint, action, children }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="chip min-w-[2.25rem] justify-center tabular-nums" style={TONE[tone] || TONE.warn}>
          {whole.format(count)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {title}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {hint}
          </p>
        </div>
        {children && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
          </button>
        )}
        {action}
      </div>
      {open && children && <div className="mt-2 pl-0 md:pl-10">{children}</div>}
    </li>
  );
}

function NeedsAttention({ today, distribution, onOpenPage, canOpen, openBooking }) {
  const items = [];

  for (const e of today?.exceptions || []) {
    items.push(
      <Problem key={e.id} tone={e.tone} count={e.rows.length} title={e.title} hint={e.hint}>
        <ul className="space-y-1">
          {e.rows.map((r, i) => (
            <li key={`${r.reservationId}-${i}`} className="flex flex-wrap items-center gap-x-3 text-sm">
              <BookingLink
                reference={r.reference}
                reservationId={r.reservationId}
                tab={FIX_TAB[e.id] || "details"}
                onOpen={openBooking}
              />
              <span style={{ color: "var(--text)" }}>{r.guest}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {[r.room && `Room ${r.room}`, r.roomType].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </Problem>
    );
  }

  const dirty = today?.housekeeping?.dirty || 0;
  if (dirty > 0) {
    items.push(
      <Problem
        key="dirty"
        tone="warn"
        count={dirty}
        title={`Room${dirty === 1 ? "" : "s"} still to clean`}
        hint="Marked dirty. Housekeeping lists them and marks each clean in one tap."
        action={
          canOpen("housekeeping") && (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => onOpenPage("housekeeping")}>
              Housekeeping
            </button>
          )
        }
      />
    );
  }

  for (const f of distribution?.failures || []) {
    items.push(
      <Problem
        key={`fail-${f.kind}`}
        tone="danger"
        count={1}
        title={`${KIND_LABEL[f.kind] || f.kind} did not reach the channel manager`}
        hint={`The last attempt, at ${timeOf(f.at)}, failed${f.error ? `: ${f.error}` : "."} The channels may be showing old figures until it goes through.`}
        action={
          canOpen("logs") && (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => onOpenPage("logs")}>
              Activity log
            </button>
          )
        }
      />
    );
  }

  const unmapped = distribution?.unmapped || [];
  if (unmapped.length) {
    items.push(
      <Problem
        key="unmapped"
        tone="warn"
        count={unmapped.length}
        title="Room types with no channel manager code"
        hint={`${unmapped.join(", ")}. Nothing is sent for these rooms until each has its code.`}
        action={
          canOpen("integrations") && (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => onOpenPage("integrations")}>
              Add codes
            </button>
          )
        }
      />
    );
  }

  return (
    <div className="card card-pad">
      <CardHead
        title="Needs attention"
        sub={items.length ? "Open an item to see the bookings; this list updates when you come back." : null}
        page="nightaudit"
        linkLabel="Night audit"
        onOpenPage={onOpenPage}
        canOpen={canOpen}
      />
      {items.length ? (
        <ul>{items}</ul>
      ) : (
        <p className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)" }}>
            <Icon name="check" />
          </span>
          Nothing needs attention right now.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Front desk: today's arrivals and departures, actionable in place
// ------------------------------------------------------------------

/** How many of each list are shown before "See all". */
const DESK_ROWS = 8;

function DeskList({ title, rows, action, busyId, onAction, onSeeAll, openBooking, empty }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title} <span className="font-normal tabular-nums" style={{ color: "var(--text-muted)" }}>({rows.length})</span>
        </h4>
        {rows.length > DESK_ROWS && onSeeAll && (
          <button type="button" className="btn btn-ghost text-xs" onClick={onSeeAll}>
            See all →
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{empty}</p>
      ) : (
        <ul>
          {rows.slice(0, DESK_ROWS).map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 py-2"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => openBooking(r.id, "details")}
                title="Open booking"
              >
                <span className="block truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {r.guest_name}
                </span>
                <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {[r.rooms?.room_number ? `Room ${r.rooms.room_number}` : "No room yet", r.room_types?.room_type_name]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={busyId !== null}
                onClick={() => onAction(r)}
              >
                {busyId === r.id ? "…" : action}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Who is arriving and leaving today, each with its Check in or Check out
 * right here: the desk's commonest jobs without leaving the home page.
 */
function FrontDesk({ date, propertyId, stamp, onOpenPage, canOpen, openBooking, onChanged }) {
  const desk = useFrontDesk(propertyId);
  const [arrivals, setArrivals] = useState([]);
  const [departures, setDepartures] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const ask = async (params) => {
      const qs = new URLSearchParams(params);
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/reservations?${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load today's bookings");
      return body.reservations || [];
    };
    try {
      const [a, d] = await Promise.all([
        ask({ status: "confirmed", arrivingOn: date }),
        ask({ status: "in_house", leavingOn: date }),
      ]);
      setArrivals(a);
      setDepartures(d);
    } catch (err) {
      setError(err.message);
    }
  }, [date, propertyId]);

  // `stamp` is the page's report: when it reloads (a booking changed in its
  // window), these lists follow.
  useEffect(() => {
    load();
  }, [load, stamp]);

  async function run(r, action) {
    setBusyId(r.id);
    setError("");
    try {
      const data = await action(r);
      if (!data) return;
      const warning = inventoryWarning(data);
      if (warning) setError(warning);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const seeAll = (view) => (canOpen("reservations") ? () => onOpenPage("reservations", view) : null);

  return (
    <div className="card card-pad">
      <CardHead title="Front desk" page="calendar" linkLabel="Calendar" onOpenPage={onOpenPage} canOpen={canOpen} />
      {error && (
        <p className="mb-3 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <DeskList
          title="Arriving today"
          rows={arrivals}
          action="Check in"
          busyId={busyId}
          onAction={(r) => run(r, desk.checkIn)}
          onSeeAll={seeAll("arrivals")}
          openBooking={openBooking}
          empty="No one left to arrive."
        />
        <DeskList
          title="Leaving today"
          rows={departures}
          action="Check out"
          busyId={busyId}
          onAction={(r) => run(r, desk.checkOut)}
          onSeeAll={seeAll("departures")}
          openBooking={openBooking}
          empty="No one left to check out."
        />
      </div>
      {desk.settleDialog}
    </div>
  );
}

// ------------------------------------------------------------------
// Tonight and the month
// ------------------------------------------------------------------

function Tonight({ today, onOpenPage, canOpen }) {
  const money = moneyFormatter(today.currency || "INR");
  const { current: c, previous: p, movement: m } = today;
  const tile = { onOpenPage, canOpen };
  const vs = (now, before, opts = {}) => <Change now={now} before={before} better="up" {...opts} />;
  return (
    <div className="card card-pad">
      <CardHead
        title="Tonight"
        sub={`${longDate(today.date)}, compared with the same night last week (${longDate(today.compareDate)})`}
        page="calendar"
        linkLabel="Calendar"
        {...tile}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Occupancy"
          value={pct(c.occupancy)}
          sub={`${whole.format(c.occupied)} of ${whole.format(c.available)} rooms`}
          change={vs(c.occupancy, p.occupancy, { points: true })}
          page="calendar"
          {...tile}
        />
        <Tile
          label="Arrivals"
          value={whole.format(m.arrivals.expected)}
          sub={`${whole.format(m.arrivals.arrived)} in · ${whole.format(m.arrivals.pending)} to come`}
          page="reservations"
          view="arrivals"
          {...tile}
        />
        <Tile
          label="Departures"
          value={whole.format(m.departures.expected)}
          sub={`${whole.format(m.departures.departed)} out · ${whole.format(m.departures.pending)} to go`}
          page="reservations"
          view="departures"
          {...tile}
        />
        <Tile
          label="In house"
          value={whole.format(m.inHouse)}
          sub={`${whole.format(m.guests)} guest${m.guests === 1 ? "" : "s"}`}
          page="calendar"
          {...tile}
        />
        {c.roomRevenue !== undefined && (
          <>
            <Tile
              label="Room revenue"
              value={money(c.roomRevenue)}
              change={vs(c.roomRevenue, p.roomRevenue)}
              page="nightaudit"
              {...tile}
            />
            <Tile label="Avg room rate (ADR)" value={money(c.adr)} change={vs(c.adr, p.adr)} page="nightaudit" {...tile} />
          </>
        )}
      </div>
    </div>
  );
}

function MonthToDate({ month, onOpenPage, canOpen }) {
  const money = moneyFormatter(month.currency || "INR");
  const { current: c, previous: p } = month.kpis;
  const tile = { onOpenPage, canOpen, page: "performance" };
  return (
    <div className="card card-pad">
      <CardHead
        title="Month to date"
        sub={`${longDate(month.start)} – ${longDate(month.end)}, compared with the same days last year`}
        page="performance"
        linkLabel="Booking performance"
        onOpenPage={onOpenPage}
        canOpen={canOpen}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Room revenue" value={money(c.roomRevenue)} change={<Change now={c.roomRevenue} before={p.roomRevenue} better="up" />} sub={`was ${money(p.roomRevenue)}`} {...tile} />
        <Tile label="Occupancy" value={pct(c.occupancy)} change={<Change now={c.occupancy} before={p.occupancy} better="up" points />} sub={`was ${pct(p.occupancy)}`} {...tile} />
        <Tile label="Avg room rate (ADR)" value={money(c.adr)} change={<Change now={c.adr} before={p.adr} better="up" />} sub={`was ${money(p.adr)}`} {...tile} />
        <Tile label="Revenue per room (RevPAR)" value={money(c.revpar)} change={<Change now={c.revpar} before={p.revpar} better="up" />} sub={`was ${money(p.revpar)}`} {...tile} />
        <Tile
          label="Reservations"
          value={whole.format(c.reservations ?? 0)}
          change={<Change now={c.reservations} before={p.reservations} better="up" />}
          sub={`was ${whole.format(p.reservations ?? 0)}`}
          {...tile}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function TodayPage({ session, onOpenPage, canOpen }) {
  const propertyId = session?.propertyId || null;
  // Held until the header has settled on a property: asked before then, the
  // server answers for the user's own, and a second, slow answer follows.
  const { report, loading, error, reload } = useReport("/api/today", propertyId ? {} : null, propertyId);
  const { openBooking, modal } = useBookingOpener(session, reload);

  const today = report?.today?.error ? null : report?.today;
  const distribution = report?.distribution?.error ? null : report?.distribution;
  const setup = report?.setup?.error ? null : report?.setup;
  const month = report?.month?.error ? null : report?.month;
  const hasAttention = report && (report.today || report.distribution);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Today</h2>
          <p className="sub">
            {session?.propertyName ? `${session.propertyName} · ` : ""}
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <button type="button" className="btn btn-secondary text-sm" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={16} /> {loading && report ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <PartError title="Today" error={error} />}
      {loading && !report && !error && <LoadingCards />}

      {setup && setup.done < setup.total && (
        <SetupChecklist setup={setup} onOpenPage={onOpenPage} canOpen={canOpen} />
      )}
      {report?.setup?.error && <PartError title="Setup progress" error={report.setup.error} />}

      {hasAttention && (
        <NeedsAttention
          today={today}
          distribution={distribution}
          onOpenPage={onOpenPage}
          canOpen={canOpen}
          openBooking={openBooking}
        />
      )}
      {report?.distribution?.error && <PartError title="Channel status" error={report.distribution.error} />}

      {today && (
        <FrontDesk
          date={today.date}
          propertyId={propertyId}
          stamp={report}
          onOpenPage={onOpenPage}
          canOpen={canOpen}
          openBooking={openBooking}
          onChanged={reload}
        />
      )}

      {today && <Tonight today={today} onOpenPage={onOpenPage} canOpen={canOpen} />}
      {report?.today?.error && <PartError title="Tonight" error={report.today.error} />}

      {month && <MonthToDate month={month} onOpenPage={onOpenPage} canOpen={canOpen} />}
      {report?.month?.error && <PartError title="Month to date" error={report.month.error} />}

      {report && !report.today && !report.month && !report.distribution && !setup && (
        <div className="card card-pad sub">
          Your pages are in the menu. The home page summarises the front desk, reports and channel
          manager, none of which are switched on for your account.
        </div>
      )}

      {modal}
    </div>
  );
}
