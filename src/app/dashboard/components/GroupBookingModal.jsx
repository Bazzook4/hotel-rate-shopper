"use client";

import { useEffect, useMemo, useState } from "react";
import { inventoryWarning } from "@/lib/inventoryNotice";

/**
 * Booking several rooms at once for one party.
 *
 * Started from a selection on the tape chart, so the dates and the first room
 * are already chosen; the desk ticks the other rooms the party needs. Each
 * room becomes its own reservation under the group's name, priced by the same
 * quote as a single booking, and can be renamed to its actual guest later.
 *
 * Rooms the chart already shows as taken for these dates are greyed out. The
 * chart only knows its own window, so the server checks every room again and
 * refuses the whole group if any one is taken.
 */

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  return Math.round(
    (new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / 86400000
  );
}

function formatMoney(value) {
  return `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Why a room cannot join the group for these dates, as far as the chart knows. */
function roomBusy(room, checkIn, checkOut) {
  if (!room.is_active) return "out of order";
  const stay = room.reservations.find((r) => r.check_in < checkOut && r.check_out > checkIn);
  if (stay) return stay.guest_name;
  const block = (room.blocks || []).find((b) => b.start_date < checkOut && b.end_date > checkIn);
  if (block) return "out of order";
  return null;
}

export default function GroupBookingModal({ session, chart, initial, onClose, onChanged }) {
  const propertyId = session?.propertyId || null;

  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    check_in: initial.check_in,
    check_out: initial.check_out,
    rate_plan_id: "",
    adults: 2,
    notes: "",
  });
  const [selected, setSelected] = useState(() => new Set(initial.room_ids || []));
  const [ratePlans, setRatePlans] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);

  const nights = nightsBetween(form.check_in, form.check_out);

  useEffect(() => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    fetch(`/api/setup/ratePlans${qs}`)
      .then((r) => r.json())
      .then((d) => {
        const plans = d.ratePlans || [];
        setRatePlans(plans);
        // A group spans room types, so it starts on the property's master
        // plan -- the one every other plan is priced from.
        const master = plans.find((p) => p.is_master);
        if (master) {
          setForm((prev) => (prev.rate_plan_id ? prev : { ...prev, rate_plan_id: master.id }));
        }
      })
      .catch(() => {});
  }, [propertyId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allRooms = useMemo(
    () => chart.roomTypes.flatMap((rt) => rt.rooms),
    [chart]
  );

  /** How many rooms of each type are ticked, which is what gets priced. */
  const perType = useMemo(() => {
    const out = {};
    for (const room of allRooms) {
      if (selected.has(room.id)) out[room.room_type_id] = (out[room.room_type_id] || 0) + 1;
    }
    return out;
  }, [allRooms, selected]);

  const typeKey = Object.keys(perType).sort().join(",");

  // One quote per room type in the group: every room of a type costs the same.
  useEffect(() => {
    if (nights === 0 || !typeKey) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    Promise.all(
      typeKey.split(",").map(async (roomTypeId) => {
        const qs = new URLSearchParams({
          roomTypeId,
          checkIn: form.check_in,
          checkOut: form.check_out,
          adults: String(form.adults || 2),
        });
        if (propertyId) qs.set("propertyId", propertyId);
        if (form.rate_plan_id) qs.set("ratePlanId", form.rate_plan_id);
        const res = await fetch(`/api/pms/quote?${qs}`);
        const data = await res.json().catch(() => null);
        return [roomTypeId, res.ok ? data?.total ?? null : null];
      })
    ).then((entries) => {
      if (!cancelled) setQuotes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [typeKey, form.check_in, form.check_out, form.adults, form.rate_plan_id, nights, propertyId]);

  const estimate = Object.entries(perType).reduce(
    (sum, [id, count]) => (quotes[id] != null ? sum + quotes[id] * count : sum),
    0
  );
  const unpriced = Object.keys(perType).some((id) => quotes[id] == null);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setConflict(null);
  }

  function toggle(roomId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
    setConflict(null);
  }

  async function submit(allowOverbook = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          property_id: propertyId,
          room_ids: [...selected],
          allow_overbook: allowOverbook,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.availability) {
        setConflict(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not create the group");
      onChanged?.(inventoryWarning(data));
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

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
        style={{ width: "100%", maxWidth: 820, background: "var(--surface)" }}
      >
        <div
          style={{
            padding: "0.85rem 1.1rem",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.9rem",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
          }}
        >
          New group booking
        </div>

        <div className="card-pad space-y-4">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          >
            <div>
              <label className="label">Group name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Sharma wedding"
              />
            </div>
            <div>
              <label className="label">Contact person</label>
              <input
                className="input"
                value={form.contact_name}
                onChange={(e) => set("contact_name", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={form.contact_phone}
                onChange={(e) => set("contact_phone", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={form.contact_email}
                onChange={(e) => set("contact_email", e.target.value)}
              />
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
                min={form.check_in}
                value={form.check_out}
                onChange={(e) => set("check_out", e.target.value)}
              />
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
              <label className="label">Adults per room</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.adults}
                onChange={(e) => set("adults", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label className="label" style={{ margin: 0 }}>
                Rooms ({selected.size} chosen)
              </label>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                {selected.size > 0 && nights > 0 && (
                  <>
                    Estimated {formatMoney(estimate)} for {nights} night{nights === 1 ? "" : "s"}
                    {unpriced && " · some rooms have no rate set"}
                  </>
                )}
              </span>
            </div>

            {chart.roomTypes.map((rt) => (
              <div key={rt.id}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>
                  {rt.name}
                  {quotes[rt.id] != null && (
                    <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                      {" "}
                      · {formatMoney(quotes[rt.id])} per room
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {rt.rooms.map((room) => {
                    const taken = roomBusy(room, form.check_in, form.check_out);
                    const on = selected.has(room.id);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        disabled={Boolean(taken) && !on}
                        title={taken ? `Taken — ${taken}` : undefined}
                        onClick={() => toggle(room.id)}
                        className={`chip ${on ? "chip-ok" : "chip-off"}`}
                        style={{
                          cursor: taken && !on ? "not-allowed" : "pointer",
                          opacity: taken && !on ? 0.45 : 1,
                          border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
                          color: taken && on ? "var(--danger)" : undefined,
                        }}
                      >
                        {on ? "✓ " : ""}
                        {room.room_number}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Rooming list to follow, billing to company, arrival by coach…"
            />
          </div>

          <p className="sub" style={{ fontSize: "0.7rem" }}>
            Each room is booked as its own reservation under the group name, so it
            checks in and is billed on its own. Rename each to its guest once the
            rooming list arrives.
          </p>

          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          {conflict && (
            <div className="card card-pad text-sm space-y-2" style={{ borderColor: "var(--warn)" }}>
              <p style={{ color: "var(--warn)" }}>{conflict}</p>
              <button
                className="btn btn-secondary text-sm"
                disabled={busy}
                onClick={() => submit(true)}
              >
                Book anyway
              </button>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button className="btn btn-ghost text-sm" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary text-sm"
              disabled={busy || selected.size === 0}
              onClick={() => submit(false)}
            >
              {busy ? "Booking…" : `Book ${selected.size} room${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
