"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PropertyUsers from "./PropertyUsers";

const inputClass =
  "input mt-1";

const FIELDS = [
  { key: "name", label: "Property name", required: true },
  { key: "star_rating", label: "Star rating", type: "number", min: 1, max: 5 },
  { key: "total_rooms", label: "Total rooms", type: "number", min: 0 },
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

function Field({ field, value, onChange }) {
  return (
    <label className="block label">
      {field.label}
      {field.required && <span className="text-red-400"> *</span>}
      <input
        type={field.type || "text"}
        min={field.min}
        max={field.max}
        value={value ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={inputClass}
      />
    </label>
  );
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

  const canCreate = session?.isSuperAdmin === true;

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
          <p className="sub">Loading properties…</p>
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
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="btn btn-secondary"
          >
            ← Dashboard
          </Link>
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

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
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
          {form.id && <PropertyUsers session={session} property={form} />}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save(form)}
              className="btn btn-primary"
            >
              {busy ? "Saving…" : "Save"}
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
                  {[p.city, p.state, p.country].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 muted">{p.total_rooms ?? "—"}</td>
                <td className="px-4 py-3 muted">{p.star_rating ?? "—"}</td>
                <td className="px-4 py-3 muted">
                  {p.check_in_time || "—"} / {p.check_out_time || "—"}
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
