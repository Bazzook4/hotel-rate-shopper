"use client";

import { useEffect, useRef, useState } from "react";
import { EMPTY_PROFILE, ProfileFields } from "../dashboard/components/PropertyProfile";
import { profileGaps } from "@/lib/eventTags";
import { guessCountry } from "@/lib/places";
import {
  DEFAULT_PLAN_CODES,
  MAX_ADULTS,
  MAX_ROOM_TYPES,
  STARTER_PLANS,
  emptyRoomType,
  validateStarterSetup,
} from "@/lib/onboardSetup";

const labelClass = "text-xs font-semibold uppercase tracking-[0.2em] text-ink/70";
// Matches the server's limit in api/auth/onboard.
const MAX_ROOMS = 1000;

export default function OnboardPage() {
  const [token, setToken] = useState("");
  // "checking" until the link is validated, then "open" or "gone".
  const [linkState, setLinkState] = useState("checking");
  const [propertyName, setPropertyName] = useState("");
  const [totalRooms, setTotalRooms] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [roomTypes, setRoomTypes] = useState([emptyRoomType()]);
  const [planCodes, setPlanCodes] = useState(DEFAULT_PLAN_CODES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bot traps the server checks: when the form opened, and a field only a
  // script would fill.
  const startedAt = useRef(0);
  const [trap, setTrap] = useState("");

  useEffect(() => {
    // A first guess from the browser, after mount so the server render and
    // the first client render agree.
    setProfile((p) => (p.country_code ? p : { ...p, country_code: guessCountry() }));
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
        startedAt.current = Date.now();
        setLinkState("open");
      })
      .catch(() => setLinkState("gone"));
  }, []);

  const setRoom = (i, key, value) =>
    setRoomTypes((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const togglePlan = (code) =>
    setPlanCodes((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]
    );
  const roomsPlaced = roomTypes.reduce((n, r) => n + (Number(r.rooms) || 0), 0);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!/^\d+$/.test(totalRooms.trim()) || +totalRooms < 1 || +totalRooms > MAX_ROOMS) {
      setError(`Total rooms must be a whole number from 1 to ${MAX_ROOMS}.`);
      return;
    }
    const starter = validateStarterSetup({ roomTypes, planCodes }, Number(totalRooms));
    if (starter.error) {
      setError(starter.error);
      return;
    }
    const gaps = profileGaps(profile);
    if (gaps.length) {
      setError(`Still needed: ${gaps.join(", ")}.`);
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
        className="w-full max-w-lg space-y-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-2xl shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
      >
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-ink/70">HMS | Online Hotelier</p>
          <h1 className="h1">Set up your hotel</h1>
          <p className="text-xs text-ink/70">
            Choose the email and password you will sign in with.
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
                <span className={labelClass}>Room types</span>
                <div className="hidden grid-cols-[1fr_4.5rem_4.5rem_4.5rem_auto] gap-2 text-xs text-ink/70 sm:grid">
                  <span>Name</span>
                  <span>Rooms</span>
                  <span>Adults</span>
                  <span>Most adults</span>
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
                      ["maxAdults", "Most adults", 1, MAX_ADULTS],
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
                  Adults: guests the room price includes. Most adults: the most it sleeps, extra
                  adults paying more.
                </p>
              </div>

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
                  Each one becomes a rate plan on every room type. You add prices after signing in.
                </p>
              </fieldset>

              <div className="space-y-2 text-left">
                <span className={labelClass}>Where (for local events)</span>
                <ProfileFields
                  value={profile}
                  onChange={setProfile}
                  idPrefix="onboard"
                  showTypes={false}
                />
              </div>

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
            </div>

            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Creating your account..." : "Create account"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
