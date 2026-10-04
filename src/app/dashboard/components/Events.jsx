"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid, Loading, Messages, SetupHeader, Toolbar, sendJSON } from "./SetupGrid";
import { Drawer, Field, RowMenu, Section } from "./RatePlanSetup";
import PropertyProfile, { ProfileFields } from "./PropertyProfile";
import { countryName } from "@/lib/countries";
import { formatDateISO } from "@/lib/date";
import {
  EVENT_CATEGORIES,
  IMPACTS,
  categoryLabel,
  describeScope,
  impactOf,
  profileGaps,
} from "@/lib/eventTags";

/**
 * Events: festivals, holidays, conferences and seasons that move demand.
 *
 * A hotel sees two kinds. Public events come from a shared calendar and reach
 * every hotel whose profile they match -- country, state, city, kind of
 * property. Private events are the hotel's own and reach nobody else. Both
 * feed the events signal in Dynamic Pricing.
 *
 * A super admin also manages the public calendar, from any hotel's page.
 * Laid out like Workflow: a list to read, a drawer to change.
 */

const WINDOWS = [
  { months: 3, label: "Next 3 months" },
  { months: 6, label: "Next 6 months" },
  { months: 12, label: "Next 12 months" },
];

const today = () => formatDateISO(new Date());
function monthsAhead(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return formatDateISO(d);
}

/** "12 Oct" or "12–14 Oct" or "30 Oct – 2 Nov". */
function formatRange(start, end) {
  const fmt = (iso, opts) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts);
  if (start === end) return fmt(start, { day: "numeric", month: "short", year: "numeric" });
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { day: "numeric" })}–${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

const IMPACT_CHIP = { low: "chip chip-off", medium: "chip chip-ok", high: "chip chip-warn" };

export default function Events({ session }) {
  const propertyId = session?.propertyId || "";
  const [months, setMonths] = useState(6);
  const [view, setView] = useState("hotel");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams({ start: today(), end: monthsAhead(months) });
    if (propertyId) params.set("propertyId", propertyId);
    if (view === "public") params.set("view", "public");
    try {
      const res = await fetch(`/api/events?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load events");
      setData(json);
    } catch (err) {
      setError(err.message);
      setData((d) => d || { events: [], profile: null, canEdit: false, canPublish: false });
    }
  }, [propertyId, months, view]);

  useEffect(() => {
    load();
  }, [load]);

  const events = data?.events || [];
  const gaps = useMemo(() => profileGaps(data?.profile), [data]);

  // An event the viewer may change: their own hotel's, or any for a super admin.
  const editable = (e) => data?.canPublish || (data?.canEdit && e.property_id);

  async function remove(event) {
    const shared = !event.property_id;
    if (
      !window.confirm(
        `Delete "${event.name}"?${shared ? "\n\nIt is shared, so it disappears for every hotel it reaches." : ""}`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ id: event.id });
      if (propertyId) params.set("propertyId", propertyId);
      await sendJSON(`/api/events?${params}`, "DELETE");
      setNotice(`Deleted "${event.name}".`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loading label="Loading events…" />;

  return (
    <div className="space-y-4">
      <SetupHeader
        area="Insights"
        title="Events"
        count={events.length}
        sub="Festivals, holidays, conferences and seasons that bring guests to town. Shared events reach every hotel they match by place and kind; your own events reach only you. Both feed Dynamic Pricing."
      >
        {data.canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setDrawer({ event: null })}>
            + Add event
          </button>
        )}
      </SetupHeader>

      <Messages error={error} notice={notice} />

      {gaps.length > 0 && view === "hotel" &&
        (data.canEdit ? (
          <PropertyProfile
            propertyId={propertyId}
            intro={`Shared events reach hotels by place and kind, and this hotel's ${gaps.join(", ")} ${gaps.length === 1 ? "is" : "are"} not set yet — so only its own events show. Fill these in once; they also live under Setup → Property Setup.`}
            onSaved={load}
          />
        ) : (
          <div className="card card-pad sub">
            Shared events reach hotels by place and kind, and this hotel&apos;s {gaps.join(", ")} {gaps.length === 1 ? "is" : "are"} not
            set yet. Ask an administrator to fill in Setup → Property Setup.
          </div>
        ))}

      <Toolbar>
        <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Window">
          {WINDOWS.map((w) => (
            <option key={w.months} value={w.months}>
              {w.label}
            </option>
          ))}
        </select>
        {data.canPublish && (
          <select className="input" value={view} onChange={(e) => setView(e.target.value)} aria-label="Which events">
            <option value="hotel">What this hotel sees</option>
            <option value="public">Every shared event</option>
          </select>
        )}
        {view === "hotel" && data.profile && !gaps.length && (
          <span className="text-xs muted">
            Matched on {data.profile.city}
            {data.profile.state ? `, ${data.profile.state}` : ""}, {countryName(data.profile.country_code)}
          </span>
        )}
      </Toolbar>

      {events.length === 0 ? (
        <div className="card card-pad text-center" style={{ padding: "48px 24px" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            No events in this window
          </p>
          <p className="sub mx-auto mt-1 max-w-[460px]">
            Add what brings guests to town — a festival, a trade fair, a long weekend, the wedding season — and say
            how big it is. Dynamic Pricing lifts its suggestions on those nights.
          </p>
          {data.canEdit && (
            <button type="button" className="btn btn-primary mt-4" onClick={() => setDrawer({ event: null })}>
              + Add event
            </button>
          )}
        </div>
      ) : (
        <Grid>
          <thead>
            <tr>
              <th className="cm-sticky" style={{ minWidth: 150 }}>
                Dates
              </th>
              <th style={{ minWidth: 220 }}>Event</th>
              <th style={{ minWidth: 220 }}>Reaches</th>
              <th style={{ minWidth: 90 }}>Impact</th>
              <th style={{ width: 48 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="cm-sticky whitespace-nowrap">{formatRange(e.start_date, e.end_date)}</td>
                <td>
                  {editable(e) ? (
                    <button type="button" className="text-left font-semibold" onClick={() => setDrawer({ event: e })}>
                      {e.name}
                    </button>
                  ) : (
                    <span className="font-semibold">{e.name}</span>
                  )}
                  <div className="text-xs muted">{categoryLabel(e.category)}</div>
                  {e.notes && <div className="text-xs faint">{e.notes}</div>}
                </td>
                <td>
                  {e.property_id ? (
                    <span className="chip chip-off">This hotel only</span>
                  ) : (
                    <span className="text-sm">{describeScope(e, countryName)}</span>
                  )}
                </td>
                <td>
                  <span className={IMPACT_CHIP[e.impact] || "chip chip-off"}>{impactOf(e.impact).label}</span>
                </td>
                <td>
                  {editable(e) && (
                    <RowMenu
                      title={e.name}
                      items={[
                        { label: "Edit", onClick: () => setDrawer({ event: e }) },
                        { label: "Delete", danger: true, disabled: busy, onClick: () => remove(e) },
                      ]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}

      <p className="text-xs faint">
        Impact sets how far Dynamic Pricing leans on the night: low +{impactOf("low").liftPct}%, medium +
        {impactOf("medium").liftPct}%, high +{impactOf("high").liftPct}%, before its other signals and your floor and
        ceiling. When events overlap, the biggest one counts.
      </p>

      {drawer && (
        <EventDrawer
          event={drawer.event}
          profile={data.profile}
          canPublish={data.canPublish}
          defaultScope={view === "public" ? "public" : "private"}
          onClose={() => setDrawer(null)}
          onSave={async (event) => {
            await sendJSON("/api/events", event.id ? "PUT" : "POST", {
              propertyId: propertyId || undefined,
              event,
            });
            setDrawer(null);
            setError("");
            setNotice(`Saved "${event.name}".`);
            await load();
          }}
        />
      )}
    </div>
  );
}

function EventDrawer({ event, profile, canPublish, defaultScope, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: event?.name || "",
    category: event?.category || "festival",
    start_date: event?.start_date || "",
    end_date: event?.end_date || "",
    impact: event?.impact || "medium",
    notes: event?.notes || "",
  }));
  const [scope, setScope] = useState(event ? (event.property_id ? "private" : "public") : canPublish ? defaultScope : "private");
  // Tags for a shared event start from this hotel's own, the commonest case
  // being "this applies to hotels like mine".
  const [tags, setTags] = useState(() =>
    event && !event.property_id
      ? {
          country_code: event.country_code || "",
          state: event.state || "",
          city: event.city || "",
          property_types: event.property_types || [],
        }
      : {
          country_code: profile?.country_code || "IN",
          state: profile?.state || "",
          city: profile?.city || "",
          property_types: [],
        }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function problem() {
    if (!form.name.trim()) return "Give the event a name.";
    if (!form.start_date) return "Give the date the event starts.";
    if (form.end_date && form.end_date < form.start_date) return "The event cannot end before it starts.";
    if (scope === "public" && !tags.country_code) return "Choose the country the event is in.";
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
        id: event?.id,
        ...form,
        name: form.name.trim(),
        end_date: form.end_date || form.start_date,
        scope,
        ...(scope === "public" ? tags : {}),
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={event ? "Edit event" : "Add event"}
      subtitle={event?.name}
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
          placeholder="Pushkar Camel Fair"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <select className="input w-full" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Impact on demand">
          <div className="flex gap-2">
            {IMPACTS.map((i) => (
              <button
                key={i.id}
                type="button"
                aria-pressed={form.impact === i.id}
                onClick={() => set({ impact: i.id })}
                className={form.impact === i.id ? "btn btn-primary flex-1 text-sm" : "btn btn-secondary flex-1 text-sm"}
              >
                {i.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">
          <input
            type="date"
            className="input w-full"
            value={form.start_date}
            onChange={(e) => set({ start_date: e.target.value })}
          />
        </Field>
        <Field label="Ends" hint="Leave empty for a one-day event.">
          <input
            type="date"
            className="input w-full"
            value={form.end_date}
            min={form.start_date || undefined}
            onChange={(e) => set({ end_date: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          className="input w-full"
          rows={2}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Optional — venue, expected crowd, source"
        />
      </Field>

      {canPublish && (
        <Section title="Who sees it">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === "private"} onChange={() => setScope("private")} />
            This hotel only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === "public"} onChange={() => setScope("public")} />
            Shared — every hotel that matches the tags below
          </label>

          {scope === "public" && (
            <div className="space-y-2">
              <p className="text-xs faint">
                Leave state or city empty to reach the whole country or state, and pick no kind of property to reach
                every kind.
              </p>
              <ProfileFields
                value={tags}
                onChange={setTags}
                idPrefix="event-tags"
                typesHint="Only hotels of these kinds see it. Pick none to reach every kind."
              />
            </div>
          )}
        </Section>
      )}
    </Drawer>
  );
}
