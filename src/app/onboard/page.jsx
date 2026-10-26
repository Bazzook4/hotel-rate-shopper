"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { EMPTY_PROFILE, ProfileFields } from "../dashboard/components/PropertyProfile";
import { profileGaps } from "@/lib/eventTags";
import { guessCountry, stateFromRegionCode } from "@/lib/places";
import { browserZone, isZone } from "@/lib/hotelTime";
import { currencyForCountry } from "@/lib/money";
import {
  DEFAULT_PLAN_CODES,
  MAX_ADULTS,
  MAX_PRICE,
  MAX_ROOM_TYPES,
  STARTER_PLANS,
  emptyRoomType,
  validateStarterSetup,
} from "@/lib/onboardSetup";

const labelClass = "text-xs font-semibold uppercase tracking-[0.2em] text-ink/70";
// Matches the server's limit in api/auth/onboard.
const MAX_ROOMS = 1000;
const STEPS = ["Hotel details", "Room types", "Plans and rates", "Sign in"];

export default function OnboardPage() {
  const [token, setToken] = useState("");
  // "checking" until the link is validated, then "open" or "gone".
  const [linkState, setLinkState] = useState("checking");
  const [propertyName, setPropertyName] = useState("");
  const [totalRooms, setTotalRooms] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [roomTypes, setRoomTypes] = useState([emptyRoomType()]);
  const [planCodes, setPlanCodes] = useState(DEFAULT_PLAN_CODES);
  // 1 = the hotel, 2 = room types, 3 = plans and rates, 4 = email and password.
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bot traps the server checks: when the form opened, and a field only a
  // script would fill.
  const startedAt = useRef(0);
  const [trap, setTrap] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    if (!t) {
      setLinkState("gone");
      return;
    }
    fetch(`/api/auth/onboard?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.propertyName) setPropertyName(data.propertyName);
        // Fill country, city, time zone and currency from where the visitor
        // is, never over anything already chosen. Device clock first for the
        // zone, then the address, then the browser language for the country.
        const geo = data.geo || {};
        const country = geo.country || guessCountry();
        const zone = browserZone() || (isZone(geo.timezone) ? geo.timezone : "");
        setProfile((p) => ({
          ...p,
          country_code: p.country_code || country,
          state: p.state || (p.country_code ? "" : stateFromRegionCode(country, geo.region)),
          city: p.city || (p.country_code ? "" : geo.city || ""),
          timezone: p.timezone || zone,
          currency: p.currency || currencyForCountry(p.country_code || country) || "",
        }));
        startedAt.current = Date.now();
        setLinkState("open");
      })
      .catch(() => setLinkState("gone"));
  }, []);

  const setRoom = (i, key, value) =>
    setRoomTypes((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const setPrice = (i, code, value) =>
    setRoomTypes((list) =>
      list.map((r, j) => (j === i ? { ...r, prices: { ...r.prices, [code]: value } } : r))
    );
  const togglePlan = (code) =>
    setPlanCodes((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]
    );
  const roomsPlaced = roomTypes.reduce((n, r) => n + (Number(r.rooms) || 0), 0);

  // Checks step 1; returns true when the hotel details are complete.
  function hotelStepOk() {
    if (!propertyName.trim()) {
      setError("Enter the hotel name.");
      return false;
    }
    if (!/^\d+$/.test(totalRooms.trim()) || +totalRooms < 1 || +totalRooms > MAX_ROOMS) {
      setError(`Total rooms must be a whole number from 1 to ${MAX_ROOMS}.`);
      return false;
    }
    const gaps = profileGaps(profile);
    if (!profile.timezone) gaps.push("time zone");
    if (gaps.length) {
      setError(`Still needed: ${gaps.join(", ")}.`);
      return false;
    }
    if (!contactName.trim()) {
      setError("Enter your name.");
      return false;
    }
    if (contactPhone.replace(/\D/g, "").length < 10) {
      setError("Enter your mobile number, so we can reach you.");
      return false;
    }
    return true;
  }

  // Room types alone, before any plan or price is asked for.
  function roomStepOk() {
    const dummy = roomTypes.map((r) => ({ ...r, prices: { EP: 1 } }));
    const res = validateStarterSetup({ roomTypes: dummy, planCodes: ["EP"] }, Number(totalRooms));
    if (res.error) setError(res.error);
    return !res.error;
  }

  function plansStepOk() {
    const res = validateStarterSetup({ roomTypes, planCodes }, Number(totalRooms));
    if (res.error) setError(res.error);
    return !res.error;
  }

  function goTo(n) {
    setStep(n);
    window.scrollTo({ top: 0 });
  }

  function goNext() {
    setError("");
    const ok = step === 1 ? hotelStepOk() : step === 2 ? roomStepOk() : plansStepOk();
    if (ok) goTo(step + 1);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (step < 4) {
      goNext();
      return;
    }
    if (!hotelStepOk()) {
      setStep(1);
      return;
    }
    const starter = validateStarterSetup({ roomTypes, planCodes }, Number(totalRooms));
    if (starter.error) {
      setError(starter.error);
      setStep(roomStepOk() ? 3 : 2);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          propertyName,
          totalRooms: Number(totalRooms),
          roomTypes,
          planCodes,
          contactName,
          contactPhone,
          email,
          password,
          profile,
          website: trap,
          startedAt: startedAt.current,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 410) setLinkState("gone");
        throw new Error(data?.error || "Sign up failed");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-3xl space-y-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-ink/70">HMS | Online Hotelier</p>
          <h1 className="h1">Set up your hotel</h1>
          <p className="text-xs text-ink/70">
            Four short steps. Your rooms, plans and prices are ready when you sign in.
          </p>
        </div>

        {linkState === "checking" && <p className="sub text-center">Checking your link...</p>}

        {linkState === "gone" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-[var(--danger)]">
              This onboarding link has expired, is full, or was switched off.
            </p>
            <p className="text-xs text-ink/70">
              Ask us for a new one, or <a href="/login" className="underline">sign in</a> if
              you already have an account.
            </p>
          </div>
        )}

        {linkState === "open" && (
          <>
            <div className="grid gap-6 sm:grid-cols-[11rem_1fr]">
            <ol className="grid grid-cols-4 gap-2 self-start sm:grid-cols-1 sm:gap-3" aria-label="Steps">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const state = n < step ? "done" : n === step ? "now" : "todo";
                return (
                  <li
                    key={label}
                    aria-current={state === "now" ? "step" : undefined}
                    className="flex flex-col items-center gap-1 text-center sm:flex-row sm:gap-3 sm:text-left"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                        state === "now"
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : state === "done"
                            ? "border-[var(--accent)] text-[var(--accent)]"
                            : "border-[var(--border)] text-ink/70"
                      }`}
                    >
                      {state === "done" ? <Icon name="check" size={14} /> : n}
                    </span>
                    <span className={`text-xs sm:text-sm ${state === "now" ? "font-semibold" : "text-ink/70"}`}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="min-w-0 space-y-6">
            <div className="space-y-4">
              {/* Hidden from people; a form-filling script fills it in. The
                  odd name and autocomplete keep browsers from autofilling it. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Leave this empty
                  <input
                    type="text"
                    name="hp_company_url"
                    value={trap}
                    onChange={(e) => setTrap(e.target.value)}
                    tabIndex={-1}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <section className={`space-y-4 ${step === 1 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Hotel details</h2>
                <div className="grid gap-4 sm:grid-cols-[1fr_8rem] sm:gap-3">
                  <label className="block space-y-2 text-left">
                    <span className={labelClass}>Hotel name</span>
                    <input
                      type="text"
                      value={propertyName}
                      onChange={(e) => setPropertyName(e.target.value)}
                      required
                      autoComplete="organization"
                      className="input"
                    />
                  </label>

                  <label className="block space-y-2 text-left">
                    <span className={labelClass}>Total rooms</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_ROOMS}
                      step={1}
                      value={totalRooms}
                      onChange={(e) => setTotalRooms(e.target.value)}
                      required
                      className="input"
                    />
                  </label>
                  <p className="text-xs text-ink/70 sm:col-span-2">
                    Total rooms: every room the hotel has. You can set up this many; ask us if you add rooms later.
                  </p>
                </div>

                <div className="space-y-2 text-left">
                  <span className={labelClass}>Where, and its time zone</span>
                  <ProfileFields
                    value={profile}
                    onChange={setProfile}
                    idPrefix="onboard"
                    showTypes={false}
                    showZone
                  />
                </div>
              </section>

              <section className={`space-y-4 border-t border-[var(--border)] pt-4 ${step === 1 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Contact details</h2>
                <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                  <label className="block space-y-2 text-left">
                    <span className={labelClass}>Your name</span>
                    <input
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      required
                      autoComplete="name"
                      className="input"
                    />
                  </label>
                  <label className="block space-y-2 text-left">
                    <span className={labelClass}>Your mobile</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      required
                      autoComplete="tel"
                      placeholder="WhatsApp number"
                      className="input"
                    />
                  </label>
                  <p className="text-xs text-ink/70 sm:col-span-2">
                    So we can reach you to help set up. Not shown to guests.
                  </p>
                </div>
              </section>

              <section className={`space-y-4 ${step === 2 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Room types</h2>
                <div className="space-y-2 text-left">
                  <div className="hidden grid-cols-[1fr_4.5rem_4.5rem_4.5rem_auto] gap-2 text-xs text-ink/70 sm:grid">
                    <span>Name</span>
                    <span>Rooms</span>
                    <span>Adults</span>
                    <span>Max adults</span>
                    <span className="w-[4.5rem]" />
                  </div>
                  {roomTypes.map((r, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-3 gap-2 sm:grid-cols-[1fr_4.5rem_4.5rem_4.5rem_auto]"
                    >
                      <input
                        type="text"
                        value={r.name}
                        onChange={(e) => setRoom(i, "name", e.target.value)}
                        placeholder="e.g. Deluxe"
                        aria-label="Room type name"
                        className="input col-span-3 sm:col-span-1"
                      />
                      {[
                        ["rooms", "Rooms", 1, Number(totalRooms) || undefined],
                        ["baseAdults", "Adults", 1, MAX_ADULTS],
                        ["maxAdults", "Max adults", 1, MAX_ADULTS],
                      ].map(([key, label, min, max]) => (
                        <label key={key} className="block space-y-1">
                          <span className="text-xs text-ink/70 sm:hidden">{label}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={min}
                            max={max}
                            step={1}
                            value={r[key]}
                            onChange={(e) => setRoom(i, key, e.target.value)}
                            aria-label={label}
                            className="input"
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() => setRoomTypes((list) => list.filter((_, j) => j !== i))}
                        disabled={roomTypes.length === 1}
                        className="btn btn-ghost col-span-3 sm:col-span-1"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setRoomTypes((list) => [...list, emptyRoomType()])}
                      disabled={roomTypes.length >= MAX_ROOM_TYPES}
                      className="btn btn-ghost"
                    >
                      Add room type
                    </button>
                    {Number(totalRooms) > 0 && (
                      <span
                        className={`text-xs ${
                          roomsPlaced > Number(totalRooms) ? "text-[var(--danger)]" : "text-ink/70"
                        }`}
                      >
                        {roomsPlaced} of {totalRooms} rooms
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink/70">
                    Adults: guests the room price includes. Max adults: the most it sleeps, extra
                    adults paying more.
                  </p>
                </div>
              </section>

              <section className={`space-y-4 border-t border-[var(--border)] pt-4 ${step === 3 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Rate plans</h2>
                <fieldset className="space-y-2 text-left">
                  <legend className={labelClass}>What do you sell?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {STARTER_PLANS.map((p) => (
                      <label
                        key={p.code}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={planCodes.includes(p.code)}
                          onChange={() => togglePlan(p.code)}
                        />
                        <span className="text-sm">
                          {p.name} <span className="text-xs text-ink/70">({p.code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-ink/70">
                    Each one becomes a rate plan on every room type.
                  </p>
                </fieldset>
              </section>

              <section className={`space-y-4 border-t border-[var(--border)] pt-4 ${step === 3 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Rates</h2>
                <div className="space-y-3 text-left">
                  {roomTypes.map((r, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-sm font-semibold">
                        {r.name.trim() || `Room type ${i + 1}`}
                        <span className="font-normal text-ink/70">
                          {" "}for {Number(r.baseAdults) || 1}{" "}
                          {Number(r.baseAdults) === 1 ? "adult" : "adults"}
                        </span>
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {STARTER_PLANS.filter((p) => planCodes.includes(p.code)).map((p) => (
                          <label key={p.code} className="block space-y-1">
                            <span className="text-xs text-ink/70">{p.name}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={1}
                              max={MAX_PRICE}
                              step="any"
                              value={r.prices?.[p.code] ?? ""}
                              onChange={(e) => setPrice(i, p.code, e.target.value)}
                              required
                              className="input"
                            />
                          </label>
                        ))}
                        {Number(r.maxAdults) > Number(r.baseAdults) && (
                          <label className="block space-y-1">
                            <span className="text-xs text-ink/70">Each extra adult</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={MAX_PRICE}
                              step="any"
                              value={r.extraAdult ?? ""}
                              onChange={(e) => setRoom(i, "extraAdult", e.target.value)}
                              placeholder="0"
                              className="input"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-ink/70">
                    Price per night. You can change prices by date later in Rates &amp; Inventory.
                  </p>
                </div>
              </section>

              <section className={`space-y-4 border-t border-[var(--border)] pt-4 ${step === 4 ? "" : "hidden"}`}>
                <h2 className="h2 text-left">Email and password</h2>
                <p className="text-xs text-ink/70 text-left">You sign in with these.</p>
                <label className="block space-y-2 text-left">
                  <span className={labelClass}>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="input"
                  />
                </label>

                <label className="block space-y-2 text-left">
                  <span className={labelClass}>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input"
                  />
                </label>

                <label className="block space-y-2 text-left">
                  <span className={labelClass}>Confirm password</span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input"
                  />
                </label>
              </section>
            </div>

            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            <div className={step === 1 ? "" : "grid grid-cols-[auto_1fr] gap-3"}>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    goTo(step - 1);
                  }}
                  className="btn btn-ghost"
                >
                  Back
                </button>
              )}
              {step < 4 ? (
                <button type="button" onClick={goNext} className="btn btn-primary w-full">
                  Next: {STEPS[step].toLowerCase()}
                </button>
              ) : (
                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? "Creating your account..." : "Create account"}
                </button>
              )}
            </div>
            </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
