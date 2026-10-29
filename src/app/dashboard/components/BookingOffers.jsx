"use client";

import { useEffect, useRef, useState } from "react";
import DateField from "@/app/components/DateField";
import Icon from "@/app/components/Icon";
import { useToast } from "@/app/components/Toast";
import { useDialog } from "@/app/components/Dialog";
import { useBackdropClose, useEscape } from "@/app/components/useEscape";
import { currencySymbol, formatMoney } from "@/lib/money";
import {
  MAX_BLACKOUTS,
  MAX_COUPONS,
  MAX_PROMOTIONS,
  PROMOTION_TYPES,
  WEEKDAYS,
  cleanCode,
  couponProblem,
  offerAmount,
  offerWhen,
  promotionProblem,
} from "@/lib/promotions";
import { Grid } from "./SetupGrid";

/**
 * The Booking Engine's Promotions and Coupons tabs: a list of offers, each
 * opened in a side panel to add or change it. The panel asks only what the
 * offer's type needs first -- the name, how much off, and the type's own
 * question -- and keeps the rest (dates, blackout dates, days, nights,
 * rooms and plans) below, all optional.
 *
 * An offer saves when its panel is saved, like a booking does; it does not
 * wait for the page's Save.
 */

function shortDay(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const BLANK_TERMS = {
  kind: "percent",
  value: "",
  checkInFrom: "",
  checkInTo: "",
  bookFrom: "",
  bookTo: "",
  minNights: "",
  maxNights: "",
  planIds: [],
  roomTypeIds: [],
  active: true,
};
const BLANK = {
  promotion: { ...BLANK_TERMS, name: "", type: "basic", days: "", weekdays: [], blackout: [] },
  coupon: { ...BLANK_TERMS, code: "", name: "", stack: true, maxUses: "" },
};

let seq = 0;
const newId = (kind) => `${kind === "coupon" ? "c" : "p"}${Date.now().toString(36)}${(seq += 1)}`;

/** The offer as the form holds it: numbers as text, blanks as "". */
const toForm = (o, kind) => ({
  ...BLANK[kind],
  ...o,
  value: o.value ?? "",
  days: o.days ?? "",
  minNights: o.minNights ?? "",
  maxNights: o.maxNights ?? "",
  maxUses: o.maxUses ?? "",
  checkInFrom: o.checkInFrom || "",
  checkInTo: o.checkInTo || "",
  bookFrom: o.bookFrom || "",
  bookTo: o.bookTo || "",
});

export default function OffersTab({ kind, list, rooms, plans, currency, onSave, usedCounts = {} }) {
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const dialog = useDialog();
  const money = (v) => formatMoney(v, { currency });
  const isCoupon = kind === "coupon";
  const max = isCoupon ? MAX_COUPONS : MAX_PROMOTIONS;
  const nameOf = (ids, all) => (ids?.length ? ids.map((id) => all.find((x) => x.id === id)?.name).filter(Boolean).join(", ") : "All");

  async function save(offer) {
    const exists = list.some((o) => o.id === offer.id);
    await onSave(exists ? list.map((o) => (o.id === offer.id ? offer : o)) : [...list, offer]);
    toast(isCoupon ? `Coupon ${offer.code} saved` : `${offer.name} saved`);
    setEditing(null);
  }

  async function remove(offer) {
    const yes = await dialog.confirm({
      title: isCoupon ? `Delete coupon ${offer.code}?` : `Delete ${offer.name}?`,
      message: "Guests will no longer get it. Bookings already made keep their discount.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!yes) return;
    await onSave(list.filter((o) => o.id !== offer.id));
    toast(isCoupon ? `Coupon ${offer.code} deleted` : `${offer.name} deleted`);
    setEditing(null);
  }

  async function switchOnOff(offer) {
    await onSave(list.map((o) => (o.id === offer.id ? { ...o, active: !o.active } : o)));
    toast(`${isCoupon ? offer.code : offer.name} ${offer.active ? "switched off" : "switched on"}`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="sub">
          {isCoupon
            ? "Codes you give out, on Instagram or to a group. A guest types one on your booking page. By default it adds on top of any running promotion."
            : "Offers every guest who fits gets, on the room before tax. The biggest one wins; they never add up. A coupon can add on top."}
        </p>
        <button
          type="button"
          className="btn btn-primary text-sm"
          disabled={list.length >= max}
          onClick={() => setEditing(toForm({ id: newId(kind) }, kind))}
        >
          <Icon name="plus" /> {isCoupon ? "Add coupon" : "Add promotion"}
        </button>
      </div>
      <Grid>
        <thead>
          <tr>
            <th>On</th>
            <th>{isCoupon ? "Code" : "Name guests see"}</th>
            {!isCoupon && <th>Type</th>}
            <th>Discount</th>
            <th style={{ minWidth: 220 }}>When</th>
            <th>Rooms and plans</th>
            {isCoupon && <th>Used</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((o) => {
            const when = offerWhen(o, shortDay);
            return (
              <tr key={o.id} style={o.active ? undefined : { opacity: 0.55 }}>
                <td className="text-center">
                  <input type="checkbox" checked={o.active} onChange={() => switchOnOff(o)} aria-label={`${isCoupon ? o.code : o.name} on`} />
                </td>
                <td className="font-medium">
                  <button type="button" className="fact-link" onClick={() => setEditing(toForm(o, kind))}>
                    {isCoupon ? o.code : o.name}
                  </button>
                </td>
                {!isCoupon && <td>{PROMOTION_TYPES.find((t) => t.id === o.type)?.label}</td>}
                <td className="whitespace-nowrap">
                  {offerAmount(o, money)}
                  {isCoupon && <span className="sub text-xs">{o.stack ? ", on top" : ", instead"}</span>}
                </td>
                <td className="text-xs" style={{ color: when.open ? "var(--warn)" : "var(--text-muted)" }}>
                  {when.text}
                </td>
                <td className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {nameOf(o.roomTypeIds, rooms)} rooms, {nameOf(o.planIds, plans).toLowerCase() === "all" ? "all" : nameOf(o.planIds, plans)} plans
                </td>
                {isCoupon && (
                  <td className="text-xs whitespace-nowrap">
                    {usedCounts[o.code] || 0}
                    {o.maxUses ? ` of ${o.maxUses}` : ""}
                  </td>
                )}
                <td>
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(toForm(o, kind))}>
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td colSpan={8} className="sub">
                {isCoupon
                  ? "No coupons yet. Add one like INSTA10 to share on your Instagram."
                  : "No promotions yet. Add one for a festival, early bookers, last-minute rooms or phone bookings."}
              </td>
            </tr>
          )}
        </tbody>
      </Grid>

      {editing && (
        <OfferPanel
          kind={kind}
          initial={editing}
          isNew={!list.some((o) => o.id === editing.id)}
          others={list}
          rooms={rooms}
          plans={plans}
          currency={currency}
          onSave={save}
          onDelete={() => remove(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** A small titled block of the panel. */
function Block({ title, hint, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h4>
        {hint && <p className="sub text-xs">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, error, children, className = "" }) {
  return (
    <label className={`block min-w-0 space-y-1 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error && (
        <span className="block text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** A date box that can be emptied again, since blank means any date. */
function OptionalDate({ value, onChange, label, min }) {
  return (
    <span className="flex items-center gap-1">
      <DateField className="input w-full" value={value || ""} min={min} onChange={(e) => onChange(e.target.value)} placeholder="Any" aria-label={label} />
      {value && (
        <button type="button" className="btn btn-ghost" style={{ padding: "0.4rem" }} onClick={() => onChange("")} aria-label={`Clear ${label}`}>
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
}

/** Tick boxes for rooms or plans; none ticked means all. */
function Picks({ all, picked, onChange, noun }) {
  const set = new Set(picked);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {all.map((x) => (
        <label key={x.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={set.has(x.id)}
            onChange={() => onChange(set.has(x.id) ? picked.filter((id) => id !== x.id) : [...picked, x.id])}
          />
          {x.name}
        </label>
      ))}
      {all.length === 0 && <span className="sub text-xs">No {noun} yet.</span>}
      <span className="sub w-full text-xs">{picked.length ? `Only the ${noun} ticked.` : `None ticked means all ${noun}.`}</span>
    </div>
  );
}

function OfferPanel({ kind, initial, isNew, others, rooms, plans, currency, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blackoutDay, setBlackoutDay] = useState("");
  const firstRef = useRef(null);
  const isCoupon = kind === "coupon";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const dialog = useDialog();

  async function close() {
    if (busy) return;
    if (dirty) {
      const yes = await dialog.confirm({
        title: "Leave without saving?",
        message: "What you changed here will be lost.",
        confirmLabel: "Leave",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!yes) return;
    }
    onClose();
  }
  useEscape(close);
  const backdrop = useBackdropClose(close);
  useEffect(() => firstRef.current?.focus(), []);

  const set = (patch) => {
    setProblem(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const bind = (k) => ({ value: form[k] ?? "", onChange: (e) => set({ [k]: e.target.value }) });
  const err = (f) => (problem?.field === f ? problem.message : null);

  async function submit(e) {
    e.preventDefault();
    const found = isCoupon ? couponProblem(form, others) : promotionProblem(form);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...form, ...(isCoupon ? { code: cleanCode(form.code) } : {}) });
    } catch (err2) {
      setProblem({ field: "form", message: err2.message });
      setBusy(false);
    }
  }

  const addBlackout = (d) => {
    if (!d || form.blackout.includes(d) || form.blackout.length >= MAX_BLACKOUTS) return;
    set({ blackout: [...form.blackout, d].sort() });
    setBlackoutDay("");
  };

  const title = isCoupon ? (isNew ? "New coupon" : `Coupon ${initial.code}`) : isNew ? "New promotion" : initial.name;

  return (
    <div className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={title} {...backdrop}>
      <form className="side-panel flex flex-col" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>{title}</h3>
          <button type="button" className="head-close" onClick={close} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="card-pad flex-1 space-y-5">
          {!isCoupon && (
            <Block title="Type">
              <div className="seg flex-wrap" role="radiogroup" aria-label="Promotion type">
                {PROMOTION_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={form.type === t.id}
                    className={form.type === t.id ? "seg-on" : ""}
                    onClick={() => set({ type: t.id })}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="sub text-xs">{PROMOTION_TYPES.find((t) => t.id === form.type)?.hint}.</p>
            </Block>
          )}

          <Block title={isCoupon ? "Code and discount" : "Name and discount"}>
            <div className="grid gap-3 sm:grid-cols-2">
              {isCoupon ? (
                <Field label="Code guests type" error={err("code")}>
                  <input
                    ref={firstRef}
                    className="input w-full font-mono"
                    style={{ textTransform: "uppercase" }}
                    maxLength={20}
                    placeholder="INSTA10"
                    autoCapitalize="characters"
                    spellCheck={false}
                    {...bind("code")}
                  />
                </Field>
              ) : (
                <Field label="Name guests see" error={err("name")}>
                  <input ref={firstRef} className="input w-full" maxLength={60} placeholder="Diwali offer" {...bind("name")} />
                </Field>
              )}
              <Field label="Discount" error={err("value")}>
                <span className="flex gap-2">
                  <input className="input w-full" inputMode="decimal" placeholder={form.kind === "amount" ? "500" : "10"} {...bind("value")} />
                  <span className="seg" role="radiogroup" aria-label="Percent or amount">
                    <button type="button" role="radio" aria-checked={form.kind === "percent"} className={form.kind === "percent" ? "seg-on" : ""} onClick={() => set({ kind: "percent" })}>
                      %
                    </button>
                    <button type="button" role="radio" aria-checked={form.kind === "amount"} className={form.kind === "amount" ? "seg-on" : ""} onClick={() => set({ kind: "amount" })}>
                      Amount
                    </button>
                  </span>
                </span>
              </Field>
              {isCoupon && (
                <Field label="Name guests see (optional)" className="sm:col-span-2">
                  <input className="input w-full" maxLength={60} placeholder={`Code ${cleanCode(form.code) || "INSTA10"}`} {...bind("name")} />
                </Field>
              )}
            </div>
            <p className="sub text-xs">
              {form.kind === "amount"
                ? `${currencySymbol(currency)} off the whole stay, before tax.`
                : "Off each night that qualifies, before tax."}
            </p>
          </Block>

          {!isCoupon && (form.type === "early" || form.type === "last") && (
            <Block title={form.type === "early" ? "Early bird" : "Last minute"}>
              <Field label={form.type === "early" ? "Booked at least this many days before arrival" : "Booked this many days before arrival, or fewer"} error={err("days")}>
                <input className="input" style={{ width: "6rem" }} inputMode="numeric" placeholder={form.type === "early" ? "30" : "3"} {...bind("days")} />
              </Field>
            </Block>
          )}

          {isCoupon && (
            <Block title="With promotions">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.stack} onChange={(e) => set({ stack: e.target.checked })} />
                Add on top of a running promotion
              </label>
              <p className="sub text-xs">
                {form.stack
                  ? "A guest gets the promotion and then this code off what is left."
                  : "A guest gets this code or the promotion, whichever is worth more."}
              </p>
              <Field label="Most uses (optional)" error={err("maxUses")}>
                <input className="input" style={{ width: "7rem" }} inputMode="numeric" placeholder="No limit" {...bind("maxUses")} />
              </Field>
            </Block>
          )}

          <Block title="Check-in dates" hint="When guests arrive. Blank means any date.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <OptionalDate label="First check-in date" value={form.checkInFrom} onChange={(v) => set({ checkInFrom: v })} />
              </Field>
              <Field label="To" error={err("checkInTo")}>
                <OptionalDate label="Last check-in date" value={form.checkInTo} min={form.checkInFrom || undefined} onChange={(v) => set({ checkInTo: v })} />
              </Field>
            </div>
          </Block>

          <Block title="Booking dates" hint="When guests book. Blank means any day.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <OptionalDate label="First booking date" value={form.bookFrom} onChange={(v) => set({ bookFrom: v })} />
              </Field>
              <Field label="To" error={err("bookTo")}>
                <OptionalDate label="Last booking date" value={form.bookTo} min={form.bookFrom || undefined} onChange={(v) => set({ bookTo: v })} />
              </Field>
            </div>
          </Block>

          {!isCoupon && (
            <Block title="Nights it applies to" hint="Untick days to leave them out. Blackout nights never get the discount.">
              <div className="seg flex-wrap" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((d, i) => {
                  const on = form.weekdays.length === 0 || form.weekdays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? "seg-on" : ""}
                      onClick={() => {
                        const current = form.weekdays.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : form.weekdays;
                        const next = on ? current.filter((x) => x !== i) : [...current, i].sort();
                        set({ weekdays: next.length === 7 ? [] : next });
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Blackout dates">
                  <OptionalDate label="Blackout date" value={blackoutDay} onChange={(v) => (v ? addBlackout(v) : setBlackoutDay(""))} />
                </Field>
              </div>
              {form.blackout.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.blackout.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs" style={{ border: "1px solid var(--border)" }}>
                      {shortDay(d)}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: "0.15rem" }}
                        onClick={() => set({ blackout: form.blackout.filter((x) => x !== d) })}
                        aria-label={`Remove blackout ${shortDay(d)}`}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </Block>
          )}

          <Block title="Length of stay" hint="Blank means any.">
            <div className="flex gap-3">
              <Field label="Fewest nights" error={err("minNights")}>
                <input className="input" style={{ width: "6rem" }} inputMode="numeric" placeholder="Any" {...bind("minNights")} />
              </Field>
              <Field label="Most nights" error={err("maxNights")}>
                <input className="input" style={{ width: "6rem" }} inputMode="numeric" placeholder="Any" {...bind("maxNights")} />
              </Field>
            </div>
          </Block>

          <Block title="Room types">
            <Picks all={rooms} picked={form.roomTypeIds} onChange={(v) => set({ roomTypeIds: v })} noun="room types" />
          </Block>
          <Block title="Rate plans">
            <Picks all={plans} picked={form.planIds} onChange={(v) => set({ planIds: v })} noun="rate plans" />
          </Block>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            Switched on
          </label>
          {problem && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {problem.message}
            </p>
          )}
        </div>

        <div className="side-panel-foot card-pad flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          {!isNew && (
            <button type="button" className="btn btn-ghost ml-auto" style={{ color: "var(--danger)" }} onClick={onDelete} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
