"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDialog } from "./Dialog";

const inputClass =
  "input mt-1";

const FIELDS = [
  { key: "name", label: "Property name", required: true },
  { key: "star_rating", label: "Star rating", type: "number", min: 1, max: 5 },
  // Caps the rooms the hotel can set up, so only a super admin changes it.
  {
    key: "total_rooms",
    label: "Total rooms",
    type: "number",
    min: 1,
    max: 1000,
    superOnly: true,
    note: "Set at sign-up. Ask Online Hotelier support to change it.",
    superNote: "Caps the rooms the hotel can set up. Leave blank for no limit.",
  },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "postal_code", label: "Postal code" },
  { key: "check_in_time", label: "Check-in time", type: "time" },
  { key: "check_out_time", label: "Check-out time", type: "time" },
];

function Field({ field, value, onChange, readOnly = false }) {
  return (
    <label className="block label">
      {field.label}
      {field.required && <span className="text-[var(--danger)]"> *</span>}
      <input
        type={field.type || "text"}
        min={field.min}
        max={field.max}
        value={value ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
        disabled={readOnly}
        className={inputClass}
      />
      {(readOnly ? field.note : field.superNote) && (
        <span className="mt-1 block text-xs faint">{readOnly ? field.note : field.superNote}</span>
      )}
    </label>
  );
}

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Copy to the clipboard; false when the browser would not. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** What is wrong with a shareable link's numbers, if anything. */
function sharedLinkProblem({ open, maxUses, days }) {
  if (open) return null;
  const whole = (v, lo, hi) => /^\d+$/.test(String(v).trim()) && +v >= lo && +v <= hi;
  if (!whole(maxUses, 2, 200)) return { field: "maxUses", text: "Hotels must be a whole number from 2 to 200." };
  if (!whole(days, 1, 90)) return { field: "days", text: "Days open must be a whole number from 1 to 90." };
  return null;
}

export default function PropertyAdmin({ session }) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // One piece of form state: null = closed, object = open. A new property
  // is just a form with no id.
  const [form, setForm] = useState(null);
  // The last onboarding link issued, shown once so it can be copied.
  const [invite, setInvite] = useState(null);
  // Shareable links still open, and the form for a new one (null = closed).
  // Their messages show in their own card, next to what was done.
  const [sharedLinks, setSharedLinks] = useState([]);
  const [sharedCaps, setSharedCaps] = useState(null);
  const [sharedForm, setSharedForm] = useState(null);
  const [sharedMsg, setSharedMsg] = useState(null); // { text, error }
  const [sharedLoadFailed, setSharedLoadFailed] = useState(false);
  const [switchingOff, setSwitchingOff] = useState(null);
  const sharedButtonRef = useRef(null);
  const dialog = useDialog();

  const canCreate = session?.isSuperAdmin === true;

  const loadSharedLinks = useCallback(async () => {
    if (!canCreate) return;
    try {
      const res = await fetch("/api/onboarding/invites");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setSharedLinks(json.links || []);
      setSharedCaps(json.caps || null);
      setSharedLoadFailed(false);
    } catch (err) {
      setSharedLoadFailed(err.message || true);
    }
  }, [canCreate]);

  useEffect(() => {
    loadSharedLinks();
  }, [loadSharedLinks]);

  const sharedFormProblem = sharedForm && sharedLinkProblem(sharedForm);

  function closeSharedForm() {
    setSharedForm(null);
    sharedButtonRef.current?.focus();
  }

  async function createSharedLink(e) {
    e.preventDefault();
    if (sharedFormProblem) return;
    setBusy(true);
    setSharedMsg(null);
    try {
      const res = await fetch("/api/onboarding/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: true, ...sharedForm }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not create the link.");
      const copied = await copyText(json.url);
      const made = json.open
        ? "Always-open link ready"
        : `Link for ${json.maxUses} hotels, open until ${formatDate(json.expiresAt)}`;
      setSharedMsg({
        text: copied ? `${made}, copied.` : `${made}. Select it below and copy it.`,
      });
      closeSharedForm();
      await loadSharedLinks();
    } catch (err) {
      setSharedMsg({ text: err.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function turnOffSharedLink(link) {
    const ok = await dialog.confirm({
      title: "Switch this link off?",
      message: "Nobody else can sign up through it. Hotels already signed up keep their accounts.",
      confirmLabel: "Switch off",
      danger: true,
    });
    if (!ok) return;
    setSwitchingOff(link.id);
    setSharedMsg(null);
    try {
      const res = await fetch(`/api/onboarding/invites?id=${link.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not switch the link off.");
      setSharedMsg({ text: "Link switched off." });
    } catch (err) {
      setSharedMsg({ text: err.message, error: true });
    } finally {
      setSwitchingOff(null);
      await loadSharedLinks();
    }
  }

  async function copyLink(url) {
    setSharedMsg(
      (await copyText(url))
        ? { text: "Link copied." }
        : { text: "Could not copy. Select the link and copy it.", error: true }
    );
  }

  async function createInvite() {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/onboarding/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not create link");
      setSharedForm(null);
      setInvite({ ...json, copied: await copyText(json.url) });
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/properties");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load properties");
      setProperties(json.properties || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(property) {
    if (!property.name?.trim()) {
      setNotice("Property name is required.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const isNew = !property.id;
      const res = await fetch(
        isNew ? "/api/properties/create" : "/api/properties/update",
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(property),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setNotice(isNew ? "Property created." : "Property updated.");
      setForm(null);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-3 text-center">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="sub">Loading properties...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] muted">
            Hotel Operations
          </p>
          <h1 className="h1">Admin</h1>
          <p className="sub">
            Property details and settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="btn btn-secondary"
          >
            Back to Dashboard
          </Link>
          {canCreate && !form && (
            <button
              type="button"
              disabled={busy}
              onClick={createInvite}
              className="btn btn-secondary"
            >
              Onboarding link
            </button>
          )}
          {canCreate && !form && (
            <button
              type="button"
              disabled={busy}
              ref={sharedButtonRef}
              onClick={() => {
                setInvite(null);
                setSharedMsg(null);
                setSharedForm(sharedForm ? null : { open: false, maxUses: "25", days: "30" });
              }}
              aria-expanded={!!sharedForm}
              className="btn btn-secondary"
            >
              Shareable link
            </button>
          )}
          {canCreate && !form && (
            <button
              type="button"
              onClick={() => setForm({ name: "" })}
              className="btn btn-primary"
            >
              + Add property
            </button>
          )}
        </div>
      </div>

      {invite && (
        <div className="card card-pad space-y-2">
          <p className="text-sm text-ink">
            Onboarding link ready{invite.copied ? " and copied" : ""}. Send it to
            the hotel. It works once and expires {formatDate(invite.expiresAt)}.
          </p>
          <input
            readOnly
            value={invite.url}
            onFocus={(e) => e.target.select()}
            className="input"
          />
        </div>
      )}

      {(sharedForm || sharedLinks.length > 0 || sharedMsg || sharedLoadFailed) && (
        <div className="card overflow-hidden">
          {sharedForm && (
            <form
              onSubmit={createSharedLink}
              onKeyDown={(e) => e.key === "Escape" && closeSharedForm()}
              className="space-y-2 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 label">
                  <input
                    type="checkbox"
                    checked={sharedForm.open}
                    onChange={(e) => setSharedForm({ ...sharedForm, open: e.target.checked })}
                  />
                  Always open
                </label>
                {!sharedForm.open && (
                  <>
                    <label className="flex items-center gap-2 label">
                      Hotels
                      <input
                        type="number"
                        min={2}
                        max={200}
                        autoFocus
                        value={sharedForm.maxUses}
                        onChange={(e) => setSharedForm({ ...sharedForm, maxUses: e.target.value })}
                        aria-invalid={sharedFormProblem?.field === "maxUses"}
                        className="input w-20"
                      />
                    </label>
                    <label className="flex items-center gap-2 label">
                      Days open
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={sharedForm.days}
                        onChange={(e) => setSharedForm({ ...sharedForm, days: e.target.value })}
                        aria-invalid={sharedFormProblem?.field === "days"}
                        className="input w-20"
                      />
                    </label>
                  </>
                )}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !!sharedFormProblem} className="btn btn-primary">
                    {busy ? "Creating..." : "Create link"}
                  </button>
                  <button type="button" onClick={closeSharedForm} className="btn btn-ghost">
                    Cancel
                  </button>
                </div>
              </div>
              {sharedFormProblem ? (
                <p className="text-xs text-[var(--danger)]">{sharedFormProblem.text}</p>
              ) : (
                <p className="text-xs muted">
                  {sharedForm.open
                    ? "One link that never expires and has no hotel limit, for your PMS website."
                    : "One link many hotels can sign up through, for your website or a WhatsApp group."}
                  {sharedCaps &&
                    ` At most ${sharedCaps.perConnection} hotels a day from one internet connection, and ${sharedCaps.perDay} a day in all.`}
                </p>
              )}
            </form>
          )}

          {sharedMsg && (
            <p
              role="status"
              className={`px-4 py-2 text-xs ${sharedMsg.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "muted"}`}
            >
              {sharedMsg.text}
            </p>
          )}

          {sharedLoadFailed && (
            <p className="flex items-center gap-2 bg-[var(--danger-soft)] px-4 py-2 text-xs text-[var(--danger)]">
              {typeof sharedLoadFailed === "string" ? sharedLoadFailed : "Could not load shareable links."}
              <button type="button" onClick={loadSharedLinks} className="btn btn-secondary text-xs">
                Try again
              </button>
            </p>
          )}

          {sharedLinks.length > 0 && (
            <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] text-sm">
              {sharedLinks.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                  <span className="min-w-0 flex-1 basis-60 truncate select-all text-xs text-ink" title={link.url}>
                    {link.url}
                  </span>
                  <span className="text-xs muted">
                    {link.open
                      ? `${link.use_count} hotels joined, always open`
                      : `${link.use_count} of ${link.max_uses} hotels joined, open until ${formatDate(link.expires_at)}`}
                  </span>
                  <span className="flex gap-2">
                    <button type="button" onClick={() => copyLink(link.url)} className="btn btn-secondary">
                      Copy
                    </button>
                    <button
                      type="button"
                      disabled={switchingOff === link.id}
                      onClick={() => turnOffSharedLink(link)}
                      className="btn btn-secondary"
                    >
                      {switchingOff === link.id ? "Switching off..." : "Switch off"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="card px-4 py-2 sub">
          {notice}
        </div>
      )}

      {form && (
        <div className="card card-pad">
          <h2 className="mb-3 h2 text-sm">
            {form.id ? `Edit ${form.name}` : "New property"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <Field
                key={f.key}
                field={f}
                readOnly={f.superOnly && !canCreate}
                value={form[f.key]}
                onChange={(k, v) => setForm({ ...form, [k]: v })}
              />
            ))}
          </div>
          <label className="mt-3 block label">
            Description
            <textarea
              rows={2}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
            />
          </label>
          {form.id && (
            <p className="mt-3 text-xs muted">
              Users and their rights are managed in the Users tab.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save(form)}
              className="btn btn-primary"
            >
              {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(null);
                setNotice("");
              }}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Rooms</th>
              <th className="px-4 py-3">Stars</th>
              <th className="px-4 py-3">Check in / out</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id} className="">
                <td className="px-4 py-3">
                  <span className="block text-ink">{p.name}</span>
                  {p.email && (
                    <span className="block text-xs muted">{p.email}</span>
                  )}
                </td>
                <td className="px-4 py-3 muted">
                  {[p.city, p.state, p.country].filter(Boolean).join(", ") || "-"}
                </td>
                <td className="px-4 py-3 muted">{p.total_rooms ?? "-"}</td>
                <td className="px-4 py-3 muted">{p.star_rating ?? "-"}</td>
                <td className="px-4 py-3 muted">
                  {p.check_in_time || "-"} / {p.check_out_time || "-"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(p);
                      setNotice("");
                    }}
                    className="btn btn-secondary text-xs"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {properties.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center sub">
                  No properties yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
