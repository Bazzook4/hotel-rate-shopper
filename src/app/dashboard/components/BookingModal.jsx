"use client";

import { useCallback, useEffect, useState } from "react";
import BookingForm from "./BookingForm";
import FolioTabs from "./FolioTabs";
import { todayUTC } from "@/lib/date";
import { inventoryWarning } from "@/lib/inventoryNotice";

/**
 * One booking, opened from the tape chart.
 *
 * Tabbed because a stay carries more than fits on one screen -- the booking
 * itself, who is staying, what they added, what they paid -- and the desk
 * moves between those rather than reading them together. A new booking shows
 * only Details: there is nothing to add guests or payments to until the stay
 * exists.
 */

const TABS = [
  { id: "details", label: "Details" },
  { id: "guests", label: "Guests" },
  { id: "inclusions", label: "Inclusions" },
  { id: "payments", label: "Payments" },
  { id: "invoices", label: "Invoices" },
];

const STATUS_LABELS = {
  confirmed: "Confirmed",
  in_house: "In house",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

/** What the desk can do next, given where the stay is now. */
const NEXT_ACTIONS = {
  confirmed: [
    { status: "in_house", label: "Check in", kind: "btn-primary" },
    { status: "no_show", label: "No show", kind: "btn-ghost" },
  ],
  in_house: [{ status: "checked_out", label: "Check out", kind: "btn-primary" }],
  checked_out: [],
  cancelled: [{ status: "confirmed", label: "Reinstate", kind: "btn-secondary" }],
  no_show: [{ status: "confirmed", label: "Reinstate", kind: "btn-secondary" }],
};

export default function BookingModal({
  session,
  reservationId,
  prefill,
  extras,
  onClose,
  onChanged,
}) {
  const isNew = !reservationId;

  const [tab, setTab] = useState("details");
  const [folio, setFolio] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);

  const propertyId = session?.propertyId || null;

  const loadFolio = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pms/folio?reservationId=${reservationId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the booking");
      setFolio(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [reservationId, isNew]);

  /** The setup the Details form needs to offer rooms and plans. */
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
      // The form says what is missing when it cannot offer anything.
    }
  }, [propertyId]);

  useEffect(() => {
    loadFolio();
    loadSetup();
  }, [loadFolio, loadSetup]);

  // Escape closes, which is what every modal is expected to do.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reservation = folio?.reservation;

  async function changeStatus(status) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/reservations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reservationId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the booking");
      await loadFolio();
      onChanged?.(inventoryWarning(data));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    if (
      !window.confirm(
        `Cancel ${reservation.guest_name}'s booking ${reservation.reference}?`
      )
    ) {
      return;
    }
    await changeStatus("cancelled");
  }

  const actions = reservation ? NEXT_ACTIONS[reservation.status] || [] : [];

  // A stay that has not started yet cannot be checked in. The action stays
  // visible -- hiding it would leave the desk wondering where check-in went --
  // but it is disabled and says why.
  const tooEarly =
    reservation && reservation.check_in > todayUTC()
      ? `Arrives ${reservation.check_in} — check-in opens that day`
      : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "2rem 1rem",
        overflowY: "auto",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 880, background: "var(--surface)" }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.85rem 1.1rem",
            background: "var(--accent)",
            color: "#fff",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {isNew
              ? "New booking"
              : `Edit reservation — ${reservation?.reference || ""} for ${
                  reservation?.guest_name || ""
                }`}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: "1.1rem",
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              padding: "0.5rem 1.1rem 0",
              borderBottom: "1px solid var(--border)",
              flexWrap: "wrap",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="btn text-xs"
                style={{
                  borderRadius: "4px 4px 0 0",
                  background: tab === t.id ? "var(--surface)" : "transparent",
                  border:
                    tab === t.id ? "1px solid var(--border)" : "1px solid transparent",
                  borderBottom: tab === t.id ? "1px solid var(--surface)" : undefined,
                  marginBottom: -1,
                  color: tab === t.id ? "var(--accent-text)" : "var(--text-muted)",
                  fontWeight: tab === t.id ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="card-pad space-y-3">
          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          {loading && <p className="sub">Loading…</p>}

          {!loading && (tab === "details" || isNew) && (
            <>
              {reservation && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="chip chip-off">
                    {STATUS_LABELS[reservation.status] || reservation.status}
                  </span>
                  {reservation.rooms?.room_number && (
                    <span className="chip chip-ok">
                      Room {reservation.rooms.room_number}
                    </span>
                  )}
                  {folio?.totals && (
                    <span
                      className="chip"
                      style={{
                        background:
                          folio.totals.balance > 0 ? "var(--warn-soft)" : "var(--surface-2)",
                        color:
                          folio.totals.balance > 0 ? "var(--warn)" : "var(--text-muted)",
                      }}
                    >
                      Balance ₹{folio.totals.balance.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              )}

              <BookingForm
                session={session}
                reservation={reservation}
                prefill={prefill}
                roomTypes={roomTypes}
                rooms={rooms}
                ratePlans={ratePlans}
                embedded
                onSaved={async (_message, warning) => {
                  onChanged?.(warning);
                  if (isNew) onClose();
                  else await loadFolio();
                }}
                onCancel={onClose}
              />
            </>
          )}

          {!loading && !isNew && tab !== "details" && folio && (
            <FolioTabs
              tab={tab}
              folio={folio}
              extras={extras}
              reservationId={reservationId}
              onChanged={async () => {
                await loadFolio();
                onChanged?.();
              }}
            />
          )}
        </div>

        {/* Footer: the desk actions */}
        {!isNew && reservation && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "0.5rem",
              padding: "0.75rem 1.1rem",
              borderTop: "1px solid var(--border)",
            }}
          >
            {reservation.status === "confirmed" && (
              <button
                className="btn btn-ghost text-sm"
                style={{ color: "var(--danger)", marginRight: "auto" }}
                onClick={cancelBooking}
                disabled={busy}
              >
                ✕ Cancel booking
              </button>
            )}
            {actions.map((a) => {
              const blocked = a.status === "in_house" && tooEarly;
              return (
                <button
                  key={a.status}
                  className={`btn ${a.kind} text-sm`}
                  disabled={busy || Boolean(blocked)}
                  title={blocked || undefined}
                  onClick={() => changeStatus(a.status)}
                >
                  {a.label}
                </button>
              );
            })}
            <button className="btn btn-secondary text-sm" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
