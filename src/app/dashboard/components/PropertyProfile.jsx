"use client";

import { useEffect, useMemo, useState } from "react";
import { countryOptions } from "@/lib/countries";
import { PROPERTY_TYPES, profileGaps } from "@/lib/eventTags";
import { citySuggestions, guessCountry, placesFor, stateOptions } from "@/lib/places";
import Select from "@/app/components/Select";
import { DEFAULT_DAY_START, browserZone, dayStartOptions, dayStartValue, zoneOptions } from "@/lib/hotelTime";
import { currencyForCountry, currencyOptions } from "@/lib/money";

/**
 * Where the hotel is and what kind of hotel it is.
 *
 * These are the tags events are matched on: a hotel sees public events for
 * its country, its state, its city and its kind of property. Shared by
 * Property Setup, the Events page (when the profile is incomplete) and the
 * onboarding form, so all three ask the same questions the same way.
 *
 * Works for any country. One with its own place list (lib/places.js) gets a
 * state dropdown; any other gets free text, with suggestions from the places
 * shared events there already use.
 */

export const EMPTY_PROFILE = { country_code: "", state: "", city: "", property_types: [], timezone: "", currency: "" };

/**
 * States and cities that shared events already name in a country. Signed
 * out -- the onboarding form -- the request is refused and the lists stay
 * empty, which only costs suggestions.
 */
function useKnownPlaces(countryCode) {
  const [known, setKnown] = useState({ states: [], cities: [] });
  useEffect(() => {
    setKnown({ states: [], cities: [] });
    if (!countryCode) return undefined;
    let cancelled = false;
    fetch(`/api/events/places?country=${encodeURIComponent(countryCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setKnown({ states: json.states || [], cities: json.cities || [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [countryCode]);
  return known;
}

const merged = (...lists) => [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));

/** The fields alone, controlled by the caller. */
export function ProfileFields({
  value,
  onChange,
  idPrefix = "profile",
  typesHint = "Optional. Choose every one that fits: a resort that hosts weddings is both.",
  // Sign-up leaves the kind out; it can be added under Property Setup.
  showTypes = true,
  // The hotel's clock. Asked for a hotel, not for an event's tags.
  showZone = false,
  // When the business day changes (the night audit time). Property Setup
  // only: sign-up starts every hotel on 2:30 AM.
  showDayChange = false,
}) {
  const countries = useMemo(() => countryOptions(), []);
  const zones = useMemo(() => (showZone ? zoneOptions() : []), [showZone]);
  const deviceZone = useMemo(() => (showZone ? browserZone() : ""), [showZone]);
  const currencies = useMemo(() => (showZone ? currencyOptions() : []), [showZone]);
  const known = useKnownPlaces(value.country_code);
  const set = (patch) => onChange({ ...value, ...patch });
  const listedStates = stateOptions(value.country_code);
  const regionLabel = placesFor(value.country_code).regionLabel;
  const states = merged(known.states);
  const cities = merged(citySuggestions(value.country_code, value.state), known.cities);
  const toggleType = (id) =>
    set({
      property_types: value.property_types.includes(id)
        ? value.property_types.filter((t) => t !== id)
        : [...value.property_types, id],
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Country</span>
          <Select
            className="input w-full"
            value={value.country_code || ""}
            onChange={(e) =>
              set({
                country_code: e.target.value,
                state: "",
                city: "",
                // A new country brings its own money; it can still be changed below.
                ...(showZone ? { currency: currencyForCountry(e.target.value) || value.currency || "" } : {}),
              })
            }
          >
            <option value="">Choose...</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="label">{regionLabel}</span>
          {listedStates.length ? (
            <Select
              className="input w-full"
              value={value.state || ""}
              onChange={(e) => set({ state: e.target.value })}
            >
              <option value="">Choose...</option>
              {listedStates.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <input
                className="input w-full"
                list={`${idPrefix}-states`}
                value={value.state || ""}
                onChange={(e) => set({ state: e.target.value })}
                placeholder="Optional"
              />
              <datalist id={`${idPrefix}-states`}>
                {states.map((st) => (
                  <option key={st} value={st} />
                ))}
              </datalist>
            </>
          )}
        </label>

        <label className="block">
          <span className="label">City or town</span>
          <input
            className="input w-full"
            list={`${idPrefix}-cities`}
            value={value.city || ""}
            onChange={(e) => set({ city: e.target.value })}
            placeholder={cities.length ? `Start typing, e.g. ${cities[0]}` : "City or town"}
          />
          <datalist id={`${idPrefix}-cities`}>
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>

      {showZone && (
        <div className={`grid gap-3 ${showDayChange ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <label className="block sm:col-span-2">
          <span className="label">Time zone</span>
          <Select
            className="input w-full"
            value={value.timezone || ""}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            <option value="">Choose...</option>
            {/* The device's own zone first: whoever signs up is usually at the hotel. */}
            {deviceZone && (
              <option value={deviceZone}>
                {zones.find((z) => z.value === deviceZone)?.label || deviceZone}, this device
              </option>
            )}
            {zones
              .filter((z) => z.value !== deviceZone)
              .map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
          </Select>
          <span className="mt-1 block text-xs faint">
            Today, the night audit and every time on screen follow the hotel&apos;s clock.
          </span>
        </label>
        {showDayChange && (
          <label className="block">
            <span className="label">Day changes at</span>
            <Select
              className="input w-full"
              value={value.day_change_time || dayStartValue(DEFAULT_DAY_START)}
              onChange={(e) => set({ day_change_time: e.target.value })}
            >
              {dayStartOptions().map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs faint">
              Your night audit time. Until then, today is still the day before.
            </span>
          </label>
        )}
        <label className="block">
          <span className="label">Currency</span>
          <Select
            className="input w-full"
            value={value.currency || currencyForCountry(value.country_code) || ""}
            onChange={(e) => set({ currency: e.target.value })}
          >
            <option value="">Choose...</option>
            {currencies.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs faint">New bookings and every price are in this.</span>
        </label>
        </div>
      )}

      {showTypes && (
        <div>
          <span className="label">Kind of property</span>
          <p className="mb-2 text-xs faint">{typesHint}</p>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPES.map((t) => {
              const on = value.property_types.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t.id)}
                  className={on ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The profile as a card that loads and saves itself, for Property Setup. */
export default function PropertyProfile({ propertyId, onSaved, intro }) {
  const [value, setValue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  useEffect(() => {
    let cancelled = false;
    setValue(null);
    fetch(`/api/setup/profile${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the property profile.");
        if (!cancelled) {
          const country_code = json.profile.country_code || guessCountry();
          setValue({
            ...EMPTY_PROFILE,
            ...json.profile,
            country_code,
            currency: json.profile.currency || currencyForCountry(country_code) || "",
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setValue(EMPTY_PROFILE);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function save(e) {
    e.preventDefault();
    const gaps = profileGaps(value);
    if (!value.timezone) gaps.push("time zone");
    if (gaps.length) {
      setError(`Still needed: ${gaps.join(", ")}.`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/setup/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertyId || undefined, profile: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the property profile.");
      setValue({ ...value, ...json.profile, state: json.profile.state || "" });
      setNotice("Saved. Events are now matched to this profile.");
      onSaved?.(json.profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card card-pad space-y-3">
      <div>
        <h3 className="h2">Property profile</h3>
        <p className="sub">
          {intro ||
            "Where the hotel is, its clock and money, and what kind it is. Events (festivals, holidays, conferences, wedding seasons) are matched to hotels by these, and feed Dynamic Pricing."}
        </p>
      </div>

      {value ? <ProfileFields value={value} onChange={setValue} idPrefix={`profile-${propertyId || "own"}`} showZone showDayChange /> : <p className="sub">Loading...</p>}

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          {notice}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={busy || !value}>
        {busy ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
