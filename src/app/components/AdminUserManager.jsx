"use client";

import { useEffect, useMemo, useState } from "react";

const roles = [
  { value: "PropertyUser", label: "Property User" },
  { value: "Admin", label: "Admin" },
];

const statuses = [
  { value: "Active", label: "Active" },
  { value: "Suspended", label: "Suspended" },
];

export default function AdminUserManager() {
  const [properties, setProperties] = useState([]);
  const [loadingProps, setLoadingProps] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    email: "",
    password: "",
    role: "PropertyUser",
    status: "Active",
    propertyId: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadProperties() {
      setLoadingProps(true);
      try {
        const res = await fetch("/api/properties");
        if (!res.ok) throw new Error("Failed to load properties");
        const json = await res.json();
        setProperties(json.properties || []);
        if (!form.propertyId && json.properties?.length) {
          setForm((prev) => ({ ...prev, propertyId: json.properties[0].id }));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingProps(false);
      }
    }
    loadProperties();
  }, []);

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const payload = {
        email: form.email,
        password: form.password,
        role: form.role,
        status: form.status,
        propertyId: form.propertyId || null,
      };
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Unable to create user");
      }
      setSuccess(`User ${data.user?.Email || form.email} created.`);
      setForm({ ...form, password: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClasses =
    "w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder-slate-300/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm";

  const disabled = submitting || loadingProps;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)]"
    >
      <div className="space-y-1">
        <span className="text-xs uppercase tracking-[0.4em] text-slate-200/70">Admin</span>
        <h3 className="text-xl font-semibold text-white">Create User</h3>
        <p className="text-xs text-slate-200/70">
          Provision a new login tied to a property. Passwords are stored hashed automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
            Email
          </span>
          <input
            type="email"
            className={inputClasses}
            value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            required
            disabled={disabled}
            placeholder="guest@example.com"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
            Password
          </span>
          <input
            type="password"
            className={inputClasses}
            value={form.password}
            onChange={(e) => onChange("password", e.target.value)}
            required
            disabled={disabled}
            placeholder="Temporary password"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
            Role
          </span>
          <select
            className={`${inputClasses} pr-8 appearance-none`}
            value={form.role}
            onChange={(e) => onChange("role", e.target.value)}
            disabled={disabled}
          >
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
            Status
          </span>
          <select
            className={`${inputClasses} pr-8 appearance-none`}
            value={form.status}
            onChange={(e) => onChange("status", e.target.value)}
            disabled={disabled}
          >
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70">
            Property
          </span>
          <select
            className={`${inputClasses} pr-8 appearance-none`}
            value={form.propertyId}
            onChange={(e) => onChange("propertyId", e.target.value)}
            disabled={disabled || loadingProps}
            required
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.Name || property.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          {success}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400 disabled:opacity-50 disabled:shadow-none"
        >
          {submitting ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}
