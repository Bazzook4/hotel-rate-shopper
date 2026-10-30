"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DateField from "@/app/components/DateField";
import Select from "@/app/components/Select";
import Icon from "@/app/components/Icon";
import { timeLabel } from "@/lib/bookingEngineShared";
import { offerForGuests } from "@/lib/promotions";
import { Gallery, HotelHeader, Field, addDaysIso, ask, day, lastBookingKey, money, nightsOf, plural, useFrameHeight } from "../kit";

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
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
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

      <Banner photos={hotel.banner} name={hotel.name} />
      <HotelFacts details={hotel.details} />

      {hotel.note && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {hotel.note}
        </p>
      )}

      <Offers offers={hotel.offers} currency={hotel.currency} />

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
          <Results
            results={results}
            stay={shown}
            currency={hotel.currency}
            onPick={setPicked}
            onLonger={(checkOut) => change({ checkOut })}
          />
        </>
      )}

      {!picked && <AboutHotel name={hotel.name} details={hotel.details} />}

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
 * The hotel's offers, before any dates are picked, so a guest can plan
 * around them: stay a night longer, book earlier. One line each.
 */
/** "30 Nov", short enough that an offer line fits a phone. */
const shortDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Offers({ offers, currency }) {
  const [all, setAll] = useState(false);
  if (!offers?.length) return null;
  // Two lines at most until asked, so the dates stay in view on a phone.
  const shown = all ? offers : offers.slice(0, 2);
  return (
    <section className="card card-pad space-y-1" aria-label="Offers">
      <ul className="space-y-1">
        {shown.map((o, i) => (
          <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            <span className="mt-0.5 flex-none" style={{ color: "var(--accent-text)" }}>
              <Icon name="tag" size={14} />
            </span>
            <span>
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {o.name}:
              </span>{" "}
              {offerForGuests(o, { money: (v) => money(v, currency), day: shortDay })}
            </span>
          </li>
        ))}
      </ul>
      {offers.length > 2 && (
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer offers" : `Show all ${offers.length} offers`}
        </button>
      )}
    </section>
  );
}

/**
 * The coupon code box: folded to a button until the guest has a code, and
 * applied on Apply or Enter, not on every letter, so prices do not jump.
 * Says whether the code worked, and Remove takes it off again.
 */
const CODE_TEXT = {
  applied: { tone: "var(--accent-text)", say: (c) => `Code ${c} applied.` },
  unused: { tone: "var(--warn)", say: (c) => `Code ${c} gives no saving on these dates or rooms.` },
  unknown: { tone: "var(--warn)", say: (c) => `Code ${c} does not match an offer.` },
  full: { tone: "var(--warn)", say: (c) => `Code ${c} has been used up.` },
};

function PromoCode({ code, outcome, onApply }) {
  const [open, setOpen] = useState(Boolean(code));
  const [typed, setTyped] = useState(code || "");
  if (!open) {
    return (
      <div className="col-span-2 flex items-end sm:col-span-4">
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setOpen(true)}>
          Coupon code
        </button>
      </div>
    );
  }
  const apply = () => onApply(typed.trim().toUpperCase());
  const said = code && outcome ? CODE_TEXT[outcome] : null;
  return (
    <div className="col-span-6 space-y-1 sm:col-span-4">
      <div className="flex items-end gap-2">
        <Field label="Coupon code">
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

/** Check-in and check-out times and where the hotel is, in one line under the banner. */
function HotelFacts({ details }) {
  if (!details) return null;
  const times = [
    details.checkIn && `Check-in from ${timeLabel(details.checkIn)}`,
    details.checkOut && `check-out by ${timeLabel(details.checkOut)}`,
  ].filter(Boolean);
  if (!times.length && !details.address) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: "var(--text-muted)" }}>
      {times.length > 0 && <span>{times.join(", ")}</span>}
      {details.address && <span className="min-w-0">{details.address}</span>}
      {details.mapUrl && (
        <a className="btn btn-ghost text-xs" href={details.mapUrl} target="_blank" rel="noreferrer">
          Directions
        </a>
      )}
    </div>
  );
}

/**
 * About the hotel, below the rooms: what it says about itself, its
 * amenities, house rules, and ways to reach it. Only what the hotel has
 * filled in is shown.
 */
function AboutHotel({ name, details }) {
  if (!details) return null;
  const { about, amenities = [], rules, phone, email, mapUrl } = details;
  if (!about && !amenities.length && !rules && !phone && !email) return null;
  const tel = phone ? phone.replace(/[^\d+]/g, "") : "";
  return (
    <section className="card card-pad space-y-3">
      <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
        About {name}
      </h2>
      {about && (
        <p className="whitespace-pre-line text-sm" style={{ color: "var(--text)" }}>
          {about}
        </p>
      )}
      {amenities.length > 0 && (
        <div className="space-y-1">
          <h3 className="label">Amenities</h3>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" style={{ color: "var(--text)" }}>
            {amenities.map((a) => (
              <li key={a} className="flex items-center gap-1.5">
                <Icon name="check" size={14} />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rules && (
        <div className="space-y-1">
          <h3 className="label">House rules</h3>
          <p className="whitespace-pre-line text-sm" style={{ color: "var(--text-muted)" }}>
            {rules}
          </p>
        </div>
      )}
      {(tel || email || mapUrl) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {tel && (
            <a className="btn btn-secondary text-sm" href={`tel:${tel}`}>
              Call {phone}
            </a>
          )}
          {email && (
            <a className="btn btn-secondary text-sm" href={`mailto:${email}`}>
              Email
            </a>
          )}
          {mapUrl && (
            <a className="btn btn-secondary text-sm" href={mapUrl} target="_blank" rel="noreferrer">
              Directions
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The hotel's banner across the top: one photo full width, or several to
 * swipe through. Wide on a computer, a little taller on a phone.
 */
function Banner({ photos, name }) {
  const [viewing, setViewing] = useState(null);
  if (!photos?.length) return null;
  return (
    <>
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setViewing(i)}
            className="relative snap-start overflow-hidden rounded-lg"
            style={{
              flex: photos.length === 1 ? "1 0 100%" : "0 0 92%",
              padding: 0,
              border: "1px solid var(--border)",
              cursor: "zoom-in",
            }}
            aria-label={`See photo ${i + 1} of ${name} larger`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={i === 0 ? name : `${name}, photo ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className="block aspect-[16/10] w-full sm:aspect-[5/2]"
              style={{ objectFit: "cover" }}
            />
            {i === 0 && photos.length > 1 && (
              <span
                className="absolute bottom-2 right-2 rounded px-2 py-1 text-xs font-medium"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
              >
                See all {photos.length} photos
              </span>
            )}
          </button>
        ))}
      </div>
      {viewing != null && <Gallery photos={photos} start={viewing} title={name} onClose={() => setViewing(null)} />}
    </>
  );
}

/**
 * A room's photos: the cover large, and the rest as small pictures under it
 * that swap in when tapped. Sits to the left of the room's plans on a wider
 * screen, and above them on a phone.
 */
function Photos({ photos, name }) {
  const [shown, setShown] = useState(0);
  const [viewing, setViewing] = useState(false);
  if (!photos?.length) return null;
  const current = photos[Math.min(shown, photos.length - 1)];
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setViewing(true)}
        className="relative block w-full overflow-hidden rounded"
        style={{ padding: 0, border: "1px solid var(--border)", cursor: "zoom-in" }}
        aria-label={`See ${name} photos larger`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current}
          alt={`${name}, photo ${shown + 1} of ${photos.length}`}
          className="block aspect-video w-full sm:aspect-[4/3]"
          style={{ objectFit: "cover" }}
        />
        <span
          className="absolute bottom-2 right-2 rounded px-2 py-1 text-xs font-medium"
          style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
        >
          {photos.length > 1 ? `See all ${photos.length} photos` : "See larger"}
        </span>
      </button>
      {viewing && <Gallery photos={photos} start={shown} title={name} onClose={() => setViewing(false)} />}
      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setShown(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={i === shown}
              className="shrink-0 rounded"
              style={{
                padding: 0,
                border: i === shown ? "2px solid var(--accent)" : "1px solid var(--border)",
                opacity: i === shown ? 1 : 0.75,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="block rounded" style={{ width: 56, height: 42, objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
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
          Save {money(option.discount.amount, currency)}, {option.discount.label}
        </div>
      )}
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {option.tax > 0 ? `incl. ${money(option.tax, currency)} taxes` : `for ${plural(nights, "night")}`}
      </div>
    </>
  );
}

function Results({ results, stay, currency, onPick, onLonger }) {
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
      <p className="sub" aria-live="polite">
        {day(stay.checkIn)} to {day(stay.checkOut)}, {plural(nights, "night")}. Prices include taxes.
      </p>
      {results.offers.map((offer) => (
        <article
          key={offer.roomTypeId}
          className={`card card-pad grid gap-4 ${offer.photos?.length ? "sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}`}
        >
          {offer.photos?.length > 0 && <Photos photos={offer.photos} name={offer.name} />}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                {offer.name}
              </h2>
              <span className="text-xs" style={{ color: offer.fewLeft ? "var(--warn)" : "var(--text-muted)" }}>
                {offer.fewLeft ? `Only ${plural(offer.fewLeft, "room")} left` : `Up to ${plural(offer.maxAdults, "adult")}`}
              </span>
            </div>
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
                    {(o.meals || "Room only").toLowerCase() !== o.name.toLowerCase() && (
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {o.meals || "Room only"}
                      </div>
                    )}
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
            <Longer options={offer.options} currency={currency} onLonger={onLonger} />
          </div>
        </article>
      ))}
    </section>
  );
}

/**
 * A stay a few nights short of a long-stay offer: the cheapest this room
 * would cost for the longer stay, and one click to search it. Only shown
 * when those nights are free and the offer applies to them.
 */
function Longer({ options, currency, onLonger }) {
  const longer = options
    .map((o) => o.longer)
    .filter(Boolean)
    .sort((a, b) => a.total - b.total)[0];
  if (!longer) return null;
  const some = options.some((o) => !o.longer);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs"
      style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
    >
      <span>
        <span className="font-medium">
          Stay {plural(longer.nights, "night")} and save {money(longer.save, currency)}
        </span>
        : {some ? "from " : ""}
        {money(longer.total, currency)} in all
      </span>
      <button type="button" className="btn btn-ghost text-sm" onClick={() => onLonger(longer.checkOut)}>
        Stay {longer.extraNights === 1 ? "1 more night" : `${longer.extraNights} more nights`}
      </button>
    </div>
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
