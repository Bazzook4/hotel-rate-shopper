"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { EMPTY_PROFILE, ProfileFields } from "../dashboard/components/PropertyProfile";
import { profileGaps } from "@/lib/eventTags";
import { guessCountry, stateFromRegionCode } from "@/lib/places";
import { browserZone, isZone } from "@/lib/hotelTime";
import { currencyForCountry } from "@/lib/money";

const labelClass = "text-xs font-semibold uppercase tracking-[0.2em] text-ink/70";
// Matches the server's limit in api/auth/onboard.
const MAX_ROOMS = 1000;

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
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bot traps the server checks: when the form opened, and a field only a
  // script would fill.
  const startedAt = useRef(0);
  const [trap, setTrap] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    // No token in the address: the login page's "New hotel?" link. The
    // server answers with the always-open link's token, if there is one.
    fetch(`/api/auth/onboard?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        setToken(data.token || t);
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

  // Returns true when the hotel and contact details are complete.
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

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!hotelStepOk()) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
            One short page. Add your rooms and prices after you sign in.
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
            <div className="space-y-6">
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
              <section className="space-y-4">
                <h2 className="h2 text-left">Your hotel</h2>
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
                    Every room the hotel has. Ask us if you add rooms later.
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

              <section className="space-y-4 border-t border-[var(--border)] pt-4">
                <h2 className="h2 text-left">About you</h2>
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

              <section className="space-y-4 border-t border-[var(--border)] pt-4">
                <h2 className="h2 text-left">Sign in details</h2>
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
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input"
                  />
                </label>
                <label className="flex items-center gap-2 text-left text-xs text-ink/70">
                  <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                  Show password
                </label>
              </section>
            </div>

            {error && (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Creating your account..." : "Create account"}
            </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
