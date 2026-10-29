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
  OFFER_TYPES,
  isTargeted,
  WEEKDAYS,
  cleanCode,
  couponProblem,
  offerAmount,
  offerWhen,
  promotionProblem,
} from "@/lib/promotions";
import { Grid, sendJSON } from "./SetupGrid";
import Select from "@/app/components/Select";
import { hotelToday } from "@/lib/hotelTime";

/**
 * The Booking Engine's Offers tab: every discount in one list -- promotions
 * of each type, long stays and coupon codes -- each opened in a side panel
 * to add or change it. The panel asks only what the offer's type needs
 * first -- the name or code, how much off, and the type's own question --
 * and keeps the rest (dates, blackout dates, days, nights, rooms and plans)
 * below, all optional.
 *
 * Promotions and coupons are kept apart underneath (lib/promotions.js), as
 * they price differently; a coupon is just the offer type "Coupon code" here.
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
const BLANK = { ...BLANK_TERMS, name: "", type: "basic", days: "", weekdays: [], blackout: [], code: "", stack: true, maxUses: "" };

let seq = 0;
const newId = () => `o${Date.now().toString(36)}${(seq += 1)}`;

/** The offer as the form holds it: numbers as text, blanks as "". */
const toForm = (o) => ({
  ...BLANK,
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

export default function OffersTab({ propertyId, promotions, coupons, rules, rooms, plans, currency, onSave, usedCounts = {} }) {
  const [editing, setEditing] = useState(null);
  const [cap, setCap] = useState(rules?.maxTotalPercent ? String(rules.maxTotalPercent) : "");
  const toast = useToast();
  const dialog = useDialog();
  const money = (v) => formatMoney(v, { currency });
  const rows = [...promotions, ...coupons.map((c) => ({ ...c, type: "coupon" }))];
  const nameOf = (ids, all) => (ids?.length ? ids.map((id) => all.find((x) => x.id === id)?.name).filter(Boolean).join(", ") : "All");
  const label = (o) => (o.type === "coupon" ? `Coupon ${o.code}` : o.name);

  /** Puts an offer in the right list, out of the other if its type moved across. */
  async function save(offer) {
    const isCoupon = offer.type === "coupon";
    // Each list keeps only its own fields, so a type moved across leaves nothing behind.
    const { type: _type, days: _d, weekdays: _w, blackout: _b, ...coupon } = offer;
    const { code: _c, maxUses: _m, ...promotion } = offer;
    const nextPromotions = promotions.filter((p) => p.id !== offer.id);
    const nextCoupons = coupons.filter((c) => c.id !== offer.id);
    const at = (list) => list.findIndex((o) => o.id === offer.id);
    const place = (list, next, item) => {
      const i = at(list);
      if (i < 0) return [...next, item];
      const copy = [...next];
      copy.splice(Math.min(i, copy.length), 0, item);
      return copy;
    };
    await onSave({
      promotions: isCoupon ? nextPromotions : place(promotions, nextPromotions, promotion),
      coupons: isCoupon ? place(coupons, nextCoupons, coupon) : nextCoupons,
    });
    toast(`${label(offer)} saved`);
    setEditing(null);
  }

  async function remove(offer) {
    const yes = await dialog.confirm({
      title: `Delete ${label(offer)}?`,
      message: "Guests will no longer get it. Bookings already made keep their discount.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!yes) return;
    await onSave({
      promotions: promotions.filter((p) => p.id !== offer.id),
      coupons: coupons.filter((c) => c.id !== offer.id),
    });
    toast(`${label(offer)} deleted`);
    setEditing(null);
  }

  async function switchOnOff(offer) {
    const flip = (list) => list.map((o) => (o.id === offer.id ? { ...o, active: !o.active } : o));
    await onSave({ promotions: flip(promotions), coupons: flip(coupons) });
    toast(`${label(offer)} ${offer.active ? "switched off" : "switched on"}`);
  }

  const full = promotions.length >= MAX_PROMOTIONS && coupons.length >= MAX_COUPONS;
  const savedCap = rules?.maxTotalPercent ? String(rules.maxTotalPercent) : "";

  async function saveCap() {
    const n = cap.trim() === "" ? null : Math.round(Number(cap));
    if (n !== null && !(n >= 1 && n <= 90)) {
      toast("Most off in total is a percent from 1 to 90, or blank for no limit.", { tone: "error" });
      return;
    }
    await onSave({ offerRules: { maxTotalPercent: n } });
    toast(n ? `Guests never get more than ${n}% off in total` : "No limit on the total discount");
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="sub max-w-3xl space-y-1 text-sm">
          <p>
            <b style={{ color: "var(--text)" }}>Deals</b> (basic, early bird, last minute, long stay) never combine: the guest
            gets the one worth most.
          </p>
          <p>
            <b style={{ color: "var(--text)" }}>Mobile and coupon codes</b> add on top of the deal, one after the other, each off
            the price that is left. Switch Combine off on one to make it compete with the deal instead.
          </p>
        </div>
        <button type="button" className="btn btn-primary text-sm" disabled={full} onClick={() => setEditing(toForm({ id: newId() }))}>
          <Icon name="plus" /> Add offer
        </button>
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3 text-sm">
        <label className="flex items-center gap-2">
          Most off in total
          <input
            className="input"
            style={{ width: "5rem" }}
            inputMode="numeric"
            placeholder="No limit"
            value={cap}
            onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && saveCap()}
            aria-label="Most percent off in total"
          />
          %
        </label>
        {cap !== savedCap && (
          <button type="button" className="btn btn-secondary text-xs" onClick={saveCap}>
            Save
          </button>
        )}
        <span className="sub text-xs">However offers combine, guests never get more than this off the room.</span>
      </div>
      <Grid>
        <thead>
          <tr>
            <th>On</th>
            <th>Name or code</th>
            <th>Type</th>
            <th>Discount</th>
            <th>Combines</th>
            <th style={{ minWidth: 220 }}>When</th>
            <th>Rooms and plans</th>
            <th>Used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const when = offerWhen(o, shortDay);
            const coupon = o.type === "coupon";
            return (
              <tr key={o.id} style={o.active ? undefined : { opacity: 0.55 }}>
                <td className="text-center">
                  <input type="checkbox" checked={o.active} onChange={() => switchOnOff(o)} aria-label={`${label(o)} on`} />
                </td>
                <td className="font-medium">
                  <button type="button" className={`fact-link ${coupon ? "font-mono" : ""}`} onClick={() => setEditing(toForm(o))}>
                    {coupon ? o.code : o.name}
                  </button>
                </td>
                <td>{OFFER_TYPES.find((t) => t.id === o.type)?.label}</td>
                <td className="whitespace-nowrap">{offerAmount(o, money)}</td>
                <td className="whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  {!isTargeted(o) ? "Best deal only" : o.stack === false ? "Instead of a deal" : "Adds on top"}
                </td>
                <td className="text-xs" style={{ color: when.open ? "var(--warn)" : "var(--text-muted)" }}>
                  {when.text}
                </td>
                <td className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {nameOf(o.roomTypeIds, rooms)} rooms, {nameOf(o.planIds, plans).toLowerCase() === "all" ? "all" : nameOf(o.planIds, plans)} plans
                </td>
                <td className="whitespace-nowrap text-xs">
                  {coupon ? `${usedCounts[o.code] || 0}${o.maxUses ? ` of ${o.maxUses}` : ""}` : "-"}
                </td>
                <td>
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(toForm(o))}>
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="sub">
                No offers yet. Add one for a festival, early bookers, long stays, phone bookings, or a code to share on Instagram.
              </td>
            </tr>
          )}
        </tbody>
      </Grid>

      <Simulator propertyId={propertyId} currency={currency} hasOffers={rows.length > 0} />

      {editing && (
        <OfferPanel
          initial={editing}
          isNew={!rows.some((o) => o.id === editing.id)}
          coupons={coupons}
          promotionsFull={promotions.length >= MAX_PROMOTIONS}
          couponsFull={coupons.length >= MAX_COUPONS}
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

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Try it: what a guest would pay for a stay with the offers as saved, room
 * by room and plan by plan, each offer that came off and what it took, and
 * on Why, every offer and why it did or did not apply. Set the booking date
 * to try early bird or last minute, and tick phone to try mobile offers.
 * Prices only; it books nothing, and works before the page is open.
 */
function Simulator({ propertyId, currency, hasOffers }) {
  const today = hotelToday();
  const [form, setForm] = useState({
    checkIn: addDays(today, 14),
    checkOut: addDays(today, 16),
    adults: "2",
    bookedOn: today,
    mobile: false,
    code: "",
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [why, setWhy] = useState(null);
  const money = (v) => formatMoney(v, { currency, decimals: 2 });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function run(e) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setWhy(null);
    try {
      setResult(
        await sendJSON("/api/setup/bookingEngine/simulate", "POST", {
          propertyId: propertyId || undefined,
          ...form,
          adults: Number(form.adults),
        })
      );
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = (result?.offers || []).flatMap((o) => o.options.map((x) => ({ room: o.name, ...x })));

  return (
    <section className="card card-pad space-y-3">
      <div>
        <h3 className="h2">Try it</h3>
        <p className="sub text-xs">
          See what a guest would pay with your offers as saved, and why each offer did or did not apply. Nothing is booked.
        </p>
      </div>
      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <Field label="Check-in">
          <DateField className="input" style={{ width: "9rem" }} value={form.checkIn} onChange={(e) => e.target.value && set({ checkIn: e.target.value, checkOut: e.target.value >= form.checkOut ? addDays(e.target.value, 1) : form.checkOut })} />
        </Field>
        <Field label="Check-out">
          <DateField className="input" style={{ width: "9rem" }} value={form.checkOut} min={addDays(form.checkIn, 1)} onChange={(e) => e.target.value && set({ checkOut: e.target.value })} />
        </Field>
        <Field label="Adults">
          <Select className="input" style={{ width: "5rem" }} value={form.adults} onChange={(e) => set({ adults: e.target.value })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Booked on">
          <DateField className="input" style={{ width: "9rem" }} value={form.bookedOn} max={form.checkIn} onChange={(e) => e.target.value && set({ bookedOn: e.target.value })} />
        </Field>
        <Field label="Coupon code">
          <input
            className="input font-mono"
            style={{ width: "8rem", textTransform: "uppercase" }}
            value={form.code}
            placeholder="None"
            onChange={(e) => set({ code: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" checked={form.mobile} onChange={(e) => set({ mobile: e.target.checked })} />
          On a phone
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Working..." : "Show prices"}
        </button>
      </form>
      {!hasOffers && <p className="sub text-xs">You have no offers yet, so guests pay the full price.</p>}
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {result && rows.length === 0 && (
        <p className="sub">
          {result.minStay ? `These dates need at least ${result.minStay} nights.` : "No room is free and priced for these dates."}
        </p>
      )}
      {result?.code && result.code !== "applied" && (
        <p className="text-xs" style={{ color: "var(--warn)" }}>
          {result.code === "unknown"
            ? "There is no coupon with that code."
            : result.code === "full"
              ? "That coupon has been used as often as allowed."
              : "That coupon does not apply to these dates or rooms."}
        </p>
      )}
      {rows.length > 0 && (
        <Grid>
          <thead>
            <tr>
              <th>Room</th>
              <th>Plan</th>
              <th className="text-right">Full price</th>
              <th style={{ minWidth: 220 }}>Offers taken off</th>
              <th className="text-right">Guest pays</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = `${r.room}|${r.ratePlanId}`;
              const open = why === key;
              return [
                <tr key={key}>
                  <td className="font-medium">{r.room}</td>
                  <td>{r.name}</td>
                  <td className="text-right whitespace-nowrap">{money(r.fullTotal ?? r.total)}</td>
                  <td className="text-xs">
                    {r.discount?.steps?.length ? (
                      <ol className="space-y-0.5">
                        {r.discount.steps.map((st, i) => (
                          <li key={st.id || i}>
                            {i > 0 ? "then " : ""}
                            {st.label}: {money(st.amount)} off
                          </li>
                        ))}
                        {r.discount.capped && <li style={{ color: "var(--warn)" }}>Held to your most off in total</li>}
                      </ol>
                    ) : (
                      <span className="sub">None</span>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap font-semibold">
                    {money(r.total)}
                    <div className="sub text-xs font-normal">incl. {money(r.tax)} tax</div>
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost text-xs" aria-expanded={open} onClick={() => setWhy(open ? null : key)}>
                      {open ? "Hide" : "Why"}
                    </button>
                  </td>
                </tr>,
                open && (
                  <tr key={`${key}-why`}>
                    <td colSpan={6}>
                      <ul className="space-y-0.5 py-1 text-xs">
                        {(r.why || []).map((w) => (
                          <li key={w.id} className="flex flex-wrap gap-x-2">
                            <span className="font-medium" style={{ color: "var(--text)" }}>
                              {w.name}
                            </span>
                            <span style={{ color: w.applied ? "var(--accent-text)" : "var(--text-muted)" }}>
                              {w.applied ? `Applied, ${money(w.amount)} off` : w.reason}
                            </span>
                          </li>
                        ))}
                        {(r.why || []).length === 0 && <li className="sub">No offers saved.</li>}
                      </ul>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </Grid>
      )}
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

/**
 * One optional condition, folded to a line that says what it is set to.
 * Opening one closes the others, so the panel stays short. A condition with
 * a problem opens itself.
 */
function Condition({ id, open, setOpen, title, summary, error, last, children }) {
  const isOpen = open === id || Boolean(error);
  const set = summary && !/^(Any|Any day|Every day|All|No most)$/.test(summary);
  return (
    <div style={last ? undefined : { borderBottom: "1px solid var(--border)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm"
        aria-expanded={isOpen}
        onClick={() => setOpen(isOpen ? null : id)}
      >
        <span style={{ color: "var(--text)" }}>{title}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs" style={{ color: set ? "var(--accent-text)" : "var(--text-muted)", fontWeight: set ? 600 : 400 }}>
            {summary}
          </span>
          <Icon name={isOpen ? "up" : "down"} size={14} />
        </span>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

const range = (from, to, none) =>
  from && to ? `${shortDay(from)} to ${shortDay(to)}` : from ? `From ${shortDay(from)}` : to ? `Until ${shortDay(to)}` : none;

const picked = (ids, all) =>
  ids?.length ? (ids.length <= 2 ? ids.map((id) => all.find((x) => x.id === id)?.name).filter(Boolean).join(", ") : `${ids.length} ticked`) : "All";

function OfferPanel({ initial, isNew, coupons, promotionsFull, couponsFull, rooms, plans, currency, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blackoutDay, setBlackoutDay] = useState("");
  const [openPart, setOpenPart] = useState(null);
  const firstRef = useRef(null);
  const isCoupon = form.type === "coupon";
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
    const found = isCoupon ? couponProblem(form, coupons) : promotionProblem(form);
    const was = initial.type === "coupon";
    if (!found && isCoupon !== was && (isCoupon ? couponsFull : promotionsFull)) {
      setProblem({ field: "type", message: isCoupon ? "You have as many coupons as allowed." : "You have as many promotions as allowed." });
      return;
    }
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

  const title = isNew ? "New offer" : initial.type === "coupon" ? `Coupon ${initial.code}` : initial.name;

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

        <div className="card-pad flex-1 space-y-4">
          <div className="space-y-1.5">
            <span className="label">Type</span>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Offer type">
              {OFFER_TYPES.map((t) => {
                const on = form.type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ type: t.id })}
                    className="btn text-sm"
                    style={{
                      justifyContent: "center",
                      background: on ? "var(--accent-soft)" : "var(--surface)",
                      color: on ? "var(--accent-text)" : "var(--text)",
                      borderColor: on ? "var(--accent)" : "var(--border-strong)",
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="sub text-xs">{OFFER_TYPES.find((t) => t.id === form.type)?.hint}.</p>
            {problem?.field === "type" && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {problem.message}
              </p>
            )}
          </div>

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

          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Field label="Discount" error={err("value")}>
              <span className="flex gap-2">
                <input
                  className="input"
                  style={{ width: "6.5rem" }}
                  inputMode="decimal"
                  placeholder={form.kind === "amount" ? "500" : "10"}
                  {...bind("value")}
                />
                <span className="seg" role="radiogroup" aria-label="Percent or amount">
                  <button type="button" role="radio" aria-checked={form.kind === "percent"} className={form.kind === "percent" ? "seg-on" : ""} onClick={() => set({ kind: "percent" })}>
                    %
                  </button>
                  <button type="button" role="radio" aria-checked={form.kind === "amount"} className={form.kind === "amount" ? "seg-on" : ""} onClick={() => set({ kind: "amount" })}>
                    {currencySymbol(currency)}
                  </button>
                </span>
              </span>
            </Field>
            {form.type === "long" && (
              <Field label="Nights or more" error={err("minNights")}>
                <input className="input" style={{ width: "5.5rem" }} inputMode="numeric" placeholder="3" {...bind("minNights")} />
              </Field>
            )}
            {(form.type === "early" || form.type === "last") && (
              <Field label={form.type === "early" ? "Booked at least, days ahead" : "Booked within, days of arrival"} error={err("days")}>
                <input className="input" style={{ width: "5.5rem" }} inputMode="numeric" placeholder={form.type === "early" ? "30" : "3"} {...bind("days")} />
              </Field>
            )}
            {isCoupon && (
              <Field label="Most uses" error={err("maxUses")}>
                <input className="input" style={{ width: "6.5rem" }} inputMode="numeric" placeholder="No limit" {...bind("maxUses")} />
              </Field>
            )}
          </div>
          <p className="sub -mt-2 text-xs">
            {form.kind === "amount" ? "Off the whole stay, before tax." : "Off each night that qualifies, before tax."}
          </p>

          {(isCoupon || form.type === "mobile") && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={form.stack} onChange={(e) => set({ stack: e.target.checked })} />
              <span>
                Combine with other offers
                <span className="sub block text-xs">
                  {form.stack ? "Added on top of the best deal, off the price that is left." : "Competes with the deal: the guest gets whichever is worth more."}
                </span>
              </span>
            </label>
          )}

          <div className="space-y-0">
            <span className="label">Conditions, all optional</span>
            <div className="rounded" style={{ border: "1px solid var(--border)" }}>
              <Condition id="checkin" open={openPart} setOpen={setOpenPart} title="Check-in dates" summary={range(form.checkInFrom, form.checkInTo, "Any")} error={err("checkInTo")}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From">
                    <OptionalDate label="First check-in date" value={form.checkInFrom} onChange={(v) => set({ checkInFrom: v })} />
                  </Field>
                  <Field label="To" error={err("checkInTo")}>
                    <OptionalDate label="Last check-in date" value={form.checkInTo} min={form.checkInFrom || undefined} onChange={(v) => set({ checkInTo: v })} />
                  </Field>
                </div>
              </Condition>
              <Condition id="booking" open={openPart} setOpen={setOpenPart} title="Booking dates" summary={range(form.bookFrom, form.bookTo, "Any day")} error={err("bookTo")}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From">
                    <OptionalDate label="First booking date" value={form.bookFrom} onChange={(v) => set({ bookFrom: v })} />
                  </Field>
                  <Field label="To" error={err("bookTo")}>
                    <OptionalDate label="Last booking date" value={form.bookTo} min={form.bookFrom || undefined} onChange={(v) => set({ bookTo: v })} />
                  </Field>
                </div>
              </Condition>
              {!isCoupon && (
                <Condition
                  id="nights"
                  open={openPart}
                  setOpen={setOpenPart}
                  title="Days and blackout dates"
                  summary={[
                    form.weekdays.length ? form.weekdays.map((d) => WEEKDAYS[d]).join(" ") : "Every day",
                    form.blackout.length ? `${form.blackout.length} blackout` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                >
                  <div className="space-y-3">
                    <div className="seg" role="group" aria-label="Days of the week">
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
                    <Field label="Add a blackout date">
                      <OptionalDate label="Blackout date" value={blackoutDay} onChange={(v) => (v ? addBlackout(v) : setBlackoutDay(""))} />
                    </Field>
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
                  </div>
                </Condition>
              )}
              <Condition
                id="stay"
                open={openPart}
                setOpen={setOpenPart}
                title="Length of stay"
                summary={
                  form.type === "long"
                    ? form.maxNights
                      ? `Up to ${form.maxNights} nights`
                      : "No most"
                    : form.minNights || form.maxNights
                      ? `${form.minNights || 1} to ${form.maxNights || "any"} nights`
                      : "Any"
                }
                error={err("maxNights") || (form.type !== "long" ? err("minNights") : null)}
              >
                <div className="flex gap-3">
                  {form.type !== "long" && (
                    <Field label="Fewest nights" error={err("minNights")}>
                      <input className="input" style={{ width: "6rem" }} inputMode="numeric" placeholder="Any" {...bind("minNights")} />
                    </Field>
                  )}
                  <Field label="Most nights" error={err("maxNights")}>
                    <input className="input" style={{ width: "6rem" }} inputMode="numeric" placeholder="Any" {...bind("maxNights")} />
                  </Field>
                </div>
              </Condition>
              <Condition id="rooms" open={openPart} setOpen={setOpenPart} title="Room types" summary={picked(form.roomTypeIds, rooms)}>
                <Picks all={rooms} picked={form.roomTypeIds} onChange={(v) => set({ roomTypeIds: v })} noun="room types" />
              </Condition>
              <Condition id="plans" open={openPart} setOpen={setOpenPart} title="Rate plans" summary={picked(form.planIds, plans)} last>
                <Picks all={plans} picked={form.planIds} onChange={(v) => set({ planIds: v })} noun="rate plans" />
              </Condition>
            </div>
          </div>

          {problem?.field === "form" && (
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
          <label className="ml-auto flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            Switched on
          </label>
          {!isNew && (
            <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={onDelete} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
