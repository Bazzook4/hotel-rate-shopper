"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import { handleExpiredSession } from "@/lib/authRedirect";
import { inventoryWarning } from "@/lib/inventoryNotice";
import { plansForRoom } from "@/lib/ratePlanPricing";
import { countryOptions, toCountryCode } from "@/lib/countries";
import { TierBadge, useGuestTiers } from "./GuestSettings";
import {
  DAY_USE_HOLDING_STATUSES,
  dayUseLabel,
  dayUseStartOptions,
  dayUseWindow,
  dayUseWindowLabel,
  formatMinutes,
  isDayUsePlan,
  parseClock,
  suggestDayUseStart,
  toClock,
  windowsOverlap,
} from "@/lib/dayUse";

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

/** Today's date on the desk's own clock, for "the next free half hour". */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyBooking(country = "") {
  const today = todayUTC();
  return {
    guest_id: null,
    guest_name: "",
    guest_email: "",
    guest_phone: "",
    guest_country: country,
    guest_residency: "domestic",
    room_type_id: "",
    room_id: "",
    rate_plan_id: "",
    // todayUTC is already an ISO string; formatDateISO only takes a Date and
    // would turn it into "", leaving every new booking without an arrival.
    check_in: today,
    check_out: formatDateISO(addDays(today, 1)),
    // "day_use" is some hours of one day; it then leaves on the day it
    // arrives and holds no night.
    stay_kind: "overnight",
    day_use_hours: "",
    // A day use's booked start, "10:00"; suggested once the slot is known.
    day_use_start: "",
    adults: 2,
    children: 0,
    source: "direct",
    booking_type: "standard",
    company_id: "",
    bill_to: "guest",
    // Only chosen when the booking is made; after that it moves through the
    // desk's status buttons, not the form.
    status: "confirmed",
    total_amount: "",
    notes: "",
  };
}

/** A reservation from the API, flattened into what the inputs hold. */
function toForm(reservation) {
  return {
    guest_id: reservation.guest_id || null,
    guest_name: reservation.guest_name || "",
    guest_email: reservation.guest_email || "",
    guest_phone: reservation.guest_phone || "",
    guest_country: reservation.guest_country || "",
    guest_residency: reservation.guest_residency || "domestic",
    room_type_id: reservation.room_type_id || "",
    room_id: reservation.room_id || "",
    rate_plan_id: reservation.rate_plan_id || "",
    check_in: reservation.check_in || "",
    check_out: reservation.check_out || "",
    stay_kind: reservation.stay_kind || "overnight",
    day_use_hours: reservation.day_use_hours ?? "",
    day_use_start: String(reservation.day_use_start || "").slice(0, 5),
    adults: reservation.adults ?? 2,
    children: reservation.children ?? 0,
    source: reservation.source || "direct",
    booking_type: reservation.booking_type || "standard",
    company_id: reservation.company_id || "",
    bill_to: reservation.bill_to || "guest",
    total_amount: reservation.total_amount ?? "",
    notes: reservation.notes || "",
  };
}

/** Where a quoted price came from, in the desk's language rather than ours. */
const SOURCE_LABEL = {
  daily_rates: "live channel manager rate",
  derived: "derived from the master plan",
  rate_plan: "from the rate plan",
  base_price: "room base price — not a channel rate",
  day_use: "day-use price for this room type",
};

/**
 * The line under the total: what the price is, and how to get back to it.
 *
 * The desk needs to know whether a figure was quoted or typed, because those
 * carry different authority -- a quoted total can be trusted to match what the
 * channels sell, a typed one is somebody's decision. Saying so in one line is
 * cheaper than making them open Rate Plan Setup to check.
 */
function PriceNote({ quote, quoting, manual, nights, onUseQuoted }) {
  if (quoting) {
    return <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>Pricing…</p>;
  }

  if (manual) {
    return (
      <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
        Entered by hand.
        {quote?.total != null && (
          <>
            {" "}
            Configured rate is {Math.round(quote.total).toLocaleString("en-IN")}.{" "}
            <button
              type="button"
              className="btn-link"
              onClick={onUseQuoted}
              style={{
                padding: 0,
                border: 0,
                background: "none",
                color: "var(--accent)",
                cursor: "pointer",
                font: "inherit",
                textDecoration: "underline",
              }}
            >
              Use it
            </button>
          </>
        )}
      </p>
    );
  }

  // Nothing configured: say so plainly and leave the box to the desk.
  if (quote && quote.total == null) {
    return (
      <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem", color: "var(--warn)" }}>
        {quote.reason || "No rate configured — enter the total by hand."}
      </p>
    );
  }

  if (!quote || quote.total == null) return null;

  const perNight = nights > 0 ? Math.round(quote.total / nights) : null;

  // A base-price quote is the one case the desk should not trust blindly: it
  // is what the room costs in setup, not what the channels are selling.
  const weak = quote.source === "base_price";

  // A company with a contract that covers none of these nights is quoted at
  // the public rate; the desk must see that, since the guest expects the
  // contract.
  const uncovered = quote.contract && quote.contract.covered === 0;

  return (
    <>
    {uncovered && (
      <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem", color: "var(--warn)" }}>
        {quote.contract.company} has no contract rate for this room and plan on these dates — public rate quoted.
      </p>
    )}
    <p
      className="sub"
      style={{ fontSize: "0.7rem", marginTop: "0.25rem", color: weak ? "var(--warn)" : undefined }}
    >
      {quote.source === "contract"
        ? `${quote.contract.company} contract rate`
        : SOURCE_LABEL[quote.source] || "from configured rates"}
      {quote.diagnosis && <> — {quote.diagnosis}</>}
      {perNight != null && nights > 1 && (
        <> · {perNight.toLocaleString("en-IN")}/night × {nights}</>
      )}
      {quote.partial && (
        <span style={{ color: "var(--warn)" }}>
          {" "}
          · some nights have no rate set
        </span>
      )}
    </p>
    </>
  );
}

/**
 * Where a booking came from. Bookings the channel manager delivers carry the
 * channel's own name (Booking.com, MakeMyTrip…), which is not in this list;
 * the form adds it as an option so editing such a booking does not rewrite it.
 */
const BOOKING_SOURCES = [
  { value: "direct", label: "Direct" },
  { value: "walkin", label: "Walk-in" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "corporate", label: "Corporate" },
  { value: "travel_agent", label: "Travel agent" },
  { value: "ota", label: "OTA (entered by hand)" },
];

/** A titled block of the form, four fields to a row on a wide screen. */
function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h4
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
        }}
      >
        {title}
      </h4>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, wide = false, children }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <label className="label">{label}</label>
      {children}
      {hint && (
        <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function shortDate(iso) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Guests on record matching what the desk is typing, under the box.
 *
 * Offered from the name box and the phone box, since a caller is as likely
 * to give a number as a name. Picking with the mouse uses mousedown, so the
 * pick lands before the box's blur closes the list.
 */
function GuestSuggestions({ items, active, onPick, status, term }) {
  const box = {
    position: "absolute",
    zIndex: 30,
    left: 0,
    right: 0,
    top: "100%",
    marginTop: 2,
    padding: "0.5rem 0.6rem",
    boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
  };
  // A search the desk asked for always answers, so a blank space under the
  // box never leaves them wondering whether it is still looking.
  if (status === "searching" && !items?.length) {
    return (
      <div className="card text-xs" style={{ ...box, color: "var(--text-muted)" }}>
        Searching guests…
      </div>
    );
  }
  if (status === "none") {
    return (
      <div className="card text-xs" style={{ ...box, color: "var(--text-muted)" }}>
        No guest on record matches &ldquo;{term}&rdquo;. A new guest is added when you save.
      </div>
    );
  }
  if (!items?.length) return null;
  return (
    <ul
      className="card"
      role="listbox"
      style={{
        position: "absolute",
        zIndex: 30,
        left: 0,
        right: 0,
        top: "100%",
        marginTop: 2,
        padding: 0,
        maxHeight: 260,
        overflowY: "auto",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      {items.map((g, i) => (
        <li
          key={g.id}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(g);
          }}
          style={{
            padding: "0.4rem 0.6rem",
            cursor: "pointer",
            borderBottom: "1px solid var(--border)",
            background: i === active ? "var(--accent-soft)" : undefined,
          }}
        >
          <div className="text-sm" style={{ fontWeight: 600 }}>
            {g.full_name}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {[g.phone, g.email].filter(Boolean).join(" · ") || "No contact details"}
            {" · "}
            {g.stays ? `${g.stays} stay${g.stays === 1 ? "" : "s"}` : "no stays yet"}
            {g.last_stay ? `, last ${shortDate(g.last_stay)}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The guest record this booking is on: who, how often, and their notes. */
function LinkedGuest({ guest, onUnlink, propertyId }) {
  // The guest's tier, shown as its badge so the desk knows who they are
  // talking to; and what their wallet holds, which can pay this bill.
  const { tiers } = useGuestTiers(propertyId);
  const tier = guest.tier_id ? tiers.find((t) => t.id === guest.tier_id) : null;
  return (
    <div
      className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1"
      style={{ marginTop: "0.25rem", color: "var(--text-muted)" }}
    >
      <span className="chip chip-ok">
        {guest.stays ? "Returning guest" : "Guest on record"}
      </span>
      <TierBadge tier={tier} />
      {guest.wallet > 0 && (
        <span title="Can pay this booking's bill, from the Bill tab">
          Wallet ₹{Math.round(guest.wallet).toLocaleString("en-IN")}
        </span>
      )}
      {guest.stays > 0 && (
        <span>
          {guest.stays} stay{guest.stays === 1 ? "" : "s"}
          {guest.last_stay ? `, last ${shortDate(guest.last_stay)}` : ""}
        </span>
      )}
      {guest.notes && <span style={{ color: "var(--warn)" }}>{guest.notes}</span>}
      <button
        type="button"
        onClick={onUnlink}
        style={{
          padding: 0,
          border: 0,
          background: "none",
          color: "var(--accent)",
          cursor: "pointer",
          font: "inherit",
          textDecoration: "underline",
        }}
      >
        Not this guest
      </button>
    </div>
  );
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
  // The hotel's own country: where most guests come from, so the default,
  // and the line between a domestic and an international guest.
  const homeCountry = toCountryCode(session?.propertyCountry);
  const countries = useMemo(() => countryOptions(), []);

  // A booking started by clicking an empty cell on the tape chart arrives with
  // the room and date already chosen, which is most of the form filled in.
  const [form, setForm] = useState(() =>
    reservation
      ? toForm(reservation)
      : { ...emptyBooking(homeCountry || ""), ...(prefill || {}) }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /**
   * The guest database. `linked` is the record this booking is on; while
   * there is none, typing a name or phone looks for one. A booking saved
   * without picking is still matched on phone or email by the server, so the
   * list only ever saves the desk typing -- it is never required.
   */
  const [linked, setLinked] = useState(null);
  const [suggest, setSuggest] = useState({ field: null, items: [], active: -1 });
  // "searching" or "none" while the Search button's own search is showing.
  const [searchStatus, setSearchStatus] = useState(null);
  const lookupSeq = useRef(0);
  const nameBox = useRef(null);

  // An existing booking already on a guest shows who, and how often.
  useEffect(() => {
    if (!reservation?.guest_id) return;
    const qs = new URLSearchParams({ id: reservation.guest_id });
    if (session?.propertyId) qs.set("propertyId", session.propertyId);
    fetch(`/api/pms/guests?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.guest && setLinked(d.guest))
      .catch(() => {});
  }, [reservation?.guest_id, session?.propertyId]);

  /** Ask for guests matching `term`, shown under `field`'s box. */
  async function runGuestSearch(field, term, seq, { asked = false } = {}) {
    try {
      const qs = new URLSearchParams({ search: term, limit: "6" });
      if (session?.propertyId) qs.set("propertyId", session.propertyId);
      const res = await fetch(`/api/pms/guests?${qs}`);
      const data = res.ok ? await res.json() : { guests: [] };
      if (seq !== lookupSeq.current) return;
      const items = data.guests || [];
      // An asked-for search highlights the first match, so Enter takes it;
      // suggestions while typing highlight nothing, so Enter never picks
      // someone the desk did not choose.
      setSuggest({ field, items, active: asked && items.length ? 0 : -1, term });
      if (asked) setSearchStatus(items.length ? null : "none");
    } catch {
      // No suggestions is the same as no match: the desk keeps typing.
      if (seq === lookupSeq.current && asked) setSearchStatus("none");
    }
  }

  function lookUpGuest(field, value) {
    const term = String(value || "").trim();
    const digits = term.replace(/\D/g, "");
    const enough =
      field === "guest_phone"
        ? digits.length >= 4
        : field === "guest_email"
        ? term.length >= 3
        : term.length >= 2;
    const seq = lookupSeq.current + 1;
    lookupSeq.current = seq;
    setSearchStatus(null);
    if (linked || !enough) {
      setSuggest({ field: null, items: [], active: -1 });
      return;
    }
    // Waits for a pause in typing; a newer keystroke supersedes this one.
    setTimeout(() => {
      if (seq !== lookupSeq.current) return;
      runGuestSearch(field, field === "guest_phone" ? digits : term, seq);
    }, 250);
  }

  /**
   * The Search button (and Enter in the name box): look now, by whatever
   * the desk has typed -- the name, else the phone, else the email -- and
   * always say what was found, even when it is nothing.
   */
  function searchGuestsNow() {
    const name = form.guest_name.trim();
    const phone = form.guest_phone.replace(/\D/g, "");
    const email = form.guest_email.trim();
    const term = name || phone || email;
    if (!term) return;
    const seq = lookupSeq.current + 1;
    lookupSeq.current = seq;
    setSuggest({ field: "guest_name", items: [], active: -1, term });
    setSearchStatus("searching");
    runGuestSearch("guest_name", term, seq, { asked: true });
  }

  function pickGuest(g) {
    lookupSeq.current += 1;
    setSearchStatus(null);
    setSuggest({ field: null, items: [], active: -1 });
    setLinked(g);
    setForm((prev) => ({
      ...prev,
      guest_id: g.id,
      guest_name: g.full_name || prev.guest_name,
      guest_phone: g.phone || prev.guest_phone,
      guest_email: g.email || prev.guest_email,
      guest_country: g.country || prev.guest_country,
      guest_residency: g.residency || prev.guest_residency,
    }));
  }

  /** Wrong person picked: start the guest afresh rather than keep their details. */
  function unlinkGuest() {
    setLinked(null);
    setForm((prev) => ({
      ...prev,
      guest_id: null,
      guest_name: "",
      guest_phone: "",
      guest_email: "",
    }));
  }

  function suggestKeys(e) {
    const { items, active } = suggest;
    if (e.key === "Escape") {
      setSearchStatus(null);
      setSuggest({ field: null, items: [], active: -1 });
      return;
    }
    // Enter in the name box with nothing highlighted searches, like the button.
    if (e.key === "Enter" && active < 0 && e.currentTarget.name === "guest_name" && !linked) {
      e.preventDefault();
      searchGuestsNow();
      return;
    }
    if (!items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSuggest((s) => ({ ...s, active: (s.active + step + items.length) % items.length }));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pickGuest(items[active]);
    }
  }

  /** Props for a box that offers guests on record as the desk types. */
  function guestBox(field) {
    return {
      value: form[field],
      onChange: (e) => {
        set(field, e.target.value);
        lookUpGuest(field, e.target.value);
      },
      name: field,
      onKeyDown: suggestKeys,
      onBlur: () => {
        setSearchStatus(null);
        setSuggest({ field: null, items: [], active: -1 });
      },
      autoComplete: "off",
    };
  }

  // More details starts open only when something in it is already filled
  // in beyond the usual -- an emailed guest, a note, a comp or an inquiry
  // started from the calendar -- so nothing set is ever hidden.
  const [more, setMore] = useState(
    () =>
      Boolean(form.notes) ||
      Number(form.children) > 0 ||
      form.booking_type !== "standard" ||
      form.status === "inquiry" ||
      form.guest_residency !== "domestic"
  );

  /**
   * The quoted price, and whether the desk has taken it over.
   *
   * An existing booking opens as manual: whatever it was sold for is what it
   * is owed, and re-pricing it behind the receptionist's back would quietly
   * rewrite a negotiated rate on an unrelated edit. A new booking starts
   * quoted and stays quoted until someone types in the box.
   */
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [manualTotal, setManualTotal] = useState(Boolean(reservation));

  // A date that is full is refused once; the second attempt carries the
  // override, so overbooking is always a deliberate second action.
  const [conflict, setConflict] = useState(null);

  const dayUse = form.stay_kind === "day_use";
  const nights = dayUse ? 0 : nightsBetween(form.check_in, form.check_out);

  const sourceOptions = BOOKING_SOURCES.some((o) => o.value === form.source)
    ? BOOKING_SOURCES
    : [...BOOKING_SOURCES, { value: form.source, label: form.source }];

  // A complimentary stay is owed nothing, so there is no price to quote or
  // type: the total is pinned at zero for as long as it stays complimentary.
  const complimentary = form.booking_type === "complimentary";

  /**
   * Which plans are sold on which room types. Fetched here rather than passed
   * in because every caller already loads the plans, and only this form needs
   * the pairing.
   */
  const [assignments, setAssignments] = useState(null);

  /**
   * Companies and travel agents. The field only appears once there is at
   * least one, so a hotel that never uses them never sees it. Inactive ones
   * are not offered, except the one an existing booking is already on.
   */
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    const qs = session?.propertyId ? `?propertyId=${session.propertyId}` : "";
    fetch(`/api/pms/companies${qs}`)
      .then((r) => (r.ok ? r.json() : { companies: [] }))
      .then((d) => setCompanies(d.companies || []))
      .catch(() => setCompanies([]));
  }, [session?.propertyId]);

  const company = companies.find((c) => c.id === form.company_id) || null;
  const companyChoices = companies.filter((c) => c.is_active || c.id === form.company_id);

  /**
   * The agent's commission on this booking: what was agreed when it was
   * booked if it is still with that agent, else the agent's current terms.
   */
  const commissionPercent =
    company?.kind !== "travel_agent"
      ? null
      : reservation?.company_id === company.id && reservation?.commission_percent != null
      ? Number(reservation.commission_percent)
      : company.commission_percent != null
      ? Number(company.commission_percent)
      : null;

  useEffect(() => {
    const qs = session?.propertyId ? `?propertyId=${session.propertyId}` : "";
    fetch(`/api/setup/ratePlanRooms${qs}`)
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => setAssignments(d.assignments || []))
      .catch(() => setAssignments([]));
  }, [session?.propertyId]);

  /**
   * The plans this room type is sold under, of the kind of stay being booked:
   * day-use plans for a day use, night plans otherwise. Every plan of that
   * kind until a type is chosen.
   */
  const plansForType = useMemo(() => {
    const all =
      !form.room_type_id || !assignments
        ? ratePlans
        : plansForRoom(ratePlans, form.room_type_id, assignments);
    return all.filter((p) => isDayUsePlan(p) === dayUse);
  }, [ratePlans, form.room_type_id, assignments, dayUse]);

  /**
   * A new booking starts on the plan the room is normally sold under -- the
   * master plan if the type has one, else its first plan -- so the quote is
   * the channel rate without the desk having to pick it. Changing room type
   * moves the plan along only if the desk has not chosen one themselves, or
   * if theirs is not sold on the new type. An existing booking keeps the plan
   * it was sold on.
   */
  const planChosen = useRef(Boolean(prefill?.rate_plan_id));

  useEffect(() => {
    if (reservation || !assignments) return;
    const sold = plansForType.some((p) => p.id === form.rate_plan_id);
    if (planChosen.current && (sold || !form.rate_plan_id)) return;

    const pick = plansForType.find((p) => p.is_master) || plansForType[0];
    const next = pick?.id || "";
    if (next !== form.rate_plan_id) {
      planChosen.current = false;
      setForm((prev) => ({
        ...prev,
        rate_plan_id: next,
        ...(pick && isDayUsePlan(pick) ? { day_use_hours: Number(pick.day_use_hours) } : {}),
      }));
    }
  }, [reservation, assignments, plansForType, form.rate_plan_id]);

  // A booking already on a plan this type no longer sells still shows it --
  // so long as it sells the kind of stay being booked.
  const planOptions =
    form.rate_plan_id && !plansForType.some((p) => p.id === form.rate_plan_id)
      ? [
          ...plansForType,
          ...ratePlans.filter((p) => p.id === form.rate_plan_id && isDayUsePlan(p) === dayUse),
        ]
      : plansForType;

  /**
   * The other day uses already in the chosen room on the chosen date, so the
   * time picker can grey out their slots and suggest the first free one.
   */
  const [roomDayUses, setRoomDayUses] = useState([]);
  useEffect(() => {
    if (!dayUse || !form.room_id || !form.check_in) {
      setRoomDayUses([]);
      return;
    }
    let live = true;
    const qs = new URLSearchParams({ arrivingOn: form.check_in });
    if (session?.propertyId) qs.set("propertyId", session.propertyId);
    fetch(`/api/pms/reservations?${qs}`)
      .then((r) => (r.ok ? r.json() : { reservations: [] }))
      .then((d) => {
        if (!live) return;
        setRoomDayUses(
          (d.reservations || []).filter(
            (r) =>
              r.id !== reservation?.id &&
              r.room_id === form.room_id &&
              r.stay_kind === "day_use" &&
              DAY_USE_HOLDING_STATUSES.includes(r.status) &&
              dayUseWindow(r)
          )
        );
      })
      .catch(() => live && setRoomDayUses([]));
    return () => {
      live = false;
    };
  }, [dayUse, form.room_id, form.check_in, session?.propertyId, reservation?.id]);

  const slotLength = (Number(form.day_use_hours) || 0) * 60;
  const takenSlots = useMemo(() => roomDayUses.map(dayUseWindow), [roomDayUses]);
  const startOptions = useMemo(
    () => (slotLength ? dayUseStartOptions(form.day_use_hours) : []),
    [slotLength, form.day_use_hours]
  );
  /** Who already has the room at a start time, or null when it is free. */
  function slotTakenBy(start) {
    if (!slotLength) return null;
    return (
      roomDayUses.find((r) =>
        windowsOverlap(dayUseWindow(r), { start, end: start + slotLength })
      ) || null
    );
  }
  const chosenStart = parseClock(form.day_use_start);
  const startClash = chosenStart != null ? slotTakenBy(chosenStart) : null;

  /**
   * A day use without a time, or whose time no longer fits (a longer plan,
   * another guest in the new room), gets the first free start: from the next
   * half hour today, from 10 AM on a later date. A start the desk picked that
   * still fits is left alone.
   */
  useEffect(() => {
    if (!dayUse || !slotLength) return;
    const fits =
      chosenStart != null &&
      chosenStart + slotLength <= 24 * 60 &&
      !takenSlots.some((w) => windowsOverlap(w, { start: chosenStart, end: chosenStart + slotLength }));
    if (fits) return;
    // An existing booking keeps its time even if it clashes -- the warning
    // under the picker says so, and the desk decides.
    if (reservation && chosenStart != null) return;
    const pick = suggestDayUseStart(form.day_use_hours, {
      taken: takenSlots,
      isToday: form.check_in === localToday(),
    });
    if (pick != null && toClock(pick) !== form.day_use_start) {
      setForm((prev) => ({ ...prev, day_use_start: toClock(pick) }));
    }
  }, [dayUse, slotLength, chosenStart, takenSlots, form.day_use_hours, form.check_in, form.day_use_start, reservation]);

  /** Only rooms of the chosen type can hold this booking. */
  const roomsForType = useMemo(
    () => rooms.filter((r) => r.room_type_id === form.room_type_id && r.is_active),
    [rooms, form.room_type_id]
  );

  /**
   * Ask the server what the configured rates make this stay cost.
   *
   * Everything the price depends on is in the dependency list, so changing
   * dates, plan, room type or occupancy re-quotes. Requests are superseded
   * rather than queued -- the desk types faster than the network answers, and
   * a late reply must not overwrite a newer one.
   */
  const quoteSeq = useRef(0);

  const fetchQuote = useCallback(async () => {
    const { room_type_id, rate_plan_id, check_in, check_out, adults, children } = form;

    const priceable = dayUse ? Boolean(rate_plan_id) : Boolean(check_out) && nights > 0;
    if (!room_type_id || !check_in || !priceable) {
      setQuote(null);
      return;
    }

    const seq = quoteSeq.current + 1;
    quoteSeq.current = seq;
    setQuoting(true);

    try {
      const qs = new URLSearchParams({
        roomTypeId: room_type_id,
        checkIn: check_in,
        checkOut: check_out,
        adults: String(adults ?? 2),
        children: String(children ?? 0),
      });
      if (session?.propertyId) qs.set("propertyId", session.propertyId);
      if (rate_plan_id) qs.set("ratePlanId", rate_plan_id);
      if (form.company_id) qs.set("companyId", form.company_id);
      if (dayUse) qs.set("stayKind", "day_use");

      const res = await fetch(`/api/pms/quote?${qs}`);
      const data = await res.json();

      // A reply for a stay the desk has already moved on from is dropped.
      if (seq !== quoteSeq.current) return;
      setQuote(res.ok ? data : null);
    } catch {
      if (seq === quoteSeq.current) setQuote(null);
    } finally {
      if (seq === quoteSeq.current) setQuoting(false);
    }
  }, [
    form.room_type_id,
    form.rate_plan_id,
    form.check_in,
    form.check_out,
    form.adults,
    form.children,
    form.company_id,
    nights,
    dayUse,
    session?.propertyId,
  ]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  /**
   * Put the quote in the box, unless the desk has priced this stay itself.
   *
   * Separate from fetching so that "re-quote" can reuse it, and so a manual
   * total survives every later edit until it is explicitly given up.
   */
  useEffect(() => {
    if (manualTotal || complimentary) return;
    if (quote?.total == null) return;
    setForm((prev) =>
      String(prev.total_amount) === String(quote.total)
        ? prev
        : { ...prev, total_amount: quote.total }
    );
  }, [quote, manualTotal, complimentary]);

  function useQuotedPrice() {
    setManualTotal(false);
    if (quote?.total != null) {
      setForm((prev) => ({ ...prev, total_amount: quote.total }));
    }
  }

  // The property list can arrive after a new booking has already opened, so
  // the home country is filled in when it becomes known -- but never over a
  // country the desk has already picked.
  useEffect(() => {
    if (reservation || !homeCountry) return;
    setForm((prev) => (prev.guest_country ? prev : { ...prev, guest_country: homeCountry }));
  }, [reservation, homeCountry]);

  function set(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };

      // Moving check-in past check-out would leave an impossible stay on
      // screen, so the departure follows it out by the nights already booked.
      if (field === "check_in" && next.check_out <= value) {
        const span = Math.max(1, nightsBetween(prev.check_in, prev.check_out));
        next.check_out = formatDateISO(addDays(parseDateISO(value), span));
      }

      // Picking a country suggests the tax residency to match. Only a
      // suggestion: the desk can still set it by hand afterwards, since a
      // citizen living abroad can be either.
      if (field === "guest_country" && value && homeCountry) {
        next.guest_residency = value === homeCountry ? "domestic" : "international";
      }

      // A day-use plan carries its hours; leaving day use needs a night again.
      if (field === "rate_plan_id") {
        const plan = ratePlans.find((p) => p.id === value);
        if (isDayUsePlan(plan)) next.day_use_hours = Number(plan.day_use_hours);
      }
      // Switching between a night and a day use switches plan too: a plan
      // sells one or the other.
      if (field === "stay_kind") {
        const wantDayUse = value === "day_use";
        const current = ratePlans.find((p) => p.id === prev.rate_plan_id);
        if (!current || isDayUsePlan(current) !== wantDayUse) {
          const sold = (
            prev.room_type_id && assignments
              ? plansForRoom(ratePlans, prev.room_type_id, assignments)
              : ratePlans
          ).filter((p) => isDayUsePlan(p) === wantDayUse);
          const pick = sold.find((p) => p.is_master) || sold[0];
          next.rate_plan_id = pick?.id || "";
          if (pick && wantDayUse) next.day_use_hours = Number(pick.day_use_hours);
        }
      }
      if (field === "stay_kind" && value === "overnight" && next.check_out <= next.check_in) {
        next.check_out = formatDateISO(addDays(parseDateISO(next.check_in), 1));
      }

      // A room of the old type cannot stay selected against a new one.
      if (field === "room_type_id") next.room_id = "";

      if (field === "booking_type" && value === "complimentary") next.total_amount = 0;

      // Choosing a company or agent suggests how it was booked and who is
      // billed -- a company is usually invoiced, an agent's guest usually
      // pays the hotel -- but only over the defaults, never over a choice.
      if (field === "company_id") {
        const c = companies.find((x) => x.id === value);
        if (!c) {
          next.bill_to = "guest";
        } else {
          next.bill_to = c.kind === "company" ? "company" : "guest";
          if (["direct", "corporate", "travel_agent"].includes(prev.source)) {
            next.source = c.kind === "company" ? "corporate" : "travel_agent";
          }
        }
      }

      return next;
    });
    // Leaving complimentary goes back to the quoted price, not to zero typed
    // by hand -- the zero was never the desk's figure.
    if (field === "booking_type" && value !== "complimentary") setManualTotal(false);
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
        // The quote's night-by-night prices, sent only while the total is
        // the quoted one -- a typed total has no breakdown to go with it.
        night_rates:
          !manualTotal && !complimentary && !dayUse && quote?.nights ? quote.nights : undefined,
        ...(dayUse
          ? {
              check_out: form.check_in,
              day_use_hours: Number(form.day_use_hours),
              day_use_start: form.day_use_start || null,
            }
          : {}),
        ...(reservation ? { id: reservation.id } : {}),
      };

      const res = await fetch("/api/pms/reservations", {
        method: reservation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // A session that expired while the form was open sends the desk to sign
      // in and back, rather than failing a booking they have already typed.
      if (handleExpiredSession(res)) return;

      // A response that is not JSON means something answered in front of the
      // route -- a proxy, an error page. Reading it as JSON throws a parser
      // message that tells the desk nothing, so the status is reported instead.
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `The server did not answer properly (${res.status}). Try again.`
        );
      }

      if (res.status === 409 && data.availability) {
        setConflict(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not save the booking");

      onSaved(
        reservation
          ? `Booking ${data.reservation.reference} updated.`
          : `Booking ${data.reservation.reference} created for ${data.reservation.guest_name}.`,
        inventoryWarning(data)
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`booking-form ${embedded ? "space-y-5" : "card card-pad space-y-5"}`}>
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
          This property has no room types yet — add one under Setup → Rooms before
          taking bookings.
        </p>
      )}

      {/* What every booking needs, up front. The rest -- country,
          tax residency, children, how it was booked -- waits under More
          details, already filled with the usual answers. */}
      <Section title="Guest and stay">
        <Field label="Guest name" wide>
          <div style={{ position: "relative" }}>
            <div className="flex gap-2">
              <input
                className="input"
                style={{ flex: 1, minWidth: 0 }}
                ref={nameBox}
                {...guestBox("guest_name")}
                placeholder="Full name"
              />
              {!linked && (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  // mousedown, so the name box's blur does not close the
                  // results this click is about to open.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // Focus stays in the name box, so arrows, Enter, Escape
                    // and clicking away all work on the results.
                    nameBox.current?.focus();
                    searchGuestsNow();
                  }}
                  disabled={!form.guest_name.trim() && !form.guest_phone.trim() && !form.guest_email.trim()}
                  title="Find this guest among past bookings, by name, phone or email"
                >
                  Search
                </button>
              )}
            </div>
            {suggest.field === "guest_name" && (
              <GuestSuggestions
                items={suggest.items}
                active={suggest.active}
                onPick={pickGuest}
                status={searchStatus}
                term={suggest.term}
              />
            )}
          </div>
          {linked && <LinkedGuest guest={linked} onUnlink={unlinkGuest} propertyId={session?.propertyId} />}
        </Field>
        <Field label="Phone">
          <div style={{ position: "relative" }}>
            <input className="input" type="tel" {...guestBox("guest_phone")} />
            {suggest.field === "guest_phone" && (
              <GuestSuggestions items={suggest.items} active={suggest.active} onPick={pickGuest} />
            )}
          </div>
        </Field>
        <Field label="Email">
          <div style={{ position: "relative" }}>
            <input className="input" type="email" {...guestBox("guest_email")} />
            {suggest.field === "guest_email" && (
              <GuestSuggestions items={suggest.items} active={suggest.active} onPick={pickGuest} />
            )}
          </div>
        </Field>
        <Field label="Stay">
          <select
            className="input"
            value={form.stay_kind}
            onChange={(e) => set("stay_kind", e.target.value)}
          >
            <option value="overnight">Overnight</option>
            <option value="day_use">Day use (hours)</option>
          </select>
        </Field>
        <Field label={dayUse ? "Date" : "Check in"}>
          <input
            className="input"
            type="date"
            value={form.check_in}
            onChange={(e) => set("check_in", e.target.value)}
          />
        </Field>
        {dayUse ? (
          <>
          <Field
            label="Day-use plan"
            hint={
              planOptions.length
                ? dayUseLabel(form.day_use_hours)
                : "No day-use plan on this room type — add one in Rate Plans"
            }
          >
            <select
              className="input"
              value={form.rate_plan_id}
              onChange={(e) => {
                planChosen.current = true;
                set("rate_plan_id", e.target.value);
              }}
            >
              {!planOptions.length && (
                <option value="">{form.day_use_hours ? dayUseLabel(form.day_use_hours) : "None"}</option>
              )}
              {planOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.plan_name} · {dayUseLabel(p.day_use_hours)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Start time"
            hint={
              startClash
                ? `Clashes with ${startClash.guest_name} (${dayUseWindowLabel(startClash)})`
                : chosenStart != null && slotLength
                  ? `Until ${formatMinutes(chosenStart + slotLength)}${
                      roomDayUses.length ? ` · ${roomDayUses.length} other day use${roomDayUses.length === 1 ? "" : "s"} in this room` : ""
                    }`
                  : form.room_id
                    ? "No free time left in this room"
                    : "Pick a room to see its free times"
            }
          >
            <select
              className="input"
              value={form.day_use_start}
              onChange={(e) => set("day_use_start", e.target.value)}
              disabled={!slotLength}
            >
              {!form.day_use_start && <option value="">Choose…</option>}
              {/* A stored time off the half-hour grid still shows. */}
              {chosenStart != null && !startOptions.includes(chosenStart) && (
                <option value={form.day_use_start}>{formatMinutes(chosenStart)}</option>
              )}
              {startOptions.map((t) => {
                const taken = slotTakenBy(t);
                return (
                  <option key={t} value={toClock(t)} disabled={Boolean(taken)}>
                    {formatMinutes(t)} – {formatMinutes(t + slotLength)}
                    {taken ? ` · ${taken.guest_name}` : ""}
                  </option>
                );
              })}
            </select>
          </Field>
          </>
        ) : (
          <Field
            label="Check out"
            hint={nights ? `${nights} night${nights === 1 ? "" : "s"}` : "Pick a later date"}
          >
            <input
              className="input"
              type="date"
              value={form.check_out}
              min={form.check_in}
              onChange={(e) => set("check_out", e.target.value)}
            />
          </Field>
        )}
        <Field label="Adults">
          <input
            className="input"
            type="number"
            min="1"
            value={form.adults}
            onChange={(e) => set("adults", e.target.value)}
          />
        </Field>
        <Field label="Room type">
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
        </Field>
        <Field label="Room">
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
        </Field>
        {companyChoices.length > 0 && (
          <Field label="Company / agent" wide={!company}>
            <select
              className="input"
              value={form.company_id}
              onChange={(e) => set("company_id", e.target.value)}
            >
              <option value="">None — guest booked direct</option>
              {[
                ["company", "Companies"],
                ["travel_agent", "Travel agents"],
              ].map(([kind, label]) => {
                const group = companyChoices.filter((c) => c.kind === kind);
                return group.length ? (
                  <optgroup key={kind} label={label}>
                    {group.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.rate_lines ? " · contract" : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </Field>
        )}
        {company && (
          <Field
            label="Bill to"
            hint={
              form.bill_to === "company"
                ? company.gstin
                  ? `Invoice to ${company.name}, GSTIN ${company.gstin}`
                  : `${company.name} has no GSTIN on record`
                : undefined
            }
          >
            <select
              className="input"
              value={form.bill_to}
              onChange={(e) => set("bill_to", e.target.value)}
            >
              <option value="guest">Guest</option>
              <option value="company">{company.kind === "company" ? "Company" : "Agent"}</option>
            </select>
          </Field>
        )}
      </Section>

      <Section title="Price">
        {!dayUse && (
          <Field label="Rate plan" wide>
            <select
              className="input"
              value={form.rate_plan_id}
              onChange={(e) => {
                planChosen.current = true;
                set("rate_plan_id", e.target.value);
              }}
            >
              <option value="">None</option>
              {planOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.plan_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={dayUse ? "Total amount (day use)" : "Total amount (whole stay)"} wide>
          <input
            className="input"
            type="number"
            min="0"
            value={complimentary ? 0 : form.total_amount}
            disabled={complimentary}
            onChange={(e) => {
              setManualTotal(true);
              set("total_amount", e.target.value);
            }}
            placeholder={quoting ? "Pricing…" : "Whole stay"}
          />
          {complimentary ? (
            <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
              Complimentary — no room charge. Extras added later are still billed.
            </p>
          ) : (
            <PriceNote
              quote={quote}
              quoting={quoting}
              manual={manualTotal}
              nights={nights}
              onUseQuoted={useQuotedPrice}
            />
          )}
          {commissionPercent != null && Number(form.total_amount) > 0 && (
            <p className="sub" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
              {company.name} commission {commissionPercent}% ={" "}
              {Math.round((Number(form.total_amount) * commissionPercent) / 100).toLocaleString("en-IN")}
            </p>
          )}
        </Field>
      </Section>

      <button
        type="button"
        className="btn btn-ghost text-sm"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
      >
        {more ? "▾" : "▸"} More details
        {!more && (
          <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
            country, children, booking method{reservation ? "" : ", inquiry"}, notes
          </span>
        )}
      </button>

      {more && (
        <Section title="More details">
          <Field label="Country">
            <select
              className="input"
              value={form.guest_country}
              onChange={(e) => set("guest_country", e.target.value)}
            >
              <option value="">Not recorded</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {/* Decides which taxes apply -- some levies are for foreign
              guests only, and some exemptions are too. */}
          <Field label="Guest is">
            <select
              className="input"
              value={form.guest_residency}
              onChange={(e) => set("guest_residency", e.target.value)}
            >
              <option value="domestic">Domestic</option>
              <option value="international">International</option>
            </select>
          </Field>
          <Field label="Children">
            <input
              className="input"
              type="number"
              min="0"
              value={form.children}
              onChange={(e) => set("children", e.target.value)}
            />
          </Field>
          <Field label="Booking method">
            <select
              className="input"
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
            >
              {sourceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {/* Complimentary stays occupy a room like any other but are owed
              nothing; revenue reports leave them out of ADR. */}
          <Field label="Booking type">
            <select
              className="input"
              value={form.booking_type}
              onChange={(e) => set("booking_type", e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="complimentary">Complimentary</option>
            </select>
          </Field>
          {/* An inquiry holds the room like a confirmed booking, but is left
              out of revenue until it is confirmed. */}
          {!reservation && (
            <Field label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                <option value="confirmed">Confirmed</option>
                <option value="inquiry">Inquiry</option>
              </select>
            </Field>
          )}
        <Field label="Notes" wide>
          <textarea
            className="input"
            rows={2}
            style={{ resize: "vertical" }}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Late arrival, dietary needs, anything the desk should know"
          />
        </Field>
        </Section>
      )}

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
