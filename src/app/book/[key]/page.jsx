"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DateField from "@/app/components/DateField";
import Select from "@/app/components/Select";
import { HotelHeader, Field, addDaysIso, ask, day, lastBookingKey, money, nightsOf, plural, useFrameHeight } from "../kit";

/**
 * The hotel's booking page, on its own website or opened from a link: pick
 * dates and guests, see the free rooms with their prices, pick one, give a
 * name and mobile number, book. Payment comes after, on the booking's own
 * page, so a guest whose UPI app fails still has their room.
 *
 * Rooms are searched as soon as the page opens, for tonight, so the guest
 * sees prices before touching anything. Three steps on one page, each
 * folding away once done: the dates stay in view at the top so they can be
 * changed at any point.
 */

const ADULTS = Array.from({ length: 8 }, (_, i) => i + 1);
const CHILDREN = Array.from({ length: 6 }, (_, i) => i);

export default function BookingPage() {
  const { key } = useParams();
  const router = useRouter();
  useFrameHeight();

  const [hotel, setHotel] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [stay, setStay] = useState(null);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [picked, setPicked] = useState(null);
  const [hasLast, setHasLast] = useState(false);
  const [moved, setMoved] = useState(false);
  // What the guest typed, kept here so it survives a new search: a room that
  // sold while they typed, or dates changed, must not cost them their details.
  const [guest, setGuest] = useState({ name: "", phone: "", email: "", requests: "", website: "" });
  const searchSeq = useRef(0);

  const search = useCallback(
    async (s, { keepError = false, findFree = 0 } = {}) => {
      const seq = ++searchSeq.current;
      setSearching(true);
      if (!keepError) setSearchError("");
      setPicked(null);
      try {
        const qs = new URLSearchParams({
          key,
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          adults: String(s.adults),
          children: String(s.children),
        });
        if (s.code) qs.set("code", s.code);
        const json = await ask(`/api/book/search?${qs}`);
        // On opening, a full tonight is not the first thing a guest reads:
        // the next few nights are tried, and the dates move to the first free one.
        if (findFree > 0 && json.offers.length === 0 && seq === searchSeq.current) {
          const next = { ...s, checkIn: addDaysIso(s.checkIn, 1), checkOut: addDaysIso(s.checkOut, 1) };
          setStay(next);
          setMoved(true);
          setSearching(false);
          return search(next, { findFree: findFree - 1 });
        }
        if (seq === searchSeq.current) setResults({ ...json, stay: s });
      } catch (err) {
        if (seq === searchSeq.current) {
          setResults(null);
          setSearchError(err.message);
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [key]
  );

  useEffect(() => {
    try {
      setHasLast(Boolean(localStorage.getItem(lastBookingKey(key))));
    } catch {}
    ask(`/api/book?key=${encodeURIComponent(key)}`)
      .then((json) => {
        setHotel(json);
        const first = { checkIn: json.today, checkOut: addDaysIso(json.today, 1), adults: 2, children: 0, code: "" };
        setStay(first);
        search(first, { findFree: 6 });
      })
      .catch((err) => setLoadError(err.message));
  }, [key, search]);

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="card card-pad text-center">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
        </div>
      </main>
    );
  }
  if (!hotel || !stay) return <p className="sub py-10 text-center">Opening the booking page...</p>;

  const change = (patch) => {
    setMoved(false);
    const next = { ...stay, ...patch };
    // Moving check-in past check-out keeps the same length of stay.
    if (patch.checkIn && next.checkOut <= next.checkIn) {
      next.checkOut = addDaysIso(next.checkIn, Math.max(1, nightsOf(stay.checkIn, stay.checkOut)));
    }
    setStay(next);
    if (next.checkIn && next.checkOut && next.checkOut > next.checkIn) search(next);
    else {
      setResults(null);
      setSearchError("Check-out must be after check-in.");
    }
  };

  const shown = results?.stay;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <HotelHeader
        name={hotel.name}
        logoUrl={hotel.logoUrl}
        sub="Book your stay"
        right={
          <a
            className="btn btn-ghost text-sm"
            href={`/book/${key}/my`}
            title={hasLast ? "See the booking you made on this phone" : "Sign in with your booking number"}
          >
            My booking
          </a>
        }
      />

      {hotel.note && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {hotel.note}
        </p>
      )}

      <section className="card card-pad grid grid-cols-6 gap-3 sm:grid-cols-4">
        <Field label="Check-in" className="col-span-3 sm:col-span-1">
          <DateField
            className="input w-full"
            value={stay.checkIn}
            min={hotel.today}
            max={hotel.lastDate}
            onChange={(e) => e.target.value && change({ checkIn: e.target.value })}
            aria-label="Check-in"
          />
        </Field>
        <Field label="Check-out" className="col-span-3 sm:col-span-1">
          <DateField
            className="input w-full"
            value={stay.checkOut}
            min={addDaysIso(stay.checkIn, 1)}
            max={addDaysIso(stay.checkIn, hotel.maxNights)}
            onChange={(e) => e.target.value && change({ checkOut: e.target.value })}
            aria-label="Check-out"
          />
        </Field>
        <Field label="Adults" className="col-span-2 sm:col-span-1">
          <Select className="input w-full" value={String(stay.adults)} onChange={(e) => change({ adults: Number(e.target.value) })}>
            {ADULTS.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Children" className="col-span-2 sm:col-span-1">
          <Select className="input w-full" value={String(stay.children)} onChange={(e) => change({ children: Number(e.target.value) })}>
            {CHILDREN.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        {hotel.hasCodes ? (
          <PromoCode code={stay.code} outcome={results?.stay?.code === stay.code ? results?.code : null} onApply={(code) => change({ code })} />
        ) : (
          <span className="col-span-2 sm:hidden" />
        )}
      </section>

      {searching && <p className="sub text-center">Finding rooms...</p>}
      {searchError && !searching && (
        <p className="text-center text-sm" style={{ color: "var(--danger)" }}>
          {searchError}
        </p>
      )}

      {!searching && results && shown && !picked && (
        <>
          {moved && (
            <p className="text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Tonight is full. These are the next nights with rooms free.
            </p>
          )}
          <Results results={results} stay={shown} currency={hotel.currency} onPick={setPicked} />
        </>
      )}

      {picked && shown && (
        <GuestDetails
          hotel={hotel}
          stay={shown}
          picked={picked}
          bookingKey={key}
          form={guest}
          setForm={setGuest}
          onBack={() => setPicked(null)}
          onGone={(message) => {
            setSearchError(message);
            search(shown, { keepError: true });
          }}
          onBooked={(token) => {
            try {
              localStorage.setItem(lastBookingKey(key), token);
            } catch {}
            router.push(`/book/${key}/b/${token}?new=1`);
          }}
        />
      )}
    </main>
  );
}

/**
 * The promo code box: folded to a button until the guest has a code, and
 * applied on Apply or Enter, not on every letter, so prices do not jump.
 * Says whether the code worked, and Remove takes it off again.
 */
const CODE_TEXT = {
  applied: { tone: "var(--accent-text)", say: (c) => `Code ${c} applied.` },
  unused: { tone: "var(--warn)", say: (c) => `Code ${c} is not for these dates or rooms.` },
  unknown: { tone: "var(--warn)", say: (c) => `Code ${c} does not match an offer.` },
};

function PromoCode({ code, outcome, onApply }) {
  const [open, setOpen] = useState(Boolean(code));
  const [typed, setTyped] = useState(code || "");
  if (!open) {
    return (
      <div className="col-span-2 flex items-end sm:col-span-4">
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setOpen(true)}>
          Promo code
        </button>
      </div>
    );
  }
  const apply = () => onApply(typed.trim().toUpperCase());
  const said = code && outcome ? CODE_TEXT[outcome] : null;
  return (
    <div className="col-span-6 space-y-1 sm:col-span-4">
      <div className="flex items-end gap-2">
        <Field label="Promo code">
          <input
            className="input w-full"
            style={{ textTransform: "uppercase", maxWidth: "14rem" }}
            value={typed}
            maxLength={20}
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
            autoFocus={!code}
          />
        </Field>
        <button type="button" className="btn btn-secondary" onClick={apply}>
          Apply
        </button>
        {code && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTyped("");
              onApply("");
            }}
          >
            Remove
          </button>
        )}
      </div>
      {said && (
        <p className="text-xs" style={{ color: said.tone }}>
          {said.say(code)}
        </p>
      )}
    </div>
  );
}

/** A room's photos, side by side, swiped on a phone. The first is the cover. */
function Photos({ photos, name }) {
  if (!photos?.length) return null;
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "thin" }}>
      {photos.map((url, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={`${name}, photo ${i + 1}`}
          loading={i === 0 ? "eager" : "lazy"}
          className="aspect-video snap-start rounded sm:aspect-[4/3]"
          style={{
            flex: photos.length === 1 ? "1 0 100%" : "0 0 85%",
            maxWidth: photos.length === 1 ? "100%" : 420,
            objectFit: "cover",
            border: "1px solid var(--border)",
          }}
        />
      ))}
    </div>
  );
}

/** The price, with the full price struck through and what was saved when there is a discount. */
function Price({ option, currency, nights, big }) {
  return (
    <>
      <div className={`${big ? "text-lg" : "text-base"} font-semibold`} style={{ color: "var(--text)" }}>
        {option.discount && (
          <s className="mr-1.5 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
            <span className="sr-only">Was </span>
            {money(option.fullTotal, currency)}
          </s>
        )}
        {money(option.total, currency)}
      </div>
      {option.discount && (
        <div className="text-xs font-medium" style={{ color: "var(--accent-text)" }}>
          {option.discount.percent}% off, {option.discount.label}
        </div>
      )}
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {option.tax > 0 ? `incl. ${money(option.tax, currency)} taxes` : `for ${plural(nights, "night")}`}
      </div>
    </>
  );
}

function Results({ results, stay, currency, onPick }) {
  const nights = nightsOf(stay.checkIn, stay.checkOut);
  if (results.offers.length === 0) {
    return (
      <div className="card card-pad text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {results.minStay
          ? `Please stay at least ${plural(results.minStay, "night")} for these dates.`
          : "No rooms are free for these dates and guests. Try other dates, or call the hotel."}
      </div>
    );
  }
  return (
    <section className="space-y-3">
      <p className="sub">
        {day(stay.checkIn)} to {day(stay.checkOut)}, {plural(nights, "night")}. Prices include taxes.
      </p>
      {results.offers.map((offer) => (
        <article key={offer.roomTypeId} className="card card-pad space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              {offer.name}
            </h2>
            <span className="text-xs" style={{ color: offer.fewLeft ? "var(--warn)" : "var(--text-muted)" }}>
              {offer.fewLeft ? `Only ${plural(offer.fewLeft, "room")} left` : `Up to ${plural(offer.maxAdults, "adult")}`}
            </span>
          </div>
          <Photos photos={offer.photos} name={offer.name} />
          {offer.description && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {offer.description}
            </p>
          )}
          {offer.amenities.length > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {offer.amenities.join(", ")}
            </p>
          )}
          <ul className="divide-y" style={{ borderTop: "1px solid var(--border)" }}>
            {offer.options.map((o) => (
              <li key={o.ratePlanId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {o.name}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {o.meals || "Room only"}
                  </div>
                  {o.cancellation && (
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {o.cancellation}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <Price option={o} currency={currency} nights={nights} />
                </div>
                <button type="button" className="btn btn-primary text-sm" onClick={() => onPick({ offer, option: o })}>
                  Book
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function GuestDetails({ hotel, stay, picked, bookingKey, form, setForm, onBack, onGone, onBooked }) {
  const [payBy, setPayBy] = useState(hotel.payUpi ? "upi" : "hotel");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: null }));
  };
  const { offer, option } = picked;
  const nights = nightsOf(stay.checkIn, stay.checkOut);

  async function book(e) {
    e.preventDefault();
    const gaps = {};
    if (form.name.trim().length < 2) gaps.name = "Enter your full name.";
    if (form.phone.replace(/\D/g, "").length < 10) gaps.phone = "Enter your mobile number.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) gaps.email = "That email does not look right.";
    setErrors(gaps);
    if (Object.keys(gaps).length) return;

    setBusy(true);
    setError("");
    try {
      const json = await ask("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: bookingKey,
          ...stay,
          roomTypeId: offer.roomTypeId,
          ratePlanId: option.ratePlanId,
          expectedTotal: option.total,
          payBy,
          website: form.website,
          guest: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim(),
            requests: form.requests.trim(),
          },
        }),
      });
      if (json.token) {
        onBooked(json.token);
        return;
      }
      setError("Your booking did not go through. Please call the hotel.");
      setBusy(false);
    } catch (err) {
      if (err.body?.gone) onGone(err.message);
      else setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={book} className="card card-pad space-y-3" noValidate>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            {offer.name}, {option.name}
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {day(stay.checkIn)} to {day(stay.checkOut)}, {plural(nights, "night")}, {plural(stay.adults, "adult")}
            {stay.children ? `, ${plural(stay.children, "child", "children")}` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-ghost text-sm" onClick={onBack} disabled={busy}>
          Change room
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required error={errors.name}>
          <input className="input w-full" autoComplete="name" value={form.name} onChange={set("name")} autoFocus />
        </Field>
        <Field label="Mobile number" required error={errors.phone}>
          <input className="input w-full" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="input w-full" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Requests">
          <input className="input w-full" value={form.requests} onChange={set("requests")} placeholder="Early check-in, extra bed..." />
        </Field>
      </div>
      {/* A box people never see, which only a bot fills in. */}
      <input
        type="text"
        name="website"
        value={form.website}
        onChange={set("website")}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      {hotel.payUpi && hotel.payAtHotel && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <legend className="label mb-1">How will you pay?</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="payBy" checked={payBy === "upi"} onChange={() => setPayBy("upi")} />
            Pay now by UPI
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="payBy" checked={payBy === "hotel"} onChange={() => setPayBy("hotel")} />
            Pay at the hotel
          </label>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="pt-2">
          <Price option={option} currency={hotel.currency} nights={nights} big />
          {option.cancellation && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {option.cancellation}
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary mt-2" disabled={busy}>
          {busy ? "Booking..." : payBy === "upi" ? "Book and pay" : "Book now"}
        </button>
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
