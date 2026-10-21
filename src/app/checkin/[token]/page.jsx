"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { countryOptions } from "@/lib/countries";
import {
  CHECKIN_ID_TYPES,
  MAX_CHECKIN_FILES_PER_GUEST,
  checkinGaps,
  isForeignGuest,
} from "@/lib/onlineCheckinShared";
import { shrink } from "../../dashboard/components/GuestIdPhotos";

/**
 * The guest's online check-in: opened from the link the hotel sent, on the
 * guest's own phone, with no account -- often inside WhatsApp's browser, on
 * patchy data.
 *
 * One card per guest the hotel asks about, then arrival time and requests,
 * then a consent tick and Send. Photos go up as soon as they are picked,
 * with progress and errors shown in that guest's card. What is typed is kept
 * on the phone as it is typed, so a closed tab or a dropped connection does
 * not lose it, and every gap is marked at once before anything is sent.
 */

const EMPTY_PERSON = {
  full_name: "",
  phone: "",
  email: "",
  address: "",
  nationality: "",
  id_type: "",
  id_number: "",
  date_of_birth: "",
  passport_expiry: "",
  visa_number: "",
  visa_expiry: "",
  arrived_from: "",
  next_destination: "",
  files: [],
};

const CLOSED_TEXT = {
  accepted: "The hotel has received and accepted your details. See you soon!",
  arrived: "You have already checked in. Enjoy your stay!",
  cancelled: "This booking is no longer active. Please contact the hotel if this is a mistake.",
  past: "This stay is over, so the check-in link has closed.",
};

const OFFLINE = "No internet connection. Check your signal and try again.";

/** A request whose network failure reads as such, not as the browser's own words. */
async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(OFFLINE);
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const draftKey = (token) => `hms.checkin.${token}`;

function readDraft(token) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(token)) || "null");
  } catch {
    return null;
  }
}

function writeDraft(token, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(token), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(token));
  } catch {
    // A phone that will not keep it only loses the safety net.
  }
}

function day(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const fieldId = (index, field) => `ci-${index ?? "x"}-${field}`;

function Field({ label, required, children, wide, error }) {
  return (
    <label className={`block min-w-0 space-y-1 ${wide ? "col-span-2" : ""}`}>
      <span className="label">
        {label}
        {required && <span style={{ color: "var(--danger)" }}> *</span>}
      </span>
      {children}
      {error && (
        <span className="block text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** Text boxes for numbers on an ID, which phone keyboards must not "correct". */
const codeInput = { autoCapitalize: "characters", autoCorrect: "off", spellCheck: false };

function GuestCard({ index, person, onChange, needsId, hotelCountry, prefs, countries, upload, removeFile, busy, gapFor, uploading }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  // Other guests' phone and email are optional, so they wait behind a link.
  const [contact, setContact] = useState(index === 0 || Boolean(person.phone || person.email));
  const today = new Date().toISOString().slice(0, 10);
  const set = (field) => (e) => onChange({ ...person, [field]: e.target.value });
  const foreign = isForeignGuest(person, hotelCountry, prefs);
  const files = person.files || [];
  const full = files.length >= MAX_CHECKIN_FILES_PER_GUEST;
  const pick = (e) => {
    upload(index, [...(e.target.files || [])]);
    e.target.value = "";
  };

  // Switching between an Indian ID and a passport starts the ID afresh, so an
  // Aadhaar number cannot end up as the passport number.
  const setNationality = (e) => {
    const next = { ...person, nationality: e.target.value };
    if (isForeignGuest(next, hotelCountry, prefs) !== foreign) {
      next.id_type = "";
      next.id_number = "";
    }
    onChange(next);
  };

  const input = (field, props = {}) => (
    <input id={fieldId(index, field)} className="input w-full" value={person[field]} onChange={set(field)} {...props} />
  );

  return (
    <section className="card card-pad space-y-3">
      <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
        Guest {index + 1}
        {index === 0 && <span className="sub font-normal"> · main guest</span>}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name, as on the ID" required wide error={gapFor("full_name")}>
          {input("full_name", { autoComplete: index === 0 ? "name" : "off" })}
        </Field>
        {contact ? (
          <>
            <Field label="Phone" required={index === 0} error={gapFor("phone")}>
              {input("phone", { type: "tel", autoComplete: index === 0 ? "tel" : "off" })}
            </Field>
            <Field label="Email">{input("email", { type: "email", autoComplete: index === 0 ? "email" : "off" })}</Field>
          </>
        ) : (
          <button type="button" className="btn btn-ghost col-span-2 justify-self-start text-sm" onClick={() => setContact(true)}>
            + Add phone / email
          </button>
        )}
        {index === 0 && (
          <Field label="Home address" required={prefs.address} wide error={gapFor("address")}>
            <textarea
              id={fieldId(index, "address")}
              className="input w-full"
              rows={2}
              value={person.address}
              onChange={set("address")}
              autoComplete="street-address"
            />
          </Field>
        )}
        {needsId && (
          <>
            <Field label="Nationality" required wide>
              <select className="input w-full" value={person.nationality || ""} onChange={setNationality}>
                {!person.nationality && <option value="">Choose…</option>}
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {foreign ? (
              <>
                <Field label="Passport number" required error={gapFor("id_number")}>
                  {input("id_number", codeInput)}
                </Field>
                <Field label="Date of birth" required error={gapFor("date_of_birth")}>
                  {input("date_of_birth", { type: "date", max: today })}
                </Field>
                <Field label="Passport until">{input("passport_expiry", { type: "date", min: today })}</Field>
                <Field label="Visa number">{input("visa_number", codeInput)}</Field>
                <Field label="Visa until">{input("visa_expiry", { type: "date", min: today })}</Field>
                <Field label="Arriving from">{input("arrived_from")}</Field>
                <Field label="Going next to">{input("next_destination")}</Field>
              </>
            ) : (
              <>
                <Field label="Type of ID" required error={gapFor("id_type")}>
                  <select id={fieldId(index, "id_type")} className="input w-full" value={person.id_type} onChange={set("id_type")}>
                    <option value="">Choose…</option>
                    {CHECKIN_ID_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ID number" required error={gapFor("id_number")}>
                  {input("id_number", { ...codeInput, inputMode: person.id_type === "aadhaar" ? "numeric" : undefined })}
                </Field>
              </>
            )}
          </>
        )}
      </div>

      {needsId && (
        <div className="space-y-2" id={fieldId(index, "files")}>
          <div className="label">
            {foreign ? "Photo of your passport and visa" : "Photo of the ID, front and back"}
            {prefs.idPhoto && <span style={{ color: "var(--danger)" }}> *</span>}
          </div>
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" style={{ color: "var(--accent-text)" }}>✓</span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    style={{ minHeight: 36 }}
                    disabled={busy}
                    onClick={() => removeFile(f)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-sm" disabled={busy || full} onClick={() => cameraRef.current?.click()}>
              Take photo
            </button>
            <button type="button" className="btn btn-secondary text-sm" disabled={busy || full} onClick={() => fileRef.current?.click()}>
              Choose file
            </button>
          </div>
          {uploading?.text && <p className="sub text-sm">{uploading.text}</p>}
          {(uploading?.error || gapFor("files")) && (
            <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
              {uploading?.error || gapFor("files")}
            </p>
          )}
          {full && <p className="sub text-xs">That is the most for one guest ({MAX_CHECKIN_FILES_PER_GUEST}).</p>}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={pick} />
        </div>
      )}
    </section>
  );
}

export default function OnlineCheckinPage() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // loading | gone | failed | ready
  const [view, setView] = useState(null);
  const [guests, setGuests] = useState([]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [requests, setRequests] = useState("");
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [gaps, setGaps] = useState([]);
  // The upload going on, or the one that failed, shown in that guest's card.
  const [uploading, setUploading] = useState(null);
  const countries = useMemo(() => countryOptions(), []);

  /** The server's copy, with anything typed on this phone since laid over it. */
  const take = useCallback(
    (data, { withDraft = false } = {}) => {
      const draft = withDraft ? readDraft(token) : null;
      setView(data);
      setGuests(
        data.guests.map((g, i) => ({
          ...EMPTY_PERSON,
          ...Object.fromEntries(Object.entries(g).filter(([, v]) => v != null)),
          nationality: g.nationality || data.hotel.country || "",
          ...(draft?.guests?.[i] || {}),
          files: g.files || [],
        }))
      );
      setArrivalTime(draft?.arrivalTime ?? data.arrivalTime ?? "");
      setRequests(draft?.requests ?? data.requests ?? "");
    },
    [token]
  );

  const load = useCallback(async () => {
    setState("loading");
    try {
      const { res, data } = await request(`/api/checkin?token=${encodeURIComponent(token)}`);
      if (res.status === 404 || res.status === 410) {
        setLoadError(data.error || "This check-in link is no longer valid. Please contact the hotel.");
        setState("gone");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Your check-in did not open. Please try again.");
      take(data, { withDraft: true });
      setState("ready");
    } catch (err) {
      setLoadError(err.message);
      setState("failed");
    }
  }, [token, take]);

  useEffect(() => {
    load();
  }, [load]);

  // Kept on the phone as it is typed; files are on the server already.
  useEffect(() => {
    if (state !== "ready" || view?.closed) return;
    writeDraft(token, { guests: guests.map(({ files: _files, ...g }) => g), arrivalTime, requests });
  }, [token, state, view, guests, arrivalTime, requests]);

  const payload = (extra) => ({
    token,
    guests: guests.map(({ files: _files, ...g }) => g),
    arrivalTime,
    requests,
    ...extra,
  });

  const gapFor = (index) => (field) => gaps.find((g) => g.index === index && g.field === field)?.message || null;

  function showGaps(list) {
    setGaps(list);
    const first = list[0];
    if (!first) return;
    const el = document.getElementById(fieldId(first.index, first.field));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el && "focus" in el && el.tagName !== "DIV") el.focus({ preventScroll: true });
  }

  async function save({ submit }) {
    setError("");
    setNotice("");
    if (submit) {
      const list = checkinGaps(guests, { prefs: view.prefs, country: view.hotel.country, consent });
      showGaps(list);
      if (list.length) {
        setError(list.length === 1 ? "One thing is still missing — see above." : `${list.length} things are still missing — see above.`);
        return;
      }
    }
    setBusy(true);
    try {
      const { res, data } = await request("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload({ submit, consent })),
      });
      if (!res.ok) {
        if (data.gap) showGaps([data.gap]);
        throw new Error(data.error || "Your details did not save. Please try again.");
      }
      take(data);
      if (submit) {
        writeDraft(token, null);
        setEditing(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setNotice("Saved. Open this link again any time to finish.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(index, picked) {
    if (!picked.length) return;
    setBusy(true);
    setUploading({ index, text: "Uploading…" });
    try {
      // What has been typed so far goes up with the photo.
      await request("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload({ submit: false })),
      });
      for (const [n, original] of picked.entries()) {
        setUploading({ index, text: picked.length > 1 ? `Uploading ${n + 1} of ${picked.length}…` : "Uploading…" });
        const file = await shrink(original);
        const form = new FormData();
        form.set("token", token);
        form.set("index", String(index));
        form.set("file", file);
        const { res, data } = await request("/api/checkin/files", { method: "POST", body: form });
        if (!res.ok) throw new Error(data.error || "The photo did not upload. Please try again.");
        setGuests((gs) => gs.map((g, i) => (i === index ? { ...g, files: data.files } : g)));
        setGaps((list) => list.filter((g) => !(g.index === index && g.field === "files")));
      }
      setUploading(null);
    } catch (err) {
      setUploading({ index, error: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(index, f) {
    setBusy(true);
    setUploading(null);
    try {
      const qs = new URLSearchParams({ token, id: f.id });
      const { res, data } = await request(`/api/checkin/files?${qs}`, { method: "DELETE" });
      if (!res.ok) throw new Error(data.error || "Could not remove the file.");
      setGuests((gs) => gs.map((g, i) => (i === index ? { ...g, files: data.files } : g)));
    } catch (err) {
      setUploading({ index, error: err.message });
    } finally {
      setBusy(false);
    }
  }

  const b = view?.booking;
  const prefs = view?.prefs;
  const sent = Boolean(view?.submittedAt) && !editing;

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-6" style={{ minHeight: "100vh" }}>
      {state === "loading" && <p className="sub text-center">Opening your check-in…</p>}

      {(state === "gone" || state === "failed") && (
        <div className="card card-pad space-y-3 text-center">
          <h1 className="h1">Online check-in</h1>
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
          {state === "failed" && (
            <button type="button" className="btn btn-primary" onClick={load}>
              Try again
            </button>
          )}
        </div>
      )}

      {state === "ready" && view && (
        <>
          <header className="space-y-1">
            <div className="flex items-center gap-3">
              {view.hotel.logoUrl && (
                <img
                  src={view.hotel.logoUrl}
                  alt=""
                  width={96}
                  height={44}
                  // A logo that will not load leaves just the name, not a gap.
                  onError={(e) => (e.currentTarget.style.display = "none")}
                  style={{ height: 44, width: "auto", maxWidth: 96, objectFit: "contain", flexShrink: 0 }}
                />
              )}
              <div className="min-w-0">
                <h1 className="h1" style={{ overflowWrap: "break-word" }}>
                  {view.hotel.name}
                </h1>
                <p className="sub text-xs uppercase tracking-wide">Online check-in</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {b.guestName} · Booking {b.reference}
              <br />
              {b.dayUse ? `Day use on ${day(b.checkIn)}` : `${day(b.checkIn)} → ${day(b.checkOut)}`}
              {b.roomType ? ` · ${b.roomType}` : ""} · {b.adults} adult{b.adults === 1 ? "" : "s"}
              {b.children ? `, ${b.children} child${b.children === 1 ? "" : "ren"}` : ""}
            </p>
          </header>

          {view.closed ? (
            <div className="card card-pad">
              <p className="text-sm">{CLOSED_TEXT[view.closed]}</p>
            </div>
          ) : sent ? (
            <div className="card card-pad space-y-3">
              <p className="text-sm font-semibold" style={{ color: "var(--accent-text)" }}>
                ✓ Thank you, your details are with the hotel.
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                At the front desk you will only need to show your ID. You can still change your details until you arrive.
              </p>
              <button type="button" className="btn btn-secondary text-sm" onClick={() => setEditing(true)}>
                Change my details
              </button>
            </div>
          ) : (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                save({ submit: true });
              }}
            >
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Save time at the front desk: fill this in before you arrive. ID photos can be a clear picture or a PDF, up
                to 4 MB.
                {guests.length > 1 && " The hotel needs the details and ID of every adult staying."}
              </p>

              {guests.map((g, i) => (
                <GuestCard
                  key={i}
                  index={i}
                  person={g}
                  onChange={(next) => {
                    setGuests((gs) => gs.map((x, j) => (j === i ? next : x)));
                    // A gap the guest has just filled stops being marked.
                    setGaps((list) =>
                      list.filter((gap) => gap.index !== i || gap.field === "files" || !String(next[gap.field] || "").trim())
                    );
                  }}
                  needsId={i === 0 || prefs.idFrom === "all"}
                  hotelCountry={view.hotel.country}
                  prefs={prefs}
                  countries={countries}
                  upload={upload}
                  removeFile={(f) => removeFile(i, f)}
                  busy={busy}
                  gapFor={gapFor(i)}
                  uploading={uploading?.index === i ? uploading : null}
                />
              ))}

              <section className="card card-pad grid grid-cols-2 gap-3">
                <Field label="Expected arrival time">
                  <input className="input w-full" type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
                </Field>
                <Field label="Anything we should know?" wide>
                  <textarea
                    className="input w-full"
                    rows={2}
                    value={requests}
                    onChange={(e) => setRequests(e.target.value)}
                    placeholder="Early check-in, extra bed, dietary needs…"
                  />
                </Field>
              </section>

              <div className="space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    id={fieldId(null, "consent")}
                    type="checkbox"
                    className="mt-1"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked);
                      if (e.target.checked) setGaps((list) => list.filter((g) => g.field !== "consent"));
                    }}
                  />
                  <span>
                    I agree that {view.hotel.name} may keep these details and a copy of the ID for this stay, as hotels are
                    required to by law.
                  </span>
                </label>
                {gapFor(null)("consent") && (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>
                    {gapFor(null)("consent")}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              )}
              {notice && !error && <p className="sub text-sm">{notice}</p>}

              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Please wait…" : "Send to hotel"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save({ submit: false })}>
                  Save and finish later
                </button>
              </div>
            </form>
          )}

          <p className="sub text-center text-xs">Your details go only to {view.hotel.name}.</p>
        </>
      )}
    </main>
  );
}
