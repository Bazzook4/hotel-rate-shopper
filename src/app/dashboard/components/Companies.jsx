"use client";

import { SetUpLink, usePageNav } from "@/app/components/PageNav";
import Icon from "../../components/Icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useToast } from "../../components/Toast";
import { WEEKDAYS, MONTHS } from "@/lib/contractRates";
import Select from "@/app/components/Select";
import { hotelToday } from "@/lib/hotelTime";
import { formatAmount } from "@/lib/money";
import { stateFromGstin } from "@/lib/places";
import { Drawer, Field, Section } from "./RatePlanSetup";
import { Statement } from "./CityLedger";
import { Stats, TableFrame, moneyFormatter } from "./reportKit";
import { SortTh, useSort } from "./useSort";

/**
 * Companies & agents: who books for a guest, may be billed, and may have a
 * contracted rate.
 *
 * A list to read -- each one's business over the last 12 months and, for
 * those who may see the City Ledger, what was billed, collected and is still
 * to collect -- and the right-hand panel to change one: a four-step wizard
 * to add, and Details, Contract rates and Ledger tabs to open. The contract
 * rates stay a grid with its own Save, like every setup grid.
 *
 * A contract line is a fixed price for a room type -- and a meal plan, or
 * any plan -- over a date range, optionally only on some weekdays or in some
 * months. Where lines overlap, the one covering the fewest nights wins, so a
 * year-round rate with a weekend line and a December line on top prices the
 * way it reads (src/lib/contractRates.js).
 */

const PENNY = 0.009;

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
              fontSize: "0.6875rem",
              lineHeight: 1.2,
              borderRadius: 3,
              border: "1px solid var(--border)",
              background: lit ? "var(--accent-strong)" : "var(--surface)",
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

function ContractRates({ propertyId, company, roomTypes, ratePlans, onCountChange, onDirtyChange }) {
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

  // The panel holding this grid asks before closing over unsaved lines.
  useEffect(() => {
    onDirtyChange?.(grid.count > 0);
  }, [grid.count, onDirtyChange]);

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
        title="Contract rates"
        count={lines.length}
        sub="Fixed prices per night. If two lines cover a night, the shorter one is used. Other nights use your normal rate."
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
          <Icon name="plus" size={14} /> Add rate line
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
                    Copy
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


/* ------------------------------------------------------------------ */
/* A company's details: the wizard's steps and the panel's Details tab  */
/* ------------------------------------------------------------------ */

const BLANK = {
  kind: "company",
  name: "",
  gstin: "",
  contact_person: "",
  phone: "",
  email: "",
  billing_address: "",
  city: "",
  state: "",
  postal_code: "",
  commission_percent: "",
  credit_days: "",
  credit_limit: "",
  is_active: true,
};

const FIELDS = Object.keys(BLANK);

const STEPS = [
  { id: "who", label: "Who" },
  { id: "contact", label: "Contact" },
  { id: "terms", label: "Terms" },
  { id: "rates", label: "Rates" },
];

function formOf(c) {
  return Object.fromEntries(FIELDS.map((f) => [f, c?.[f] ?? BLANK[f]]));
}

/** What is wrong with the fields of one step (or all of them), if anything. */
function problemIn(form, step = null) {
  const all = step == null;
  if (all || step === "who") {
    if (!form.name.trim()) return "Give it a name.";
    const gstin = form.gstin.toUpperCase().replace(/\s+/g, "");
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
      return "A GSTIN is 15 characters and starts with the two-digit state code.";
    }
  }
  if ((all || step === "contact") && form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    return "That email address does not look right.";
  }
  if (all || step === "terms") {
    if (form.kind === "travel_agent" && form.commission_percent !== "") {
      const c = Number(form.commission_percent);
      if (!Number.isFinite(c) || c < 0 || c > 100) return "Commission must be between 0 and 100%.";
    }
    for (const [f, label] of [["credit_days", "Credit days"], ["credit_limit", "Credit limit"]]) {
      if (form[f] === "" || form[f] == null) continue;
      const n = Number(form[f]);
      if (!Number.isFinite(n) || n < 0) return `${label} must be zero or more.`;
    }
  }
  return null;
}

/** The form as the companies route takes it. */
function bodyOf(form) {
  return {
    ...form,
    name: form.name.trim(),
    gstin: form.gstin.toUpperCase().replace(/\s+/g, ""),
    commission_percent: form.kind === "travel_agent" ? form.commission_percent : "",
  };
}

function KindChoice({ value, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Type">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          role="radio"
          aria-checked={value === k.id}
          className={value === k.id ? "seg-on" : ""}
          onClick={() => onChange(k.id)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

/** A titled section on the Details tab; in the wizard the step bar names it. */
function Part({ bare, title, children }) {
  return bare ? <div className="space-y-3">{children}</div> : <Section title={title}>{children}</Section>;
}

/** The fields of one step, or every step one after another. */
function DetailFields({ form, set, step = null, autoFocus = false }) {
  const show = (id) => step == null || step === id;
  const agent = form.kind === "travel_agent";
  const text = (f, props = {}) => (
    <input className="input" value={form[f] ?? ""} onChange={(e) => set({ [f]: e.target.value })} {...props} />
  );

  function setGstin(value) {
    const patch = { gstin: value };
    // The GSTIN names the state; fill it in unless the desk already has.
    const state = stateFromGstin(value);
    if (state && !form.state.trim()) patch.state = state;
    set(patch);
  }

  return (
    <>
      {show("who") && (
        <Part bare={step != null} title="Who">
          <Field label="Type">
            <KindChoice value={form.kind} onChange={(kind) => set({ kind })} />
          </Field>
          <Field label="Name (needed)">{text("name", { autoFocus, placeholder: agent ? "Agency name" : "Company name" })}</Field>
          <Field label="GSTIN" hint="Optional. Fills in the state.">
            <input
              className="input"
              value={form.gstin}
              onChange={(e) => setGstin(e.target.value)}
              maxLength={20}
              placeholder="15 characters"
              style={{ textTransform: "uppercase" }}
            />
          </Field>
        </Part>
      )}

      {show("contact") && (
        <Part bare={step != null} title="Contact and billing">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person">{text("contact_person", { autoFocus: autoFocus && step === "contact" })}</Field>
            <Field label="Phone">{text("phone", { type: "tel", inputMode: "tel" })}</Field>
          </div>
          <Field label="Email">{text("email", { type: "email", inputMode: "email" })}</Field>
          <Field label="Billing address">{text("billing_address")}</Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City">{text("city")}</Field>
            <Field label="State">{text("state")}</Field>
            <Field label="PIN">{text("postal_code", { inputMode: "numeric" })}</Field>
          </div>
        </Part>
      )}

      {show("terms") && (
        <Part bare={step != null} title="Payment terms">
          <div className="flex flex-wrap gap-3">
            {agent && (
              <Field label="Commission %">
                {text("commission_percent", { style: { width: "7rem" }, type: "number", min: 0, max: 100, step: "0.5", inputMode: "decimal", autoFocus: autoFocus && step === "terms" })}
              </Field>
            )}
            <Field label="Credit days" hint="Leave blank if due on the bill date">
              {text("credit_days", { style: { width: "7rem" }, type: "number", min: 0, step: 1, inputMode: "numeric", autoFocus: autoFocus && step === "terms" && !agent })}
            </Field>
            <Field label="Credit limit" hint="Shows Over limit when passed">
              {text("credit_limit", { style: { width: "9rem" }, type: "number", min: 0, inputMode: "decimal" })}
            </Field>
          </div>
        </Part>
      )}
    </>
  );
}

/** Step 1 of 4 ... as numbered buttons, so a finished step can be gone back to. */
function StepBar({ steps, at, reached, onGo }) {
  return (
    <div className="seg" role="tablist" aria-label="Steps">
      {steps.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={i === at}
          className={i === at ? "seg-on" : ""}
          disabled={i > reached}
          onClick={() => onGo(i)}
        >
          {i + 1}. {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Add a company or agent in four short steps. Only the name is needed, so
 * "Save now" is there from the first step; the rest can be filled later
 * from the company's panel. Contract rates need the company saved, so they
 * come last, after it is.
 */
function AddCompany({ propertyId, kind, roomTypes, ratePlans, onClose, onSaved, onOpen }) {
  const dialog = useDialog();
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...BLANK, kind: kind || "company" }));
  const [at, setAt] = useState(0);
  const [reached, setReached] = useState(0);
  const [company, setCompany] = useState(null);
  const [ratesDirty, setRatesDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const step = STEPS[at].id;
  const touched = FIELDS.some((f) => f !== "kind" && form[f] !== BLANK[f]);

  function go(i) {
    setError("");
    setAt(i);
  }

  async function close() {
    if (company) {
      if (ratesDirty && !(await confirmDiscardChanges(dialog, "the contract rates"))) return;
      onClose();
      return;
    }
    if (touched && !(await confirmDiscardChanges(dialog, "this company"))) return;
    onClose();
  }

  async function save({ andRates = true } = {}) {
    const p = problemIn(form);
    if (p) {
      // Back to the step the problem is on.
      const on = STEPS.findIndex((s) => problemIn(form, s.id));
      if (on >= 0) setAt(on);
      setError(p);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { company: saved } = await sendJSON("/api/pms/companies", "POST", { property_id: propertyId, ...bodyOf(form) });
      onSaved(saved);
      if (!andRates) {
        // Most companies have no contract rate: done, with the way to add one.
        toast(`Saved ${saved.name}.`, { action: { label: "Add contract rates", run: () => onOpen(saved.id, "rates") } });
        onClose();
        return;
      }
      setCompany(saved);
      setAt(3);
      setReached(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    const p = problemIn(form, step);
    if (p) {
      setError(p);
      return;
    }
    if (at === 2) {
      save();
      return;
    }
    setReached((r) => Math.max(r, at + 1));
    go(at + 1);
  }

  const noun = form.kind === "travel_agent" ? "travel agent" : "company";

  if (company) {
    return (
      <Drawer
        title={company.name}
        subtitle="Saved. Add contract rates if you agreed any, or Done."
        onCancel={close}
        cancelLabel={ratesDirty ? "Close" : "Done"}
        width={940}
        tabs={<StepBar steps={STEPS} at={3} reached={3} onGo={() => {}} />}
      >
        <ContractRates
          propertyId={propertyId}
          company={company}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onDirtyChange={setRatesDirty}
        />
      </Drawer>
    );
  }

  return (
    <Drawer
      title={form.name.trim() || `Add ${noun}`}
      subtitle="Only the name is needed. The rest can be added later."
      onCancel={at === 0 ? close : () => go(at - 1)}
      onEscape={close}
      cancelLabel={at === 0 ? "Cancel" : "Back"}
      onSave={next}
      saveLabel={at === 2 ? `Save ${noun}` : "Next"}
      extraActions={
        at < 2 && form.name.trim() ? (
          <button type="button" className="btn btn-secondary" onClick={() => save({ andRates: false })} disabled={busy}>
            Save now
          </button>
        ) : null
      }
      busy={busy}
      error={error}
      tabs={<StepBar steps={STEPS} at={at} reached={Math.min(reached, 2)} onGo={go} />}
    >
      <DetailFields key={step} form={form} set={set} step={step} autoFocus />
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* One company's panel                                                  */
/* ------------------------------------------------------------------ */

/**
 * A company opened from the list: its details, its contract rates and its
 * ledger, as tabs. Details save with the panel's Save; contract rates keep
 * their grid's own Save; the ledger is the City Ledger's statement.
 */
function CompanyPanel({ session, propertyId, company, startTab, startReceiving = false, canSeeLedger, roomTypes, ratePlans, onClose, onChanged, onRateCount, onDeleted }) {
  const dialog = useDialog();
  const toast = useToast();
  const [tab, setTab] = useState(startTab || "details");
  const [form, setForm] = useState(() => formOf(company));
  const [ratesDirty, setRatesDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const original = useMemo(() => formOf(company), [company]);
  const dirty = FIELDS.some((f) => String(form[f] ?? "") !== String(original[f] ?? ""));
  const agent = company.kind === "travel_agent";

  async function leaveTab(next) {
    if (next === tab) return;
    if (tab === "details" && dirty && !(await confirmDiscardChanges(dialog, "the details"))) return;
    if (tab === "rates" && ratesDirty && !(await confirmDiscardChanges(dialog, "the contract rates"))) return;
    if (tab === "details") setForm(original);
    setRatesDirty(false);
    setError("");
    setTab(next);
  }

  async function close() {
    if (tab === "details" && dirty && !(await confirmDiscardChanges(dialog, "the details"))) return;
    if (tab === "rates" && ratesDirty && !(await confirmDiscardChanges(dialog, "the contract rates"))) return;
    onClose();
  }

  async function save() {
    const p = problemIn(form);
    if (p) {
      setError(p);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = bodyOf(form);
      const changes = Object.fromEntries(FIELDS.filter((f) => String(body[f] ?? "") !== String(original[f] ?? "")).map((f) => [f, body[f]]));
      const { company: saved } = await sendJSON("/api/pms/companies", "PATCH", { property_id: propertyId, id: company.id, ...changes });
      setForm(formOf(saved));
      onChanged(saved);
      toast(`Saved ${saved.name}.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: `Delete ${company.name}?`,
      message:
        "Its contract rates are deleted too. Bookings made for it keep their price and invoices, but are no longer linked to it. To stop using it for a while, untick Active instead.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const qs = propertyId ? `&propertyId=${propertyId}` : "";
      await sendJSON(`/api/pms/companies?id=${company.id}${qs}`, "DELETE");
      toast(`Deleted ${company.name}.`);
      onDeleted(company.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const tabs = [
    { id: "details", label: "Details" },
    { id: "rates", label: company.rate_lines ? `Contract rates (${company.rate_lines})` : "Contract rates" },
    ...(canSeeLedger ? [{ id: "ledger", label: "Ledger" }] : []),
  ];

  return (
    <Drawer
      title={company.name}
      subtitle={[agent ? "Travel agent" : "Company", company.gstin ? `GSTIN ${company.gstin}` : null, company.is_active === false ? "Inactive" : null]
        .filter(Boolean)
        .join(", ")}
      onCancel={close}
      onSave={tab === "details" ? save : undefined}
      saveDisabled={!dirty}
      busy={busy}
      error={error}
      width={940}
      tabs={
        <div className="seg" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "seg-on" : ""} onClick={() => leaveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === "details" && (
        <div className="space-y-6" style={{ maxWidth: 620 }}>
          <DetailFields form={form} set={set} />
          <Section title="Status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} />
                Active (offered on new bookings)
              </label>
              <button type="button" className="btn btn-secondary text-sm" style={{ color: "var(--danger)" }} onClick={remove}>
                Delete {agent ? "agent" : "company"}
              </button>
            </div>
          </Section>
        </div>
      )}

      {tab === "rates" && (
        <ContractRates
          propertyId={propertyId}
          company={company}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onCountChange={onRateCount}
          onDirtyChange={setRatesDirty}
        />
      )}

      {tab === "ledger" && (
        <Statement
          session={session}
          propertyId={propertyId}
          companyId={company.id}
          startReceiving={startReceiving}
          onChanged={() => onChanged(null)}
          title="Bills and payments"
        />
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* The page: every company and agent, with its business and ledger      */
/* ------------------------------------------------------------------ */

export default function Companies({ session }) {
  const propertyId = session?.propertyId || null;
  const { canOpen } = usePageNav();
  const canSeeLedger = canOpen("cityledger");

  const [companies, setCompanies] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notReady, setNotReady] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `propertyId=${propertyId}&` : "";
      const [cRes, rtRes, rpRes] = await Promise.all([
        fetch(`/api/pms/companies?${qs}summary=1`),
        fetch(`/api/setup/roomTypes${propertyId ? `?propertyId=${propertyId}` : ""}`),
        fetch(`/api/setup/ratePlans${propertyId ? `?propertyId=${propertyId}` : ""}`),
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

  const money = useMemo(() => moneyFormatter(null), []);
  const hasBusiness = companies.some((c) => c.business);
  const hasLedger = companies.some((c) => "ledger" in c);

  const term = search.trim().toLowerCase();
  const visible = companies.filter((c) => {
    if (kindFilter && c.kind !== kindFilter) return false;
    if (!term) return true;
    return [c.name, c.gstin, c.contact_person, c.phone, c.email, c.city]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term));
  });

  const sorter = useSort(
    visible,
    {
      name: (c) => c.name.toLowerCase(),
      bookings: (c) => c.business?.bookings || 0,
      nights: (c) => c.business?.nights || 0,
      value: (c) => c.business?.value || 0,
      billed: (c) => c.ledger?.billed || 0,
      collected: (c) => c.ledger?.collected || 0,
      outstanding: (c) => c.ledger?.outstanding || 0,
      overdue: (c) => c.ledger?.overdue || 0,
    },
    { key: "name", dir: "asc" }
  );

  // Once the money is in, who owes most comes first.
  const sortedOnce = useRef(false);
  useEffect(() => {
    if (sortedOnce.current || !companies.length) return;
    sortedOnce.current = true;
    if (companies.some((c) => "ledger" in c)) sorter.setSort({ key: "outstanding", dir: "desc" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const totals = useMemo(() => {
    const t = { bookings: 0, value: 0, billed: 0, collected: 0, outstanding: 0, overdue: 0 };
    for (const c of visible) {
      t.bookings += c.business?.bookings || 0;
      t.value += c.business?.value || 0;
      t.billed += c.ledger?.billed || 0;
      t.collected += c.ledger?.collected || 0;
      t.outstanding += c.ledger?.outstanding || 0;
      t.overdue += c.ledger?.overdue || 0;
    }
    return t;
  }, [visible]);

  const opened = open ? companies.find((c) => c.id === open.id) : null;

  /** A company saved in a panel: patch it in place, then refresh the figures. */
  function changed(saved) {
    if (saved) setCompanies((prev) => prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)));
    load();
  }

  // Stable, since the contract rates grid reloads whenever it changes.
  const setRateCount = useCallback((id, n) => {
    setCompanies((prev) => prev.map((c) => (c.id === id && c.rate_lines !== n ? { ...c, rate_lines: n } : c)));
  }, []);

  const cols = 1 + (hasBusiness ? 3 : 0) + (hasLedger ? 5 : 0);

  return (
    <div className="space-y-4">
      <SetupHeader
        area="Front desk"
        title="Companies & agents"
        count={companies.length}
        sub="Who books for guests: bill them with their GSTIN and use their contract rates."
      >
        <button type="button" className="btn btn-primary" disabled={notReady} onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add company or agent
        </button>
      </SetupHeader>

      <Messages error={error} notice={notReady ? "Companies and agents are not switched on for this property yet." : null} />

      {(hasBusiness || hasLedger) && visible.length > 0 && (
        <div className="card card-pad">
          <Stats
            items={[
              ...(hasBusiness
                ? [{ label: "Business, last 12 months", value: money(totals.value), sub: `${formatAmount(totals.bookings)} booking${totals.bookings === 1 ? "" : "s"}` }]
                : []),
              ...(hasLedger
                ? [
                    { label: "Billed to them", value: money(totals.billed), hint: "Bills of checked-out stays sent to the company to pay" },
                    { label: "Collected", value: money(totals.collected) },
                    {
                      label: "Still to collect",
                      value: money(totals.outstanding),
                      sub: totals.overdue > PENNY ? `${money(totals.overdue)} overdue` : "Nothing overdue",
                      tone: totals.overdue > PENNY ? "danger" : undefined,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}

      <Toolbar>
        <Select className="input" style={{ width: "auto" }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">Companies and agents</option>
          <option value="company">Companies</option>
          <option value="travel_agent">Travel agents</option>
        </Select>
        <input
          className="input w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, GSTIN, contact, city..."
        />
      </Toolbar>

      <TableFrame>
        <table className="grid-table">
          <thead>
            <tr>
              <SortTh sorter={sorter} col="name">Name</SortTh>
              {hasBusiness && (
                <>
                  <SortTh sorter={sorter} col="bookings" className="text-right">Bookings</SortTh>
                  <SortTh sorter={sorter} col="nights" className="text-right">Nights</SortTh>
                  <SortTh sorter={sorter} col="value" className="text-right">Business</SortTh>
                </>
              )}
              {hasLedger && (
                <>
                  <SortTh sorter={sorter} col="billed" className="text-right">Billed</SortTh>
                  <SortTh sorter={sorter} col="collected" className="text-right">Collected</SortTh>
                  <SortTh sorter={sorter} col="outstanding" className="text-right">To collect</SortTh>
                  <SortTh sorter={sorter} col="overdue" className="text-right">Overdue</SortTh>
                  <th />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && companies.length === 0 && (
              <tr>
                <td colSpan={cols} className="sub">Loading...</td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  {companies.length ? (
                    <span className="sub">None match the filters.</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 py-2">
                      <span className="sub">No companies or agents yet.</span>
                      {!notReady && (
                        <button type="button" className="btn btn-primary text-sm" onClick={() => setAdding(true)}>
                          <Icon name="plus" size={14} /> Add the first one
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )}
            {sorter.rows.map((c) => {
              const b = c.business;
              const l = c.ledger;
              const dash = <span className="faint">-</span>;
              const cell = (v) => (v > PENNY ? money(v) : dash);
              return (
                <tr
                  key={c.id}
                  onClick={() => setOpen({ id: c.id })}
                  style={{ cursor: "pointer", opacity: c.is_active === false ? 0.6 : undefined }}
                >
                  <td>
                    <button
                      type="button"
                      className="font-medium underline decoration-dotted underline-offset-2"
                      style={{ color: "var(--accent)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen({ id: c.id });
                      }}
                    >
                      {c.name}
                    </button>{" "}
                    <span className="text-xs muted">{c.kind === "travel_agent" ? "Travel agent" : "Company"}</span>
                    {c.is_active === false && <span className="chip ml-1">Inactive</span>}
                    {l?.overLimit && <span className="chip chip-warn ml-1">Over limit</span>}
                  </td>
                  {hasBusiness && (
                    <>
                      <td className="text-right tabular-nums">{b?.bookings ? formatAmount(b.bookings) : dash}</td>
                      <td className="text-right tabular-nums">{b?.nights ? formatAmount(b.nights) : dash}</td>
                      <td className="text-right tabular-nums font-medium">{cell(b?.value || 0)}</td>
                    </>
                  )}
                  {hasLedger && (
                    <>
                      <td className="text-right tabular-nums">{cell(l?.billed || 0)}</td>
                      <td className="text-right tabular-nums">{cell(l?.collected || 0)}</td>
                      <td className="text-right tabular-nums font-medium">{cell(l?.outstanding || 0)}</td>
                      <td className="text-right tabular-nums" style={{ color: (l?.overdue || 0) > PENNY ? "var(--danger)" : undefined }}>
                        {(l?.overdue || 0) > PENNY ? (
                          <button
                            type="button"
                            className="underline decoration-dotted underline-offset-2"
                            style={{ color: "var(--danger)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen({ id: c.id, tab: "ledger" });
                            }}
                          >
                            {money(l.overdue)}
                          </button>
                        ) : (
                          dash
                        )}
                      </td>
                      <td className="text-right">
                        {(l?.outstanding || 0) > PENNY && (
                          <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen({ id: c.id, tab: "ledger", receive: true });
                            }}
                          >
                            Receive
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>

      {adding && (
        <AddCompany
          propertyId={propertyId}
          kind={kindFilter}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onClose={() => {
            setAdding(false);
            load();
          }}
          onSaved={(saved) => setCompanies((prev) => [...prev, saved])}
          onOpen={(id, tab) => setOpen({ id, tab })}
        />
      )}

      {opened && (
        <CompanyPanel
          key={opened.id}
          session={session}
          propertyId={propertyId}
          company={opened}
          startTab={open.tab}
          startReceiving={Boolean(open.receive)}
          canSeeLedger={canSeeLedger}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onClose={() => setOpen(null)}
          onChanged={changed}
          onRateCount={setRateCount}
          onDeleted={(id) => {
            setOpen(null);
            setCompanies((prev) => prev.filter((c) => c.id !== id));
          }}
        />
      )}
    </div>
  );
}
