"use client";

import { useEffect, useMemo, useState } from "react";
import { inventoryWarning } from "@/lib/inventoryNotice";
import { plansForRoom } from "@/lib/ratePlanPricing";

/**
 * Booking several rooms at once for one party, as a three-step wizard.
 *
 * Started from a selection on the tape chart, so the dates and the first room
 * are already chosen. The desk names the party, ticks the rooms it needs, then
 * sets each room on its own -- who is in it, which plan, how many -- because a
 * wedding is rarely twelve identical doubles: the parents are on breakfast,
 * the cousins are three to a room, the couple is complimentary in all but name.
 *
 * Each room becomes its own reservation under the group's name, priced by the
 * same quote as a single booking, so it checks in and is billed on its own.
 *
 * Rooms the chart already shows as taken for these dates are greyed out. The
 * chart only knows its own window, so the server checks every room again and
 * refuses the whole group if any one is taken.
 */

const STEPS = [
  { id: "group", label: "Group & dates" },
  { id: "rooms", label: "Choose rooms" },
  { id: "rates", label: "Guests & rates" },
];

const GROUP_SOURCES = [
  { value: "group", label: "Group" },
  { value: "direct", label: "Direct" },
  { value: "corporate", label: "Corporate" },
  { value: "travel_agent", label: "Travel agent" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
];

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

/** Rooms of one type cost the same for the same plan and party. */
function quoteKey(roomTypeId, line) {
  return [roomTypeId, line.rate_plan_id || "", line.adults, line.children].join("|");
}

/** The plan a room is normally sold under: its type's master plan, else its first. */
function defaultPlan(plans) {
  return (plans.find((p) => p.is_master) || plans[0])?.id || "";
}

export default function GroupBookingModal({ session, chart, initial, onClose, onChanged }) {
  const propertyId = session?.propertyId || null;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    source: "group",
    check_in: initial.check_in,
    check_out: initial.check_out,
    notes: "",
  });
  const [selected, setSelected] = useState(() => new Set(initial.room_ids || []));

  /**
   * One line per chosen room. `planAuto` means the plan is still the default
   * the form picked, so it may follow the setup as it loads; once the desk
   * chooses a plan for a room it stays chosen. `total_amount` is empty while
   * the room is priced by quote and holds a figure once someone types one.
   */
  const [lines, setLines] = useState({});

  const [ratePlans, setRatePlans] = useState([]);
  const [assignments, setAssignments] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);

  // "Apply to all rooms" on the last step.
  const [bulk, setBulk] = useState({ rate_plan_id: "", adults: "", children: "" });

  const nights = nightsBetween(form.check_in, form.check_out);

  useEffect(() => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    fetch(`/api/setup/ratePlans${qs}`)
      .then((r) => r.json())
      .then((d) => setRatePlans(d.ratePlans || []))
      .catch(() => {});
    fetch(`/api/setup/ratePlanRooms${qs}`)
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => setAssignments(d.assignments || []))
      .catch(() => setAssignments([]));
  }, [propertyId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allRooms = useMemo(() => chart.roomTypes.flatMap((rt) => rt.rooms), [chart]);
  const typeById = useMemo(
    () => Object.fromEntries(chart.roomTypes.map((rt) => [rt.id, rt])),
    [chart]
  );

  /** The plans each room type is sold under. */
  const plansByType = useMemo(() => {
    const out = {};
    for (const rt of chart.roomTypes) {
      out[rt.id] = assignments ? plansForRoom(ratePlans, rt.id, assignments) : [];
    }
    return out;
  }, [chart, ratePlans, assignments]);

  /** Chosen rooms in chart order, so the grid reads like the chart. */
  const chosenRooms = useMemo(
    () => allRooms.filter((room) => selected.has(room.id)),
    [allRooms, selected]
  );

  // Every chosen room has a line; a default plan follows the setup as it loads.
  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const room of chosenRooms) {
        const plans = plansByType[room.room_type_id] || [];
        const line = next[room.id];
        if (!line) {
          const type = typeById[room.room_type_id];
          next[room.id] = {
            guest_name: "",
            rate_plan_id: defaultPlan(plans),
            planAuto: true,
            adults: Math.min(2, Number(type?.max_adults) || 2),
            children: 0,
            total_amount: "",
          };
          changed = true;
        } else if (line.planAuto) {
          const pick = defaultPlan(plans);
          if (pick !== line.rate_plan_id) {
            next[room.id] = { ...line, rate_plan_id: pick };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [chosenRooms, plansByType, typeById]);

  /** Every distinct (type, plan, party) the group needs priced. */
  const needed = useMemo(() => {
    const out = {};
    for (const room of chosenRooms) {
      const line = lines[room.id];
      if (!line) continue;
      out[quoteKey(room.room_type_id, line)] = { roomTypeId: room.room_type_id, line };
    }
    return out;
  }, [chosenRooms, lines]);

  const neededKey = Object.keys(needed).sort().join(";");

  useEffect(() => {
    if (nights === 0 || !neededKey) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    Promise.all(
      Object.entries(needed).map(async ([key, { roomTypeId, line }]) => {
        const qs = new URLSearchParams({
          roomTypeId,
          checkIn: form.check_in,
          checkOut: form.check_out,
          adults: String(line.adults || 1),
          children: String(line.children || 0),
        });
        if (propertyId) qs.set("propertyId", propertyId);
        if (line.rate_plan_id) qs.set("ratePlanId", line.rate_plan_id);
        try {
          const res = await fetch(`/api/pms/quote?${qs}`);
          const data = await res.json();
          return [key, res.ok ? data?.total ?? null : null];
        } catch {
          return [key, null];
        }
      })
    ).then((entries) => {
      if (!cancelled) setQuotes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // `needed` is summarised by neededKey; the dates are what else moves a price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey, form.check_in, form.check_out, nights, propertyId]);

  /** What a room will be charged: the typed figure, else its quote. */
  function priceOf(room) {
    const line = lines[room.id];
    if (!line) return null;
    if (line.total_amount !== "") return Number(line.total_amount);
    return quotes[quoteKey(room.room_type_id, line)] ?? null;
  }

  const total = chosenRooms.reduce((sum, room) => sum + (priceOf(room) ?? 0), 0);
  const unpriced = chosenRooms.filter((room) => priceOf(room) == null).length;

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setConflict(null);
  }

  function setLine(roomId, patch) {
    setLines((prev) => ({ ...prev, [roomId]: { ...prev[roomId], ...patch } }));
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

  /**
   * Set every room at once. A plan is only applied to rooms whose type sells
   * it -- the others keep theirs, and the note under the bar says how many.
   */
  function applyToAll() {
    setLines((prev) => {
      const next = { ...prev };
      for (const room of chosenRooms) {
        const line = { ...next[room.id] };
        if (bulk.rate_plan_id) {
          const sells = (plansByType[room.room_type_id] || []).some(
            (p) => p.id === bulk.rate_plan_id
          );
          if (sells) {
            line.rate_plan_id = bulk.rate_plan_id;
            line.planAuto = false;
          }
        }
        if (bulk.adults !== "") line.adults = bulk.adults;
        if (bulk.children !== "") line.children = bulk.children;
        next[room.id] = line;
      }
      return next;
    });
  }

  const bulkSkips = bulk.rate_plan_id
    ? chosenRooms.filter(
        (room) =>
          !(plansByType[room.room_type_id] || []).some((p) => p.id === bulk.rate_plan_id)
      ).length
    : 0;

  /** What blocks leaving a step, or "" when it is complete. */
  function problemWith(i) {
    if (i === 0) {
      if (!form.name.trim()) return "Give the group a name.";
      if (!form.check_in || !form.check_out) return "Choose the dates.";
      if (nights === 0) return "Check-out must be at least one night after check-in.";
    }
    if (i === 1) {
      if (chosenRooms.length === 0) return "Choose at least one room.";
      const taken = chosenRooms.filter((room) => roomBusy(room, form.check_in, form.check_out));
      if (taken.length > 0) {
        const many = taken.length > 1;
        return `${many ? "Rooms" : "Room"} ${taken.map((r) => r.room_number).join(", ")} ${many ? "are" : "is"} taken on these dates — untick ${many ? "them" : "it"} or change the dates.`;
      }
    }
    if (i === 2) {
      const bad = chosenRooms.find((room) => !(Number(lines[room.id]?.adults) >= 1));
      if (bad) return `Room ${bad.room_number} needs at least one adult.`;
    }
    return "";
  }

  function go(next) {
    for (let i = 0; i < next; i++) {
      const problem = problemWith(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }
    setError(null);
    setStep(next);
  }

  async function submit(allowOverbook = false) {
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemWith(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          property_id: propertyId,
          rooms: chosenRooms.map((room) => {
            const line = lines[room.id];
            return {
              room_id: room.id,
              guest_name: line.guest_name,
              rate_plan_id: line.rate_plan_id || null,
              adults: Number(line.adults),
              children: Number(line.children) || 0,
              total_amount: line.total_amount === "" ? null : Number(line.total_amount),
            };
          }),
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

  const planName = (id) => ratePlans.find((p) => p.id === id)?.plan_name;

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
        className="card booking-form"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 1040, background: "var(--surface)" }}
      >
        <div
          className="flex items-center justify-between"
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
          <span>
            New group booking
            {form.name.trim() && <span style={{ fontWeight: 400 }}> — {form.name.trim()}</span>}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: 0, color: "#fff", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <div className="card-pad flex flex-col gap-5 sm:flex-row">
          {/* Steps */}
          <ol className="flex gap-3 sm:w-[180px] sm:flex-shrink-0 sm:flex-col sm:gap-1">
            {STEPS.map((s, i) => {
              const on = i === step;
              const done = i < step;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
                    style={{
                      background: on ? "var(--accent-soft)" : "transparent",
                      color: on ? "var(--accent-text)" : done ? "var(--text)" : "var(--text-muted)",
                      fontWeight: on ? 600 : 500,
                    }}
                  >
                    <span
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]"
                      style={{
                        background: done || on ? "var(--accent)" : "var(--surface-2)",
                        color: done || on ? "#fff" : "var(--text-faint)",
                      }}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                </li>
              );
            })}

            {/* What has been decided so far, so the later steps keep their context. */}
            <li className="hidden sm:block" style={{ marginTop: "1rem" }}>
              <div className="sub space-y-1" style={{ fontSize: "0.7rem", padding: "0 0.5rem" }}>
                {nights > 0 && (
                  <p>
                    {form.check_in} → {form.check_out}
                    <br />
                    {nights} night{nights === 1 ? "" : "s"}
                  </p>
                )}
                {chosenRooms.length > 0 && (
                  <p>
                    {chosenRooms.length} room{chosenRooms.length === 1 ? "" : "s"}
                  </p>
                )}
                {chosenRooms.length > 0 && nights > 0 && (
                  <p style={{ color: "var(--text)", fontWeight: 600 }}>{formatMoney(total)}</p>
                )}
              </div>
            </li>
          </ol>

          <div className="min-w-0 flex-1 space-y-4">
            {step === 0 && (
              <>
                <p className="sub">Who is the group, and when are they staying?</p>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  <div className="col-span-2">
                    <label className="label">Group name</label>
                    <input
                      className="input"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Sharma wedding"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="label">Source</label>
                    <select
                      className="input"
                      value={form.source}
                      onChange={(e) => set("source", e.target.value)}
                    >
                      {GROUP_SOURCES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div />

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
                      type="tel"
                      value={form.contact_phone}
                      onChange={(e) => set("contact_phone", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
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
                    <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
                      {nights ? `${nights} night${nights === 1 ? "" : "s"}` : "Pick a later date"}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="label">Notes</label>
                  <textarea
                    className="input"
                    rows={2}
                    style={{ resize: "vertical" }}
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    placeholder="Rooming list to follow, billing to company, arrival by coach…"
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <p className="sub">
                  Which rooms does the group need? Rooms already taken on these dates are
                  greyed out.
                </p>
                {chart.roomTypes.map((rt) => {
                  const count = rt.rooms.filter((r) => selected.has(r.id)).length;
                  return (
                    <div key={rt.id}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>
                        {rt.name}
                        {count > 0 && (
                          <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                            {" "}
                            · {count} chosen
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
                                padding: "0.3rem 0.7rem",
                                fontSize: "0.8rem",
                              }}
                            >
                              {on ? "✓ " : ""}
                              {room.room_number}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {step === 2 && (
              <>
                <p className="sub">
                  Set each room on its own. Guest names can be left blank and filled in
                  when the rooming list arrives — the room is booked under the group name
                  until then.
                </p>

                {/* Apply to all */}
                <div
                  className="flex flex-wrap items-end gap-2 rounded p-2"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div style={{ minWidth: 180 }}>
                    <label className="label">Rate plan for all</label>
                    <select
                      className="cm-input"
                      value={bulk.rate_plan_id}
                      onChange={(e) => setBulk((b) => ({ ...b, rate_plan_id: e.target.value }))}
                    >
                      <option value="">Keep each room's</option>
                      {ratePlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.plan_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 90 }}>
                    <label className="label">Adults</label>
                    <input
                      className="cm-input"
                      type="number"
                      min="1"
                      placeholder="—"
                      value={bulk.adults}
                      onChange={(e) => setBulk((b) => ({ ...b, adults: e.target.value }))}
                    />
                  </div>
                  <div style={{ width: 90 }}>
                    <label className="label">Children</label>
                    <input
                      className="cm-input"
                      type="number"
                      min="0"
                      placeholder="—"
                      value={bulk.children}
                      onChange={(e) => setBulk((b) => ({ ...b, children: e.target.value }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={!bulk.rate_plan_id && bulk.adults === "" && bulk.children === ""}
                    onClick={applyToAll}
                  >
                    Apply to all rooms
                  </button>
                  {bulkSkips > 0 && (
                    <span className="sub" style={{ fontSize: "0.7rem" }}>
                      {bulkSkips} room{bulkSkips === 1 ? " is" : "s are"} not sold on{" "}
                      {planName(bulk.rate_plan_id)} and will keep {bulkSkips === 1 ? "its" : "their"} plan.
                    </span>
                  )}
                </div>

                <div className="card" style={{ overflowX: "auto" }}>
                  <table className="cm-grid" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th style={{ minWidth: 170 }}>Guest name</th>
                        <th style={{ minWidth: 170 }}>Rate plan</th>
                        <th style={{ width: 80 }}>Adults</th>
                        <th style={{ width: 80 }}>Children</th>
                        <th style={{ width: 130, textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.roomTypes.map((rt) => {
                        const rows = chosenRooms.filter((r) => r.room_type_id === rt.id);
                        if (rows.length === 0) return null;
                        const plans = plansByType[rt.id] || [];
                        return [
                          <tr key={`${rt.id}-group`} className="cm-group">
                            <td colSpan={6} style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                              {rt.name}
                              <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                                {" "}
                                · {rows.length} room{rows.length === 1 ? "" : "s"}
                                {rt.max_adults ? ` · up to ${rt.max_adults} adults` : ""}
                              </span>
                            </td>
                          </tr>,
                          ...rows.map((room) => {
                            const line = lines[room.id];
                            if (!line) return null;
                            const quoted = quotes[quoteKey(room.room_type_id, line)];
                            const typed = line.total_amount !== "";
                            const tooMany =
                              rt.max_adults && Number(line.adults) > Number(rt.max_adults);
                            // A plan this type no longer sells still shows, so nothing is silently changed.
                            const options =
                              line.rate_plan_id && !plans.some((p) => p.id === line.rate_plan_id)
                                ? [...plans, ...ratePlans.filter((p) => p.id === line.rate_plan_id)]
                                : plans;
                            return (
                              <tr key={room.id}>
                                <td style={{ fontWeight: 600, paddingLeft: "1.25rem" }}>
                                  {room.room_number}
                                </td>
                                <td>
                                  <input
                                    className="cm-input"
                                    value={line.guest_name}
                                    placeholder={form.name || "Group name"}
                                    onChange={(e) => setLine(room.id, { guest_name: e.target.value })}
                                  />
                                </td>
                                <td>
                                  <select
                                    className="cm-input"
                                    value={line.rate_plan_id}
                                    onChange={(e) =>
                                      setLine(room.id, {
                                        rate_plan_id: e.target.value,
                                        planAuto: false,
                                      })
                                    }
                                  >
                                    <option value="">None</option>
                                    {options.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.plan_name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    className={`cm-input ${tooMany ? "is-invalid" : ""}`}
                                    type="number"
                                    min="1"
                                    title={tooMany ? `${rt.name} takes up to ${rt.max_adults} adults` : undefined}
                                    value={line.adults}
                                    onChange={(e) => setLine(room.id, { adults: e.target.value })}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="cm-input"
                                    type="number"
                                    min="0"
                                    value={line.children}
                                    onChange={(e) => setLine(room.id, { children: e.target.value })}
                                  />
                                </td>
                                <td>
                                  <input
                                    className={`cm-input ${typed ? "is-edited" : ""}`}
                                    type="number"
                                    min="0"
                                    value={typed ? line.total_amount : quoted ?? ""}
                                    placeholder={quoted === undefined ? "Pricing…" : "No rate"}
                                    onChange={(e) => setLine(room.id, { total_amount: e.target.value })}
                                  />
                                  {typed && quoted != null && (
                                    <button
                                      type="button"
                                      onClick={() => setLine(room.id, { total_amount: "" })}
                                      style={{
                                        display: "block",
                                        marginLeft: "auto",
                                        padding: 0,
                                        border: 0,
                                        background: "none",
                                        color: "var(--accent)",
                                        cursor: "pointer",
                                        fontSize: "0.7rem",
                                        textDecoration: "underline",
                                      }}
                                    >
                                      Use {formatMoney(quoted)}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          }),
                        ];
                      })}
                      <tr className="cm-group">
                        <td colSpan={5} style={{ fontWeight: 600 }}>
                          Group total · {chosenRooms.length} room
                          {chosenRooms.length === 1 ? "" : "s"} × {nights} night
                          {nights === 1 ? "" : "s"}
                          {unpriced > 0 && (
                            <span style={{ fontWeight: 400, color: "var(--warn)" }}>
                              {" "}
                              · {unpriced} room{unpriced === 1 ? " has" : "s have"} no rate set
                            </span>
                          )}
                        </td>
                        <td style={{ fontWeight: 600, textAlign: "right" }}>{formatMoney(total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="sub" style={{ fontSize: "0.7rem" }}>
                  Each room is booked as its own reservation, so it checks in and is billed
                  on its own. A total typed by hand replaces the quoted price for that room.
                </p>
              </>
            )}

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

            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  disabled={busy}
                  onClick={() => go(step - 1)}
                >
                  ← Back
                </button>
              )}
              <button className="btn btn-ghost text-sm ml-auto" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn-primary text-sm" onClick={() => go(step + 1)}>
                  Next →
                </button>
              ) : (
                <button
                  className="btn btn-primary text-sm"
                  disabled={busy || chosenRooms.length === 0}
                  onClick={() => submit(false)}
                >
                  {busy
                    ? "Booking…"
                    : `Book ${chosenRooms.length} room${chosenRooms.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
