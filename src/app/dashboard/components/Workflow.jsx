"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid, Loading, Messages, SetupHeader, sendJSON } from "./SetupGrid";
import { Drawer, Field, RowMenu, Section } from "./RatePlanSetup";
import { useDialog } from "../../components/Dialog";
import Hint from "../../components/Hint";

/**
 * Workflow: rules that stop sell on chosen channels when a night fills up.
 *
 * "When Deluxe has 5 or more sold, stop selling it on Agoda." Rules are
 * checked on every booking, cancellation and room block, and once a day.
 * A rule reopens only what it closed; a channel someone set by hand in the
 * Channel Manager is left as they set it.
 *
 * Laid out like Rate Plan Setup: a list to read, a drawer to change.
 */

const METRIC_OPTIONS = [
  { id: "sold", label: "Rooms sold", word: "or more", unit: "" },
  { id: "left", label: "Rooms left", word: "or fewer", unit: "" },
  { id: "occupancy", label: "Occupancy", word: "or more", unit: "%" },
];
const metricOf = (id) => METRIC_OPTIONS.find((m) => m.id === id) || METRIC_OPTIONS[0];

const EMPTY = {
  name: "",
  enabled: true,
  room_type_id: "",
  metric: "sold",
  threshold: "",
  channels: [],
  rate_plan_ids: [],
  within_days: "",
};

/** What a run did, in a sentence, or "" when it changed nothing. */
function resultNote(result) {
  if (!result || result.status === "none") return "";
  return result.message || "";
}

export default function Workflow({ session }) {
  const dialog = useDialog();
  const propertyId = session?.propertyId || "";
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/workflow${scope}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load workflow rules");
      setData(json);
    } catch (err) {
      setError(err.message);
      setData((d) => d || { rules: [], roomTypes: [], ratePlans: [], channels: [] });
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const roomName = useMemo(
    () => Object.fromEntries((data?.roomTypes || []).map((r) => [r.id, r.name])),
    [data]
  );
  const planName = useMemo(
    () => Object.fromEntries((data?.ratePlans || []).map((p) => [p.id, p.name])),
    [data]
  );
  const channelName = useMemo(
    () => Object.fromEntries((data?.channels || []).map((c) => [c.slug, c.label])),
    [data]
  );

  async function act(action, done) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const json = await action();
      await load();
      setNotice([done, resultNote(json?.result)].filter(Boolean).join(" "));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (rule) =>
    act(
      () =>
        sendJSON("/api/workflow", "PUT", {
          propertyId: propertyId || undefined,
          rule: { ...rule, enabled: !rule.enabled },
        }),
      rule.enabled ? `Switched off "${rule.name}".` : `Switched on "${rule.name}".`
    );

  async function remove(rule) {
    if (
      !(await dialog.confirm({
        title: `Delete rule "${rule.name}"?`,
        message: "Every channel it closed is reopened first.",
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    const params = new URLSearchParams({ id: rule.id });
    if (propertyId) params.set("propertyId", propertyId);
    await act(() => sendJSON(`/api/workflow?${params}`, "DELETE"), `Deleted "${rule.name}".`);
  }

  const runNow = () =>
    act(
      () => sendJSON("/api/workflow/run", "POST", { propertyId: propertyId || undefined }),
      "Rules checked."
    );

  if (!data) return <Loading label="Loading workflow rules…" />;

  const rules = data.rules || [];

  return (
    <div className="space-y-4">
      <SetupHeader
        area="Rates"
        title="Workflow"
        count={rules.length}
        sub="Close chosen channels automatically when a night fills up. A rule reopens only what it closed."
      >
        <button type="button" className="btn btn-secondary" onClick={runNow} disabled={busy || !rules.length}>
          {busy ? "Working…" : "Run now"}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setDrawer({ rule: null })}>
          + Add rule
        </button>
      </SetupHeader>

      <Hint id="workflow">
        Rules are checked on every booking, cancellation and room block, and again each morning.
      </Hint>

      <Messages error={error} notice={notice} />

      {rules.length === 0 ? (
        <div className="card card-pad text-center" style={{ padding: "48px 24px" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            No rules yet
          </p>
          <p className="sub mx-auto mt-1 max-w-[460px]">
            For example: when Deluxe has 5 or more rooms sold on a night, stop selling it on
            Agoda for that night, and open it again if a cancellation brings it back under 5.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => setDrawer({ rule: null })}>
            + Add rule
          </button>
        </div>
      ) : (
        <Grid>
          <thead>
            <tr>
              <th className="cm-sticky" style={{ minWidth: 200 }}>
                Rule
              </th>
              <th style={{ minWidth: 220 }}>When</th>
              <th style={{ minWidth: 220 }}>Then stop sell</th>
              <th style={{ minWidth: 130 }}>Nights</th>
              <th style={{ minWidth: 90 }}>Status</th>
              <th style={{ width: 48 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const m = metricOf(rule.metric);
              const plans = rule.rate_plan_ids?.length
                ? rule.rate_plan_ids.map((id) => planName[id] || "Deleted plan").join(", ")
                : "every rate plan";
              return (
                <tr key={rule.id} style={rule.enabled ? undefined : { opacity: 0.6 }}>
                  <td className="cm-sticky">
                    <button
                      type="button"
                      className="text-left font-semibold"
                      onClick={() => setDrawer({ rule })}
                    >
                      {rule.name}
                    </button>
                  </td>
                  <td>
                    {rule.room_type_id ? roomName[rule.room_type_id] || "Deleted room type" : "Whole hotel"}:{" "}
                    {m.label.toLowerCase()} {Number(rule.threshold)}
                    {m.unit} {m.word}
                  </td>
                  <td>
                    <div>{(rule.channels || []).map((c) => channelName[c] || c).join(", ")}</div>
                    <div className="text-xs muted">{plans}</div>
                  </td>
                  <td>{rule.within_days ? `Next ${rule.within_days} night${rule.within_days === 1 ? "" : "s"}` : "All future"}</td>
                  <td>
                    <span className={rule.enabled ? "chip chip-ok" : "chip chip-off"}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </td>
                  <td>
                    <RowMenu
                      title={rule.name}
                      items={[
                        { label: "Edit", onClick: () => setDrawer({ rule }) },
                        {
                          label: rule.enabled ? "Switch off" : "Switch on",
                          disabled: busy,
                          onClick: () => toggle(rule),
                        },
                        { label: "Delete", danger: true, disabled: busy, onClick: () => remove(rule) },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Grid>
      )}

      <p className="text-xs faint">
        What each rule closed and reopened is listed under Activity Log → Workflow.
      </p>

      {drawer && (
        <RuleDrawer
          rule={drawer.rule}
          data={data}
          onClose={() => setDrawer(null)}
          onSave={async (rule) => {
            // Errors stay in the drawer, which covers the page's messages.
            const json = await sendJSON("/api/workflow", rule.id ? "PUT" : "POST", {
              propertyId: propertyId || undefined,
              rule,
            });
            setDrawer(null);
            setError("");
            setNotice([`Saved "${rule.name}".`, resultNote(json?.result)].filter(Boolean).join(" "));
            await load();
          }}
        />
      )}
    </div>
  );
}

function RuleDrawer({ rule, data, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    rule
      ? {
          ...EMPTY,
          ...rule,
          room_type_id: rule.room_type_id || "",
          threshold: rule.threshold ?? "",
          channels: rule.channels || [],
          rate_plan_ids: rule.rate_plan_ids || [],
          within_days: rule.within_days ?? "",
        }
      : EMPTY
  );
  const [plansMode, setPlansMode] = useState(rule?.rate_plan_ids?.length ? "some" : "all");
  const [windowMode, setWindowMode] = useState(rule?.within_days ? "some" : "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const m = metricOf(form.metric);

  // The plans sold in the chosen room type, or in any room for the hotel.
  const planChoices = useMemo(() => {
    const ids = form.room_type_id
      ? new Set(data.roomTypes.find((r) => r.id === form.room_type_id)?.plans || [])
      : new Set(data.roomTypes.flatMap((r) => r.plans));
    return data.ratePlans.filter((p) => ids.has(p.id));
  }, [form.room_type_id, data]);

  const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function problem() {
    if (!form.name.trim()) return "Give the rule a name.";
    if (form.threshold === "" || !Number.isFinite(Number(form.threshold))) {
      return "Give the number the rule acts at.";
    }
    if (!form.channels.length) return "Choose at least one channel to stop selling on.";
    if (plansMode === "some" && !form.rate_plan_ids.some((id) => planChoices.some((p) => p.id === id))) {
      return "Choose at least one rate plan, or pick every rate plan.";
    }
    if (windowMode === "some" && !(Number(form.within_days) >= 1)) {
      return "Give how many nights ahead the rule looks.";
    }
    return null;
  }

  async function save() {
    const p = problem();
    if (p) {
      setError(p);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
      id: rule?.id,
      name: form.name.trim(),
      enabled: form.enabled,
      room_type_id: form.room_type_id || null,
      metric: form.metric,
      threshold: Number(form.threshold),
      channels: form.channels,
      // Only plans still offered for the chosen room count.
      rate_plan_ids:
        plansMode === "some"
          ? form.rate_plan_ids.filter((id) => planChoices.some((p) => p.id === id))
          : null,
      within_days: windowMode === "some" ? Number(form.within_days) : null,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const radio = (name, value, current, onChange, label) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      {label}
    </label>
  );

  return (
    <Drawer
      title={rule ? "Edit rule" : "Add rule"}
      subtitle={rule?.name}
      onCancel={onClose}
      onSave={save}
      busy={busy}
      error={error}
    >
      <Field label="Name">
        <input
          className="input w-full"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Deluxe: close Agoda at 5 sold"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Rule is on
      </label>

      <Section title="When">
        <Field label="Watch" hint="A whole-hotel rule reads the night's totals and closes every room type.">
          <select
            className="input w-full"
            value={form.room_type_id}
            onChange={(e) => set({ room_type_id: e.target.value })}
          >
            <option value="">Whole hotel</option>
            {data.roomTypes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Counts">
            <select className="input" value={form.metric} onChange={(e) => set({ metric: e.target.value })}>
              {METRIC_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.unit ? "At (%)" : "At"}>
            <input
              type="number"
              inputMode="numeric"
              min={form.metric === "sold" ? 1 : 0}
              max={form.metric === "occupancy" ? 100 : undefined}
              className="input w-28"
              value={form.threshold}
              onChange={(e) => set({ threshold: e.target.value })}
            />
          </Field>
          <span className="pb-2 text-sm muted">{m.word}, on a night</span>
        </div>
        <p className="text-xs faint">
          {form.metric === "occupancy"
            ? "Occupancy is rooms sold over every room the hotel has; out-of-order rooms are not taken off."
            : form.metric === "left"
            ? "Rooms left is what the channels are offered: rooms not sold and not out of order."
            : "Rooms sold counts every booking holding that night."}
        </p>
      </Section>

      <Section title="Then stop sell on">
        {!data.channelsLive && (
          <p className="text-xs faint">
            The channel manager is not connected, so these are the usual channels rather than this
            hotel&apos;s. Until it is, rules are worked out and logged but nothing is sent.
          </p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {data.channels.map((c) => (
            <label key={c.slug} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.channels.includes(c.slug)}
                onChange={() => set({ channels: toggleIn(form.channels, c.slug) })}
              />
              {c.label}
            </label>
          ))}
        </div>

        <div className="space-y-2 pt-2">
          <span className="label">Rate plans</span>
          {radio("plans", "all", plansMode, setPlansMode, "Every rate plan sold in the room")}
          {radio("plans", "some", plansMode, setPlansMode, "Only these")}
          {plansMode === "some" && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 pl-6">
              {planChoices.length === 0 && <span className="text-sm muted">No rate plans are sold in this room type.</span>}
              {planChoices.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.rate_plan_ids.includes(p.id)}
                    onChange={() => set({ rate_plan_ids: toggleIn(form.rate_plan_ids, p.id) })}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Nights">
        {radio("window", "all", windowMode, setWindowMode, "Every future night")}
        <div className="flex flex-wrap items-center gap-2">
          {radio("window", "some", windowMode, setWindowMode, "Only the next")}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            className="input w-20"
            value={form.within_days}
            disabled={windowMode !== "some"}
            onChange={(e) => set({ within_days: e.target.value })}
            aria-label="Nights ahead"
          />
          <span className="text-sm">nights, starting tonight</span>
        </div>
      </Section>

      <Section title="Opening again">
        <p className="text-sm muted">
          When a cancellation takes a night back under the mark, the rule reopens the channels it
          closed. A channel you set by hand in Rates &amp; Inventory is never changed by a rule; set
          it to Open there to keep it selling whatever the rule says. Switching the rule off or
          deleting it reopens everything it closed.
        </p>
      </Section>
    </Drawer>
  );
}
