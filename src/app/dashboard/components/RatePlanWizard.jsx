"use client";

import { useMemo, useState } from "react";
import { MEAL_PLANS, planLabel } from "@/lib/mealPlans";
import { DERIVE_METHODS, eligibleMasters } from "@/lib/ratePlanPricing";

const METHOD_LABELS = {
  offset: "Amount",
  multiplier: "Multiply by",
  percent: "Percentage",
};

const STEPS = [
  { id: "general", label: "General information" },
  { id: "restrictions", label: "Restrictions & inclusions" },
  { id: "pricing", label: "Pricing" },
  { id: "rooms", label: "Room types & rates" },
];

const inputClass = "input";

function Field({ label, hint, children }) {
  return (
    <label className="block label">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs faint">{hint}</span>}
    </label>
  );
}

/**
 * Create or edit a rate plan.
 *
 * A rate plan is property-level: it describes what the guest is buying --
 * the meal basis, the terms, the stay limits, and how its rate is decided.
 * Room types are assigned to it in the last step, each with its own price,
 * so one plan can cost a different amount in a Deluxe than in a Suite
 * without being two separate plans.
 */
export default function RatePlanWizard({
  plan,
  ratePlans,
  roomTypes,
  assignments,
  onSave,
  onCancel,
  busy,
}) {
  const isNew = !plan?.id;
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  const [form, setForm] = useState(() => ({
    id: plan?.id,
    plan_name: plan?.plan_name ?? "",
    description: plan?.description ?? "",
    meal_plan: plan?.meal_plan ?? "EP",
    refundable: plan?.refundable !== false,
    min_stay: plan?.min_stay ?? "",
    max_stay: plan?.max_stay ?? "",
    release_period: plan?.release_period ?? "",
    stop_sell: Boolean(plan?.stop_sell),
    is_master: Boolean(plan?.is_master),
    derive_from_id: plan?.derive_from_id ?? "",
    derive_method: plan?.derive_method ?? "percent",
    derive_value: plan?.derive_value ?? "",
  }));

  // Rooms assigned to this plan, keyed by room id so a checkbox can toggle
  // one without disturbing the rates already typed into the others.
  const [rooms, setRooms] = useState(() => {
    const out = {};
    for (const a of assignments || []) {
      if (plan?.id && a.rate_plan_id !== plan.id) continue;
      out[a.room_type_id] = {
        room_type_id: a.room_type_id,
        full_rate: a.full_rate ?? "",
        included_occupancy: a.included_occupancy ?? "",
        extra_adult_rate: a.extra_adult_rate ?? "",
        extra_child_rate: a.extra_child_rate ?? "",
      };
    }
    return out;
  });

  const masters = useMemo(
    () => eligibleMasters({ ...form, property_id: plan?.property_id }, ratePlans),
    [form, ratePlans, plan]
  );

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function toggleRoom(room, on) {
    setRooms((prev) => {
      const next = { ...prev };
      if (on) {
        next[room.id] = next[room.id] || {
          room_type_id: room.id,
          full_rate: "",
          // Most rates are quoted for two adults; the room's own limit wins
          // where it is lower.
          included_occupancy: Math.min(room.max_adults || 2, 2),
          extra_adult_rate: "",
          extra_child_rate: "",
        };
      } else {
        delete next[room.id];
      }
      return next;
    });
  }

  function setRoomField(roomId, field, value) {
    setRooms((prev) => ({
      ...prev,
      [roomId]: { ...prev[roomId], [field]: value },
    }));
  }

  /** What blocks leaving the current step, or "" when it is complete. */
  function problemWith(index) {
    if (index === 0 && !form.plan_name.trim()) {
      return "Give the rate plan a name.";
    }
    if (index === 1) {
      const min = Number(form.min_stay);
      const max = Number(form.max_stay);
      if (form.min_stay !== "" && (!Number.isInteger(min) || min < 1)) {
        return "Minimum stay must be a whole number of nights.";
      }
      if (form.max_stay !== "" && (!Number.isInteger(max) || max < 1)) {
        return "Maximum stay must be a whole number of nights.";
      }
      if (form.min_stay !== "" && form.max_stay !== "" && min > max) {
        return `A minimum of ${min} nights cannot sit above a maximum of ${max}.`;
      }
      if (form.release_period !== "" && Number(form.release_period) < 0) {
        return "Release period cannot be negative.";
      }
    }
    if (index === 2 && form.derive_from_id) {
      if (form.derive_value === "" || !Number.isFinite(Number(form.derive_value))) {
        return "Set how much to adjust the derived rate by.";
      }
      if (form.derive_method === "multiplier" && Number(form.derive_value) <= 0) {
        return "A multiplier must be above zero.";
      }
    }
    if (index === 3) {
      for (const r of Object.values(rooms)) {
        if (r.full_rate === "" || Number(r.full_rate) < 0) {
          return "Every assigned room needs a full rate.";
        }
      }
    }
    return "";
  }

  function go(next) {
    const problem = problemWith(step);
    if (next > step && problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep(next);
  }

  function submit() {
    // Every step is re-checked, since a later edit can invalidate an earlier
    // one and the last step is reachable without revisiting them.
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemWith(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }
    setError("");
    onSave(form, Object.values(rooms));
  }

  const derived = Boolean(form.derive_from_id);

  return (
    <div className="card card-pad">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="h2 text-sm">
          {isNew ? "Add a rate plan" : `Edit ${plan.plan_name}`}
        </h3>
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row">
        {/* Steps */}
        <ol className="flex gap-3 sm:w-[190px] sm:flex-col sm:gap-1">
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
                    color: on
                      ? "var(--accent-text)"
                      : done
                      ? "var(--text)"
                      : "var(--text-muted)",
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]"
                    style={{
                      background: done
                        ? "var(--accent)"
                        : on
                        ? "var(--accent)"
                        : "var(--surface-2)",
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
        </ol>

        <div className="min-w-0 flex-1">
          {step === 0 && (
            <div className="space-y-3">
              <p className="sub">How would you describe this rate plan?</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Meal plan">
                  <select
                    value={form.meal_plan}
                    onChange={(e) => {
                      const next = { meal_plan: e.target.value };
                      // Keep the name in step with the code until it is edited.
                      if (
                        !form.plan_name ||
                        form.plan_name === planLabel(form)
                      ) {
                        next.plan_name = planLabel({ ...form, ...next });
                      }
                      set(next);
                    }}
                    className={inputClass}
                  >
                    {MEAL_PLANS.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code} — {m.hint}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Terms">
                  <select
                    value={form.refundable ? "ref" : "nr"}
                    onChange={(e) => {
                      const next = { refundable: e.target.value === "ref" };
                      if (
                        !form.plan_name ||
                        form.plan_name === planLabel(form)
                      ) {
                        next.plan_name = planLabel({ ...form, ...next });
                      }
                      set(next);
                    }}
                    className={inputClass}
                  >
                    <option value="ref">Refundable</option>
                    <option value="nr">Non-refundable</option>
                  </select>
                </Field>
                <Field label="Rate plan name *">
                  <input
                    value={form.plan_name}
                    onChange={(e) => set({ plan_name: e.target.value })}
                    className={inputClass}
                    placeholder={planLabel(form)}
                  />
                </Field>
              </div>
              <Field
                label="Description"
                hint="For your own reference. Guests never see this."
              >
                <textarea
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  className={inputClass}
                  rows={3}
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="sub mb-2">Limit the length of stay?</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum length of stay" hint="Nights. Leave blank for none.">
                    <input
                      type="number"
                      min="1"
                      value={form.min_stay}
                      onChange={(e) => set({ min_stay: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Maximum length of stay" hint="Nights. Leave blank for none.">
                    <input
                      type="number"
                      min="1"
                      value={form.max_stay}
                      onChange={(e) => set({ max_stay: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>

              <div>
                <p className="sub mb-2">Do guests need to book in advance?</p>
                <Field label="Release period" hint="Days before arrival. Blank for none.">
                  <input
                    type="number"
                    min="0"
                    value={form.release_period}
                    onChange={(e) => set({ release_period: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div>
                <p className="sub mb-2">Inclusions</p>
                <p className="text-xs faint">
                  Set by the meal plan: {form.meal_plan} —{" "}
                  {MEAL_PLANS.find((m) => m.code === form.meal_plan)?.hint}. Change
                  it in the first step.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.stop_sell}
                  onChange={(e) => set({ stop_sell: e.target.checked })}
                />
                Stop sell — close this plan by default
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="sub">How will you manage this plan&rsquo;s rates?</p>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="rate-setup"
                  checked={!derived}
                  onChange={() => set({ derive_from_id: "", derive_value: "" })}
                />
                Enter daily rates directly
              </label>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="rate-setup"
                  disabled={masters.length === 0}
                  checked={derived}
                  onChange={() =>
                    set({
                      derive_from_id: masters[0]?.id || "",
                      is_master: false,
                      derive_method: form.derive_method || "percent",
                    })
                  }
                />
                Derive daily rates from an existing rate plan
              </label>

              {masters.length === 0 && !derived && (
                <p className="pl-6 text-xs faint">
                  Needs another rate plan to derive from.
                </p>
              )}

              {derived ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Derived from *">
                    <select
                      value={form.derive_from_id}
                      onChange={(e) => set({ derive_from_id: e.target.value })}
                      className={inputClass}
                    >
                      {masters.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.plan_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Adjust daily rates by *">
                    <select
                      value={form.derive_method}
                      onChange={(e) => set({ derive_method: e.target.value })}
                      className={inputClass}
                    >
                      {DERIVE_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Adjustment *">
                    {form.derive_method === "multiplier" ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.derive_value}
                        onChange={(e) => set({ derive_value: e.target.value })}
                        className={inputClass}
                        placeholder="0.90"
                      />
                    ) : (
                      <div className="flex gap-2">
                        <select
                          value={Number(form.derive_value) < 0 ? "down" : "up"}
                          onChange={(e) => {
                            const mag = Math.abs(Number(form.derive_value) || 0);
                            set({
                              derive_value: e.target.value === "down" ? -mag : mag,
                            });
                          }}
                          className={inputClass}
                          style={{ flex: "0 0 52%" }}
                          aria-label="Direction"
                        >
                          <option value="up">Increase by</option>
                          <option value="down">Decrease by</option>
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={
                            form.derive_value === "" || form.derive_value === null
                              ? ""
                              : Math.abs(Number(form.derive_value))
                          }
                          onChange={(e) => {
                            const mag =
                              e.target.value === ""
                                ? ""
                                : Math.abs(Number(e.target.value));
                            const down = Number(form.derive_value) < 0;
                            set({
                              derive_value: mag === "" ? "" : down ? -mag : mag,
                            });
                          }}
                          className={inputClass}
                          placeholder={form.derive_method === "percent" ? "10" : "500"}
                        />
                      </div>
                    )}
                  </Field>
                </div>
              ) : (
                <label className="flex items-center gap-2 sub">
                  <input
                    type="checkbox"
                    checked={form.is_master}
                    onChange={(e) => set({ is_master: e.target.checked })}
                  />
                  This is a master plan
                </label>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="sub">
                Which rooms can be booked on this plan, and at what rate?
              </p>

              {roomTypes.length === 0 ? (
                <p className="text-sm faint">
                  No room types yet. Add one under Room Setup first.
                </p>
              ) : (
                <div className="overflow-x-auto card">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide muted">
                        <th className="px-3 py-2.5">Room type</th>
                        <th className="px-3 py-2.5">Full rate *</th>
                        <th className="px-3 py-2.5">Included occupancy</th>
                        <th className="px-3 py-2.5">Extra adult</th>
                        <th className="px-3 py-2.5">Extra child</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomTypes.map((room) => {
                        const on = Boolean(rooms[room.id]);
                        const row = rooms[room.id];
                        return (
                          <tr key={room.id}>
                            <td className="px-3 py-2">
                              <label className="flex items-center gap-2 text-ink">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) => toggleRoom(room, e.target.checked)}
                                />
                                <span>
                                  {room.room_type_name}
                                  <span className="block text-xs faint">
                                    max {room.max_adults || 2} adults
                                  </span>
                                </span>
                              </label>
                            </td>
                            {["full_rate", "included_occupancy", "extra_adult_rate", "extra_child_rate"].map(
                              (field) => (
                                <td key={field} className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={field === "included_occupancy" ? "1" : "0"}
                                    step={field === "included_occupancy" ? "1" : "0.01"}
                                    disabled={!on}
                                    value={on ? row[field] : ""}
                                    onChange={(e) =>
                                      setRoomField(room.id, field, e.target.value)
                                    }
                                    className={inputClass}
                                    style={{ opacity: on ? 1 : 0.4, width: 96 }}
                                    aria-label={`${room.room_type_name} ${field}`}
                                  />
                                </td>
                              )
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs faint">
                A plan with no rooms assigned is saved, but cannot be sold until at
                least one is added.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => go(step - 1)}
                className="btn btn-secondary text-sm"
              >
                ← Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => go(step + 1)}
                className="btn btn-primary text-sm"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="btn btn-primary text-sm"
              >
                {busy ? "Saving…" : isNew ? "Create rate plan" : "Save changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
