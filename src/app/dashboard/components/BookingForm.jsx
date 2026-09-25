"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * Entering or editing a booking.
 *
 * Kept as a panel above the list rather than a modal, because a receptionist
 * taking a booking on the phone needs to see the other stays while typing --
 * a modal would hide exactly the context they are checking against.
 */

function nightsBetween(checkIn, checkOut) {
  const a = parseDateISO(checkIn);
  const b = parseDateISO(checkOut);
  if (!a || !b || b <= a) return 0;
  return Math.round((b - a) / 86400000);
}

function emptyBooking() {
  const today = todayUTC();
  return {
    guest_name: "",
    guest_email: "",
    guest_phone: "",
    room_type_id: "",
    room_id: "",
    rate_plan_id: "",
    check_in: formatDateISO(today),
    check_out: formatDateISO(addDays(today, 1)),
    adults: 2,
    children: 0,
    source: "direct",
    total_amount: "",
    notes: "",
  };
}

/** A reservation from the API, flattened into what the inputs hold. */
function toForm(reservation) {
  return {
    guest_name: reservation.guest_name || "",
    guest_email: reservation.guest_email || "",
    guest_phone: reservation.guest_phone || "",
    room_type_id: reservation.room_type_id || "",
    room_id: reservation.room_id || "",
    rate_plan_id: reservation.rate_plan_id || "",
    check_in: reservation.check_in || "",
    check_out: reservation.check_out || "",
    adults: reservation.adults ?? 2,
    children: reservation.children ?? 0,
    source: reservation.source || "direct",
    total_amount: reservation.total_amount ?? "",
    notes: reservation.notes || "",
  };
}

export default function BookingForm({
  session,
  reservation,
  prefill,
  roomTypes,
  rooms,
  ratePlans,
  embedded = false,
  onSaved,
  onCancel,
}) {
  // A booking started by clicking an empty cell on the tape chart arrives with
  // the room and date already chosen, which is most of the form filled in.
  const [form, setForm] = useState(() =>
    reservation ? toForm(reservation) : { ...emptyBooking(), ...(prefill || {}) }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A date that is full is refused once; the second attempt carries the
  // override, so overbooking is always a deliberate second action.
  const [conflict, setConflict] = useState(null);

  const nights = nightsBetween(form.check_in, form.check_out);

  /** Only rooms of the chosen type can hold this booking. */
  const roomsForType = useMemo(
    () => rooms.filter((r) => r.room_type_id === form.room_type_id && r.is_active),
    [rooms, form.room_type_id]
  );

  function set(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };

      // Moving check-in past check-out would leave an impossible stay on
      // screen, so the departure follows it out by the nights already booked.
      if (field === "check_in" && next.check_out <= value) {
        const span = Math.max(1, nightsBetween(prev.check_in, prev.check_out));
        next.check_out = formatDateISO(addDays(parseDateISO(value), span));
      }

      // A room of the old type cannot stay selected against a new one.
      if (field === "room_type_id") next.room_id = "";

      return next;
    });
    setConflict(null);
  }

  async function submit(allowOverbook = false) {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        property_id: session?.propertyId || null,
        room_id: form.room_id || null,
        rate_plan_id: form.rate_plan_id || null,
        allow_overbook: allowOverbook,
        ...(reservation ? { id: reservation.id } : {}),
      };

      const res = await fetch("/api/pms/reservations", {
        method: reservation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.availability) {
        setConflict(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not save the booking");

      onSaved(
        reservation
          ? `Booking ${data.reservation.reference} updated.`
          : `Booking ${data.reservation.reference} created for ${data.reservation.guest_name}.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={embedded ? "space-y-4" : "card card-pad space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 style={{ fontWeight: 600 }}>
            {reservation ? `Edit ${reservation.reference}` : "New booking"}
          </h3>
          <button className="btn btn-ghost text-sm" onClick={onCancel}>
            Close
          </button>
        </div>
      )}

      {roomTypes.length === 0 && (
        <p className="sub" style={{ color: "var(--warn)" }}>
          This property has no room types yet — add one in Room Setup before
          taking bookings.
        </p>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div>
          <label className="label">Guest name</label>
          <input
            className="input"
            value={form.guest_name}
            onChange={(e) => set("guest_name", e.target.value)}
            placeholder="Full name"
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            value={form.guest_phone}
            onChange={(e) => set("guest_phone", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={form.guest_email}
            onChange={(e) => set("guest_email", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Room type</label>
          <select
            className="input"
            value={form.room_type_id}
            onChange={(e) => set("room_type_id", e.target.value)}
          >
            <option value="">Choose…</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.room_type_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Room</label>
          <select
            className="input"
            value={form.room_id}
            onChange={(e) => set("room_id", e.target.value)}
            disabled={!form.room_type_id}
          >
            <option value="">Assign later</option>
            {roomsForType.map((r) => (
              <option key={r.id} value={r.id}>
                {r.room_number}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Rate plan</label>
          <select
            className="input"
            value={form.rate_plan_id}
            onChange={(e) => set("rate_plan_id", e.target.value)}
          >
            <option value="">None</option>
            {ratePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.plan_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Check in</label>
          <input
            className="input"
            type="date"
            value={form.check_in}
            onChange={(e) => set("check_in", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Check out</label>
          <input
            className="input"
            type="date"
            value={form.check_out}
            min={form.check_in}
            onChange={(e) => set("check_out", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Nights</label>
          <div className="input" style={{ color: "var(--text-muted)" }}>
            {nights || "—"}
          </div>
        </div>

        <div>
          <label className="label">Adults</label>
          <input
            className="input"
            type="number"
            min="1"
            value={form.adults}
            onChange={(e) => set("adults", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Children</label>
          <input
            className="input"
            type="number"
            min="0"
            value={form.children}
            onChange={(e) => set("children", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Total amount</label>
          <input
            className="input"
            type="number"
            min="0"
            value={form.total_amount}
            onChange={(e) => set("total_amount", e.target.value)}
            placeholder="Whole stay"
          />
        </div>

        <div>
          <label className="label">Source</label>
          <input
            className="input"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            placeholder="direct, walkin, phone"
          />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="input"
          rows={2}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Late arrival, dietary needs, anything the desk should know"
        />
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {conflict && (
        <div
          className="card card-pad text-sm space-y-2"
          style={{ borderColor: "var(--warn)" }}
        >
          <p style={{ color: "var(--warn)" }}>{conflict}</p>
          <p className="sub">
            You can still take this booking, but the property will be overbooked
            on that date.
          </p>
          <button
            className="btn btn-secondary text-sm"
            disabled={saving}
            onClick={() => submit(true)}
          >
            Book anyway
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="btn btn-primary text-sm"
          disabled={saving || roomTypes.length === 0}
          onClick={() => submit(false)}
        >
          {saving ? "Saving…" : reservation ? "Save changes" : "Create booking"}
        </button>
        {!embedded && (
          <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
