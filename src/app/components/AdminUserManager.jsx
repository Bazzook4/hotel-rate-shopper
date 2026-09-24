"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { assignableRoles } from "@/lib/permissions";
import UserList from "./UserList";

const statuses = [
  { value: "Active", label: "Active" },
  { value: "Suspended", label: "Suspended" },
];

const availableModules = [
  { id: "cm", label: "Channel Manager", icon: "", description: "Rates and inventory to OTAs" },
  { id: "compshopper", label: "Comp Shopper", icon: "", description: "Comp set rate comparison" },
  { id: "parity", label: "Rate Parity", icon: "", description: "OTA spread analysis" },
  { id: "location", label: "Search by Location", icon: "", description: "Location-based search" },
  { id: "pricing", label: "Dynamic Pricing", icon: "", description: "Smart pricing optimization" },
  { id: "setup", label: "Property Setup", icon: "", description: "Room types and rate plans" },
];

export default function AdminUserManager({ session }) {
  const roles = useMemo(() => assignableRoles(session), [session]);
  // Bumped after a user is created so the list below reloads.
  const [userRefresh, setUserRefresh] = useState(0);
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
    modules: [], // Selected module IDs
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
        // A PropertyAdmin may only create users within their own property.
        if (!canSwitchProperties(session) && session?.propertyId) {
          setForm((prev) => ({ ...prev, propertyId: session.propertyId }));
        } else if (!form.propertyId && json.properties?.length) {
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

  const toggleModule = (moduleId) => {
    setForm((prev) => {
      const modules = prev.modules.includes(moduleId)
        ? prev.modules.filter(id => id !== moduleId)
        : [...prev.modules, moduleId];
      return { ...prev, modules };
    });
  };

  const selectAllModules = () => {
    setForm((prev) => ({ ...prev, modules: availableModules.map(m => m.id) }));
  };

  const deselectAllModules = () => {
    setForm((prev) => ({ ...prev, modules: [] }));
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
        modules: form.modules,
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
      setSuccess(`User ${data.user?.Email || form.email} created with ${form.modules.length} module(s).`);
      setUserRefresh((n) => n + 1);
      setForm({ email: "", password: "", role: "PropertyUser", status: "Active", propertyId: form.propertyId, modules: [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClasses =
    "input";

  const disabled = submitting || loadingProps;

  return (
    <div className="space-y-5">
    <form
      onSubmit={onSubmit}
      className="space-y-5 card card-pad"
    >
      <div className="space-y-1">
        <span className="text-xs uppercase tracking-[0.4em] text-ink/70">Admin</span>
        <h3 className="h2">Create User</h3>
        <p className="text-xs text-ink/70">Provision a new login tied to a property. Passwords are stored hashed automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Email
          </span>
          <input
            type="email"className={inputClasses}
            value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            required
            disabled={disabled}
            placeholder="guest@example.com"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Password
          </span>
          <input
            type="password"className={inputClasses}
            value={form.password}
            onChange={(e) => onChange("password", e.target.value)}
            required
            disabled={disabled}
            placeholder="Temporary password"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Role
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
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Status
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
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Property
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

      {/* Module Permissions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">Module Access
            </span>
            <p className="text-xs muted mt-1">Select which modules this user can access
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"onClick={selectAllModules}
              disabled={disabled}
              className="text-xs text-[var(--accent-text)] hover:text-[var(--accent-text)] transition-colors disabled:opacity-50"
            >Select All
            </button>
            <span className="text-slate-600">|</span>
            <button
              type="button"onClick={deselectAllModules}
              disabled={disabled}
              className="text-xs muted hover:muted transition-colors disabled:opacity-50"
            >Clear All
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {availableModules.map((module) => (
            <label
              key={module.id}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                form.modules.includes(module.id)
                  ? "border-[var(--accent)] bg-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"checked={form.modules.includes(module.id)}
                onChange={() => toggleModule(module.id)}
                disabled={disabled}
                className="mt-0.5 w-4 h-4 rounded border-white/20 bg-[var(--surface-2)] text-[var(--accent-text)] focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base">{module.icon}</span>
                  <span className="text-sm font-medium text-ink">{module.label}</span>
                </div>
                <p className="text-xs muted mt-0.5">{module.description}</p>
              </div>
            </label>
          ))}
        </div>

        {form.modules.length === 0 && (
          <div className="rounded-xl border border-amber-300/40 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">No modules selected - user will not be able to access any features
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-xs text-[var(--accent-text)]">
          {success}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"disabled={disabled}
          className="rounded-2xl px-4 py-2 h2 text-sm  transition   disabled:opacity-50 "
        >
          {submitting ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>

    <UserList session={session} refreshKey={userRefresh} />
    </div>
  );
}
