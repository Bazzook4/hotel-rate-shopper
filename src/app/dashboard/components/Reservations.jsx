"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import BookingForm from "./BookingForm";
import { inventoryWarning } from "@/lib/inventoryNotice";

/**
 * The reservations list: every booking at the property, and the desk actions
 * that move one through its stay.
 *
 * The list is the front office's working surface, so it leads with what the
 * desk needs today -- who is arriving, who is leaving, who is in house --
 * rather than with the whole booking history.
 */

const STATUS_LABELS = {
  confirmed: "Confirmed",
  in_house: "In house",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

/** Which chip a status wears. Cancelled and no-show are muted, not alarming. */
const STATUS_CHIP = {
  confirmed: "chip-ok",
  in_house: "chip-warn",
  checked_out: "chip-off",
  cancelled: "chip-off",
  no_show: "chip-off",
};

function money(value, currency) {
  if (value == null) return "—";
  // Anything without a symbol here shows its code, so a BDT booking is not
  // read as rupees.
  const symbol =
    currency === "GBP" ? "£" : currency === "USD" ? "$" : !currency || currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${Math.round(value).toLocaleString("en-IN")}`;
}

function shortDate(iso) {
  const parsed = parseDateISO(iso);
  if (!parsed) return "—";
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function nightCount(checkIn, checkOut) {
  const a = parseDateISO(checkIn);
  const b = parseDateISO(checkOut);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * The filters across the top.
 *
 * "Arrivals" and "Departures" are date questions rather than status ones --
 * a guest arriving today is a confirmed booking whose check-in is today -- so
 * they are handled here rather than being sent to the API as a status.
 */
const VIEWS = [
  { id: "current", label: "Current" },
  { id: "arrivals", label: "Arrivals today" },
  { id: "departures", label: "Departures today" },
  { id: "in_house", label: "In house" },
  { id: "all", label: "All" },
];

export default function Reservations({ session }) {
  const propertyId = session?.propertyId || null;

  const [reservations, setReservations] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);

  const [view, setView] = useState("current");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // OTA bookings received but not in the PMS -- normally none.
  const [pending, setPending] = useState([]);
  const [retrying, setRetrying] = useState(null);

  // todayUTC() is already a YYYY-MM-DD string. Passing it through
  // formatDateISO, which expects a Date, yields "" and quietly breaks every
  // date comparison below.
  const today = todayUTC();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (propertyId) qs.set("propertyId", propertyId);
      if (search.trim()) qs.set("search", search.trim());

      // "Current" means stays that touch the next month, which is the window
      // a desk actually works in. Everything else asks for the full list and
      // narrows it below.
      if (view === "current") {
        qs.set("from", today);
        qs.set("to", formatDateISO(addDays(todayUTC(), 30)));
      }

      const res = await fetch(`/api/pms/reservations?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load reservations");
      setReservations(data.reservations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, search, view, today]);

  /** The setup the booking form needs: room types, rooms and rate plans. */
  const loadSetup = useCallback(async () => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    try {
      const [typesRes, roomsRes, plansRes] = await Promise.all([
        fetch(`/api/setup/roomTypes${qs}`),
        fetch(`/api/pms/rooms${qs}`),
        fetch(`/api/setup/ratePlans${qs}`),
      ]);
      const [types, roomData, plans] = await Promise.all([
        typesRes.json(),
        roomsRes.json(),
        plansRes.json(),
      ]);
      setRoomTypes(types.roomTypes || []);
      setRooms(roomData.rooms || []);
      setRatePlans(plans.ratePlans || []);
    } catch {
      // Setup failing is not fatal for the list -- the form will say what is
      // missing when it is opened.
    }
  }, [propertyId]);

  /**
   * Bookings the channel manager sent that never became reservations. Shown
   * above the list with a Retry each, because otherwise they leave no trace
   * here while their rooms are still being sold.
   */
  const loadPending = useCallback(async () => {
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const res = await fetch(`/api/pms/adopt${qs}`);
      const data = await res.json();
      if (res.ok) setPending(data.pending || []);
    } catch {
      // The list still works without this; the Import button remains.
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  /** The client-side narrowing the date views need. */
  const visible = useMemo(() => {
    switch (view) {
      case "arrivals":
        return reservations.filter(
          (r) => r.check_in === today && r.status === "confirmed"
        );
      case "departures":
        return reservations.filter(
          (r) => r.check_out === today && r.status === "in_house"
        );
      case "in_house":
        return reservations.filter((r) => r.status === "in_house");
      case "current":
        // A cancelled stay is not current work, but stays findable under All.
        return reservations.filter((r) => r.status !== "cancelled");
      default:
        return reservations;
    }
  }, [reservations, view, today]);

  const counts = useMemo(
    () => ({
      arrivals: reservations.filter(
        (r) => r.check_in === today && r.status === "confirmed"
      ).length,
      departures: reservations.filter(
        (r) => r.check_out === today && r.status === "in_house"
      ).length,
      inHouse: reservations.filter((r) => r.status === "in_house").length,
    }),
    [reservations, today]
  );

  async function changeStatus(reservation, status, roomId) {
    setBusyId(reservation.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pms/reservations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reservation.id,
          status,
          ...(roomId !== undefined ? { room_id: roomId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the booking");
      setReservations((prev) =>
        prev.map((r) => (r.id === reservation.id ? data.reservation : r))
      );
      const warning = inventoryWarning(data);
      if (warning) setError(warning);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Checking a guest in needs a room. When none is assigned the desk is asked
   * for one here rather than being sent to the edit form and back.
   */
  async function checkIn(reservation) {
    // The API refuses this too. Stopping here as well means the desk gets the
    // reason without a round trip, and the button that led here is already
    // disabled -- this covers the case of a stale list left open overnight.
    if (reservation.check_in > today) {
      setError(
        `${reservation.guest_name} arrives on ${shortDate(reservation.check_in)} — check-in opens that day.`
      );
      return;
    }

    let roomId = reservation.room_id;

    if (!roomId) {
      const free = rooms.filter(
        (r) => r.room_type_id === reservation.room_type_id && r.is_active
      );
      if (free.length === 0) {
        setError(
          "No rooms of that type have been set up yet — add them in Room Setup first."
        );
        return;
      }
      const answer = window.prompt(
        `Which room for ${reservation.guest_name}?\n\nAvailable: ${free
          .map((r) => r.room_number)
          .join(", ")}`
      );
      if (!answer) return;
      const match = free.find(
        (r) => r.room_number.toLowerCase() === answer.trim().toLowerCase()
      );
      if (!match) {
        setError(`There is no room ${answer.trim()} of that type.`);
        return;
      }
      roomId = match.id;
    }

    await changeStatus(reservation, "in_house", roomId);
  }

  async function adoptOta() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pms/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not import OTA bookings");

      const parts = [
        data.created ? `${data.created} new` : null,
        data.updated ? `${data.updated} updated` : null,
        data.cancelled ? `${data.cancelled} cancelled` : null,
        data.skipped ? `${data.skipped} skipped` : null,
      ].filter(Boolean);

      setNotice(
        parts.length
          ? `OTA bookings imported — ${parts.join(", ")}.${
              data.reasons?.length ? ` ${data.reasons.join("; ")}` : ""
            }`
          : "No new OTA bookings to import."
      );
      await Promise.all([load(), loadPending()]);
      const warning = inventoryWarning(data);
      if (warning) setError(warning);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Retry one stuck booking -- the same adoption the webhook runs. */
  async function retryOne(bookingId) {
    setRetrying(bookingId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pms/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, booking_id: bookingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not retry the booking");

      if (data.created || data.updated) {
        setNotice(`Booking #${bookingId} is now in the PMS.`);
      } else {
        setError(
          `Booking #${bookingId} was not added${
            data.reasons?.length ? ` — ${data.reasons.join("; ")}` : "."
          }`
        );
      }
      await Promise.all([load(), loadPending()]);
      const warning = inventoryWarning(data);
      if (warning) setError(warning);
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(null);
    }
  }

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(reservation) {
    setEditing(reservation);
    setFormOpen(true);
  }

  async function afterSave(message, warning) {
    setFormOpen(false);
    setEditing(null);
    setNotice(message);
    await load();
    // After the reload, which clears errors, so the warning stays up.
    if (warning) setError(warning);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Reservations</h2>
          <p className="sub">
            {counts.arrivals} arriving today · {counts.departures} departing ·{" "}
            {counts.inHouse} in house
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary text-sm" onClick={adoptOta} disabled={loading}>
            Import OTA bookings
          </button>
          <button className="btn btn-primary text-sm" onClick={openNew}>
            New booking
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card card-pad text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="card card-pad text-sm"
          style={{ borderColor: "var(--accent)", color: "var(--accent-text)" }}
        >
          {notice}
        </div>
      )}

      {pending.length > 0 && (
        <div className="card card-pad space-y-2" style={{ borderColor: "var(--warn)" }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {pending.length} OTA booking{pending.length === 1 ? "" : "s"} not in the PMS yet
            </div>
            <p className="sub">
              Received from the channel manager but not turned into a reservation. Until
              they are, their rooms are not counted and may be sold again.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Booking</th>
                  <th className="text-left">Guest</th>
                  <th className="text-left">Stay</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Channel</th>
                  <th className="text-left">Received</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.partner_booking_id}>
                    <td style={{ fontFamily: "monospace" }}>{p.partner_booking_id}</td>
                    <td>{p.guest_name || "—"}</td>
                    <td>
                      {p.check_in ? `${shortDate(p.check_in)} → ${shortDate(p.check_out)}` : "—"}
                      {p.problem && (
                        <div style={{ color: "var(--danger)", fontSize: "0.75rem" }}>
                          {p.problem}
                        </div>
                      )}
                    </td>
                    <td className="text-right">{money(p.amount, p.currency)}</td>
                    <td>{p.channel || "—"}</td>
                    <td>
                      {p.received_at
                        ? new Date(p.received_at).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-primary text-xs"
                        disabled={retrying !== null || loading}
                        onClick={() => retryOne(p.partner_booking_id)}
                      >
                        {retrying === p.partner_booking_id ? "Retrying…" : "Retry"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <BookingForm
          session={session}
          reservation={editing}
          roomTypes={roomTypes}
          rooms={rooms}
          ratePlans={ratePlans}
          onSaved={afterSave}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`btn text-sm ${view === v.id ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
          <input
            className="input text-sm ml-auto"
            style={{ maxWidth: 240 }}
            placeholder="Search name, reference, phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && <p className="sub">Loading…</p>}

        {!loading && visible.length === 0 && (
          <p className="sub">
            No reservations here yet. Use “New booking” to put one in.
          </p>
        )}

        {visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Reference</th>
                  <th className="text-left">Guest</th>
                  <th className="text-left">Room</th>
                  <th className="text-left">Stay</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Source</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const nights = nightCount(r.check_in, r.check_out);
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td style={{ fontFamily: "monospace" }}>{r.reference}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.guest_name}</div>
                        {r.guest_phone && (
                          <div style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>
                            {r.guest_phone}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{r.room_types?.room_type_name || "—"}</div>
                        <div style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>
                          {r.rooms?.room_number
                            ? `Room ${r.rooms.room_number}`
                            : "Not assigned"}
                        </div>
                      </td>
                      <td>
                        {shortDate(r.check_in)} → {shortDate(r.check_out)}
                        <div style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>
                          {nights} night{nights === 1 ? "" : "s"} · {r.adults}A
                          {r.children ? ` ${r.children}C` : ""}
                        </div>
                      </td>
                      <td className="text-right">{money(r.total_amount, r.currency)}</td>
                      <td style={{ textTransform: "capitalize" }}>{r.source}</td>
                      <td>
                        <span className={`chip ${STATUS_CHIP[r.status] || "chip-off"}`}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {r.status === "confirmed" && (
                          <button
                            className="btn btn-primary text-xs"
                            disabled={busy || r.check_in > today}
                            title={
                              r.check_in > today
                                ? `Arrives ${shortDate(r.check_in)} — check-in opens that day`
                                : undefined
                            }
                            onClick={() => checkIn(r)}
                          >
                            Check in
                          </button>
                        )}
                        {r.status === "in_house" && (
                          <button
                            className="btn btn-primary text-xs"
                            disabled={busy}
                            onClick={() => changeStatus(r, "checked_out")}
                          >
                            Check out
                          </button>
                        )}
                        <button
                          className="btn btn-ghost text-xs ml-1"
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                        {r.status === "confirmed" && (
                          <button
                            className="btn btn-ghost text-xs ml-1"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Cancel ${r.guest_name}'s booking ${r.reference}?`
                                )
                              ) {
                                changeStatus(r, "cancelled");
                              }
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
