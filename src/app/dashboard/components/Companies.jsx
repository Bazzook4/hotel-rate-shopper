"use client";

import { SetUpLink } from "@/app/components/PageNav";
import Icon from "../../components/Icon";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Grid,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";
import { confirmDiscardChanges, useDialog } from "../../components/Dialog";
import { WEEKDAYS, MONTHS } from "@/lib/contractRates";
import Select from "@/app/components/Select";
import { hotelToday } from "@/lib/hotelTime";

/**
 * Companies & agents: who books for a guest, may be billed, and may have a
 * contracted rate.
 *
 * Two grids, one above the other, as on Rooms: the companies and agents,
 * then the contract rates of the one chosen. Each grid holds its edits until
 * its own Save, like every setup grid.
 *
 * A contract line is a fixed price for a room type -- and a meal plan, or
 * any plan -- over a date range, optionally only on some weekdays or in some
 * months. Where lines overlap, the one covering the fewest nights wins, so a
 * year-round rate with a weekend line and a December line on top prices the
 * way it reads (src/lib/contractRates.js).
 */

const KINDS = [
  { id: "company", label: "Company" },
  { id: "travel_agent", label: "Travel agent" },
];

const today = () => hotelToday();
const yearEnd = () => `${hotelToday().slice(0, 4)}-12-31`;

/**
 * Days or months as toggles. Nothing chosen means every one, so a line that
 * applies every day shows them all lit rather than all off.
 */
function DayToggles({ labels, offset = 0, value, onChange, edited }) {
  const all = labels.map((_, i) => i + offset);
  const on = Array.isArray(value) && value.length ? value.map(Number) : all;
  function toggle(n) {
    const next = on.includes(n) ? on.filter((x) => x !== n) : [...on, n].sort((a, b) => a - b);
    // Turning the last one off would mean "never", which no contract means.
    if (next.length === 0) return;
    onChange(next.length === all.length ? null : next);
  }
  return (
    <div
      className="flex"
      style={{
        gap: 2,
        outline: edited ? "2px solid var(--accent)" : undefined,
        outlineOffset: 1,
        borderRadius: 4,
      }}
    >
      {labels.map((label, i) => {
        const n = i + offset;
        const lit = on.includes(n);
        return (
          <button
            key={label}
            type="button"
            onClick={() => toggle(n)}
            aria-pressed={lit}
            title={label}
            style={{
              minWidth: 22,
              padding: "2px 3px",
              fontSize: "0.65rem",
              lineHeight: 1.2,
              borderRadius: 3,
              border: "1px solid var(--border)",
              background: lit ? "var(--accent)" : "var(--surface)",
              color: lit ? "#fff" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {label.slice(0, offset === 1 ? 3 : 2)}
          </button>
        );
      })}
    </div>
  );
}

/** A stored contract line flattened into one field per adult count. */
function toRow(line, maxAdults) {
  const row = { ...line };
  for (let n = 1; n <= maxAdults; n += 1) {
    const v = line.adult_rates?.[n] ?? line.adult_rates?.[String(n)];
    row[`a${n}`] = v == null ? "" : String(v);
  }
  row.extra_adult_rate = line.extra_adult_rate ?? "";
  row.extra_child_rate = line.extra_child_rate ?? "";
  row.rate_plan_id = line.rate_plan_id || "";
  return row;
}

/** Grid fields back into what the rates route takes. */
function toLine(row, maxAdults, fields = null) {
  const out = {};
  const want = (f) => !fields || f in fields;
  for (const f of ["room_type_id", "rate_plan_id", "valid_from", "valid_to", "weekdays", "months", "extra_adult_rate", "extra_child_rate", "notes"]) {
    if (want(f)) out[f] = row[f];
  }
  const adultFields = Array.from({ length: maxAdults }, (_, i) => `a${i + 1}`);
  if (!fields || adultFields.some((f) => f in fields)) {
    out.adult_rates = Object.fromEntries(adultFields.map((f, i) => [i + 1, row[f]]));
  }
  return out;
}

function ContractRates({ propertyId, company, roomTypes, ratePlans, onCountChange }) {
  const dialog = useDialog();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // As many adult columns as the largest room's base adults: above that,
  // every adult is the extra-adult rate.
  const maxAdults = useMemo(
    () => Math.max(2, ...roomTypes.map((rt) => Number(rt.base_adults) || 0)),
    [roomTypes]
  );
  const baseFor = (roomTypeId) =>
    Math.max(1, Number(roomTypes.find((rt) => rt.id === roomTypeId)?.base_adults) || 2);

  const rows = useMemo(() => lines.map((l) => toRow(l, maxAdults)), [lines, maxAdults]);
  const grid = useGrid(rows);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ companyId: company.id });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/companies/rates?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load contract rates");
      setLines(data.rates || []);
      onCountChange?.(company.id, (data.rates || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, company.id, onCountChange]);

  // Choosing another company remounts this grid (it is keyed by company), so
  // edits held for one are never saved against the next.
  useEffect(() => {
    load();
  }, [load]);

  const planOptions = [{ id: "", label: "Any plan" }, ...ratePlans.map((p) => ({ id: p.id, label: p.plan_name }))];
  const typeOptions = [{ id: "", label: "Choose..." }, ...roomTypes.map((rt) => ({ id: rt.id, label: rt.room_type_name }))];

  function blank(from = null) {
    const base = {
      room_type_id: roomTypes[0]?.id || "",
      rate_plan_id: "",
      valid_from: today(),
      valid_to: yearEnd(),
      weekdays: null,
      months: null,
      extra_adult_rate: "",
      extra_child_rate: "",
      notes: "",
    };
    for (let n = 1; n <= maxAdults; n += 1) base[`a${n}`] = "";
    if (!from) return base;
    const { id, created_at, updated_at, company_id, ...copy } = grid.merged(from);
    return copy;
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    const errors = await grid.save({
      label: (r) => roomTypes.find((rt) => rt.id === r.room_type_id)?.room_type_name || "Rate line",
      update: (row, changes, merged) =>
        sendJSON("/api/pms/companies/rates", "PATCH", {
          property_id: propertyId,
          company_id: company.id,
          id: row.id,
          ...toLine(merged, maxAdults, changes),
        }),
      create: (d) =>
        sendJSON("/api/pms/companies/rates", "POST", {
          property_id: propertyId,
          company_id: company.id,
          ...toLine(d, maxAdults),
        }),
    });
    await load();
    setBusy(false);
    if (errors.length) setError(errors.join(". "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  async function remove(row) {
    if (isDraft(row.id)) {
      grid.removeDraft(row.id);
      return;
    }
    const ok = await dialog.confirm({
      title: "Delete this rate line?",
      message: "Bookings already made keep their price. New quotes stop using it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const qs = new URLSearchParams({ id: row.id, companyId: company.id });
      if (propertyId) qs.set("propertyId", propertyId);
      await sendJSON(`/api/pms/companies/rates?${qs}`, "DELETE");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const all = [...rows, ...grid.drafts];
  const cols = 9 + maxAdults;

  return (
    <div className="space-y-4">
      <SetupHeader
        section
        title={`Contract rates: ${company.name}`}
        count={lines.length}
        sub="Fixed prices per night. Where lines overlap, the one covering the fewest nights wins. Nights no line covers are quoted at your public rate."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => grid.add(blank())}
          disabled={roomTypes.length === 0}
        >
          + Add rate line
        </button>
        {roomTypes.length === 0 && <span className="sub">Add room types first.</span>}
        {roomTypes.length === 0 && (
          <SetUpLink
            page="rooms"
            className="btn btn-secondary text-sm"
            confirm={() => grid.count === 0 || confirmDiscardChanges(dialog, "contract rates")}
            fallback={<span className="sub">Ask your admin to add them.</span>}
          >
            Set up rooms
          </SetUpLink>
        )}
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 150 }}>Room type</th>
            <th style={{ minWidth: 120 }}>Meal plan</th>
            <th style={{ width: 140 }}>From</th>
            <th style={{ width: 140 }}>To</th>
            <th>Weekdays</th>
            <th>Months</th>
            {Array.from({ length: maxAdults }, (_, i) => (
              <th key={i} style={{ width: 90 }} title={`Price per night for ${i + 1} adult${i ? "s" : ""}`}>
                {i + 1} adult{i ? "s" : ""}
              </th>
            ))}
            <th style={{ width: 90 }} title="Each adult above the room's base adults">Extra adult</th>
            <th style={{ width: 90 }}>Per child</th>
            <th style={{ minWidth: 140 }}>Notes</th>
            <th style={{ width: 70 }} />
          </tr>
        </thead>
        <tbody>
          {loading && lines.length === 0 && (
            <tr>
              <td colSpan={cols} className="cm-empty">Loading...</td>
            </tr>
          )}
          {!loading && all.length === 0 && (
            <tr>
              <td colSpan={cols} className="cm-empty">
                No contract rates yet. Bookings for {company.name} are quoted at your public rate.
              </td>
            </tr>
          )}
          {all.map((row) => {
            const draft = isDraft(row.id);
            const base = baseFor(grid.value(row, "room_type_id"));
            return (
              <tr key={row.id} className={draft ? "cm-new" : undefined}>
                <td className="cm-sticky">{grid.select(row, "room_type_id", typeOptions)}</td>
                <td>{grid.select(row, "rate_plan_id", planOptions)}</td>
                <td>{grid.input(row, "valid_from", { type: "date" })}</td>
                <td>{grid.input(row, "valid_to", { type: "date", min: grid.value(row, "valid_from") })}</td>
                <td>
                  <DayToggles
                    labels={WEEKDAYS}
                    value={grid.value(row, "weekdays")}
                    onChange={(v) => grid.change(row, "weekdays", v)}
                    edited={grid.edited(row, "weekdays")}
                  />
                </td>
                <td>
                  <DayToggles
                    labels={MONTHS}
                    offset={1}
                    value={grid.value(row, "months")}
                    onChange={(v) => grid.change(row, "months", v)}
                    edited={grid.edited(row, "months")}
                  />
                </td>
                {Array.from({ length: maxAdults }, (_, i) => (
                  <td key={i} className="cm-num">
                    {i + 1 <= base
                      ? grid.input(row, `a${i + 1}`, { type: "number", min: 0, inputMode: "decimal" })
                      : <span className="sub" title="Above this room's base adults: the extra-adult rate applies">extra</span>}
                  </td>
                ))}
                <td className="cm-num">{grid.input(row, "extra_adult_rate", { type: "number", min: 0 })}</td>
                <td className="cm-num">{grid.input(row, "extra_child_rate", { type: "number", min: 0 })}</td>
                <td>{grid.input(row, "notes")}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => grid.add(blank(row))}
                    title="Copy this line to add a weekend or season on top"
                    aria-label="Copy line"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => remove(row)}
                    title="Delete line"
                    aria-label="Delete line"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Grid>
    </div>
  );
}

export default function Companies({ session }) {
  const dialog = useDialog();
  const propertyId = session?.propertyId || null;

  const [companies, setCompanies] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [notReady, setNotReady] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const grid = useGrid(companies);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const [cRes, rtRes, rpRes] = await Promise.all([
        fetch(`/api/pms/companies${qs}`),
        fetch(`/api/setup/roomTypes${qs}`),
        fetch(`/api/setup/ratePlans${qs}`),
      ]);
      const [c, rt, rp] = await Promise.all([cRes.json(), rtRes.json(), rpRes.json()]);
      if (!cRes.ok) throw new Error(c.error || "Could not load companies");
      setCompanies(c.companies || []);
      setNotReady(Boolean(c.notReady));
      setRoomTypes(rt.roomTypes || []);
      setRatePlans(rp.ratePlans || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const setRateCount = useCallback((id, n) => {
    setCompanies((prev) => prev.map((c) => (c.id === id && c.rate_lines !== n ? { ...c, rate_lines: n } : c)));
  }, []);

  const term = search.trim().toLowerCase();
  const visible = companies.filter((c) => {
    const m = grid.merged(c);
    if (kindFilter && m.kind !== kindFilter) return false;
    if (!term) return true;
    return [m.name, m.gstin, m.contact_person, m.phone, m.email]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term));
  });
  const rows = [...visible, ...grid.drafts];
  const selected = companies.find((c) => c.id === selectedId) || null;

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    const errors = await grid.save({
      label: (c) => c.name || "New company",
      update: (c, changes) => sendJSON("/api/pms/companies", "PATCH", { property_id: propertyId, id: c.id, ...changes }),
      create: (d) => {
        if (!String(d.name).trim()) throw new Error("Give it a name");
        const { id, ...row } = d;
        return sendJSON("/api/pms/companies", "POST", { property_id: propertyId, ...row });
      },
    });
    await load();
    setBusy(false);
    if (errors.length) setError(errors.join(". "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  async function remove(c) {
    if (isDraft(c.id)) {
      grid.removeDraft(c.id);
      return;
    }
    const ok = await dialog.confirm({
      title: `Delete ${c.name}?`,
      message:
        "Its contract rates are deleted too. Bookings made for it keep their price and invoices, but are no longer linked to it. To stop using it for a while, untick Active instead.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const qs = propertyId ? `&propertyId=${propertyId}` : "";
      await sendJSON(`/api/pms/companies?id=${c.id}${qs}`, "DELETE");
      if (selectedId === c.id) setSelectedId(null);
      setCompanies((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const COLS = 15;

  return (
    <div className="space-y-4">
      <SetupHeader
        area="Front desk"
        title="Companies & agents"
        count={companies.length}
        sub="Who books for a guest. Bookings for them can be billed to them with their GSTIN, and use their contract rates."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages
        error={error}
        notice={notReady ? "Companies and agents are not switched on for this property yet." : notice}
      />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          disabled={notReady}
          onClick={() =>
            grid.add({ kind: kindFilter || "company", name: "", gstin: "", contact_person: "", phone: "", email: "", billing_address: "", city: "", state: "", postal_code: "", commission_percent: "", credit_days: "", credit_limit: "", is_active: true })
          }
        >
          + Add company or agent
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select className="input" style={{ width: "auto" }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">Companies and agents</option>
            <option value="company">Companies</option>
            <option value="travel_agent">Travel agents</option>
          </Select>
          <input
            className="input w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, GSTIN, contact..."
          />
        </div>
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 180 }}>Name</th>
            <th style={{ width: 130 }}>Type</th>
            <th style={{ minWidth: 160 }}>GSTIN</th>
            <th style={{ minWidth: 140 }}>Contact person</th>
            <th style={{ minWidth: 130 }}>Phone</th>
            <th style={{ minWidth: 170 }}>Email</th>
            <th style={{ minWidth: 200 }}>Billing address</th>
            <th style={{ minWidth: 110 }}>City</th>
            <th style={{ minWidth: 110 }}>State</th>
            <th style={{ width: 90 }}>PIN</th>
            <th style={{ width: 90 }} title="Travel agents only">Commission %</th>
            <th style={{ width: 80 }} title="Days after the bill that payment is due. Blank = due on the bill date">Credit days</th>
            <th style={{ width: 110 }} title="How much it may owe before payment is asked for first">Credit limit</th>
            <th style={{ width: 60 }} title="Inactive ones stay on record but are not offered on new bookings">Active</th>
            <th style={{ width: 130 }}>Contract rates</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {loading && companies.length === 0 && (
            <tr>
              <td colSpan={COLS + 1} className="cm-empty">Loading...</td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={COLS + 1} className="cm-empty">
                {companies.length ? "None match the filters." : "No companies or agents yet."}
              </td>
            </tr>
          )}
          {rows.map((c) => {
            const draft = isDraft(c.id);
            const agent = grid.value(c, "kind") === "travel_agent";
            const active = grid.value(c, "is_active") !== false;
            const isSelected = selectedId === c.id;
            return (
              <tr
                key={c.id}
                className={draft ? "cm-new" : active ? undefined : "cm-muted"}
                style={isSelected ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined}
              >
                <td className="cm-sticky">
                  {grid.input(c, "name", { placeholder: "Name", invalid: draft && !String(c.name).trim() })}
                </td>
                <td>{grid.select(c, "kind", KINDS)}</td>
                <td>{grid.input(c, "gstin", { placeholder: "15 characters", maxLength: 20, style: { textTransform: "uppercase" } })}</td>
                <td>{grid.input(c, "contact_person")}</td>
                <td>{grid.input(c, "phone", { type: "tel" })}</td>
                <td>{grid.input(c, "email", { type: "email" })}</td>
                <td>{grid.input(c, "billing_address")}</td>
                <td>{grid.input(c, "city")}</td>
                <td>{grid.input(c, "state")}</td>
                <td>{grid.input(c, "postal_code")}</td>
                <td className="cm-num">
                  {agent ? grid.input(c, "commission_percent", { type: "number", min: 0, max: 100, step: "0.5" }) : <span className="sub">-</span>}
                </td>
                <td className="cm-num">{grid.input(c, "credit_days", { type: "number", min: 0, step: 1 })}</td>
                <td className="cm-num">{grid.input(c, "credit_limit", { type: "number", min: 0 })}</td>
                <td style={{ textAlign: "center" }}>{grid.check(c, "is_active")}</td>
                <td>
                  {draft ? (
                    <span className="sub">Save first</span>
                  ) : (
                    <button
                      type="button"
                      className={isSelected ? "btn btn-primary text-xs" : "btn btn-secondary text-xs"}
                      onClick={() => setSelectedId(isSelected ? null : c.id)}
                    >
                      {c.rate_lines ? `${c.rate_lines} line${c.rate_lines === 1 ? "" : "s"}` : "Add rates"} {isSelected ? "▾" : "▸"}
                    </button>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => remove(c)}
                    title="Delete"
                    aria-label={`Delete ${c.name || "company"}`}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Grid>

      {selected && (
        <ContractRates
          key={selected.id}
          propertyId={propertyId}
          company={selected}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onCountChange={setRateCount}
        />
      )}
    </div>
  );
}
