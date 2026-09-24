"use client";

import { useCallback, useEffect, useState } from "react";
import { ROLES, assignableRoles, isSuperAdmin } from "@/lib/permissions";

const MODULES = [
  { id: "cm", label: "Channel Manager" },
  { id: "compshopper", label: "Comp Shopper" },
  { id: "parity", label: "Rate Parity" },
  { id: "location", label: "Search by Location" },
  { id: "pricing", label: "Dynamic Pricing" },
  { id: "setup", label: "Property Setup" },
];

const STATUSES = ["Active", "Suspended"];

const inputClass =
  "input mt-1";

/** Users attached to one property, editable in place. */
export default function PropertyUsers({ session, property }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);

  // Super admins are software team, not property staff, so the role is not
  // offered here even to someone who could otherwise assign it.
  const roles = assignableRoles(session).filter(
    (r) => r.value !== ROLES.SUPER_ADMIN
  );
  const canAdd = session?.role && roles.length > 0;

  const load = useCallback(async () => {
    if (!property?.id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/users?propertyId=${encodeURIComponent(property.id)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load users");
      setUsers(json.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [property?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveUser(user) {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          role: user.role,
          status: user.status,
          modules: user.modules || [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Update failed");
      setNotice(`${user.email} updated.`);
      setEditing(null);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addUser(draft) {
    if (!draft.email?.trim() || !draft.password) {
      setNotice("Email and password are required.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: draft.email.trim(),
          password: draft.password,
          role: draft.role,
          status: "Active",
          propertyId: property.id,
          modules: draft.modules || [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not create user");
      setNotice(`${draft.email} added to ${property.name}.`);
      setAdding(null);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleModule(target, setTarget, moduleId) {
    const current = target.modules || [];
    setTarget({
      ...target,
      modules: current.includes(moduleId)
        ? current.filter((m) => m !== moduleId)
        : [...current, moduleId],
    });
  }

  if (!property?.id) return null;

  return (
    <div className="mt-4 card card-pad">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="h2 text-sm">Users at {property.name}
          </h3>
          <p className="text-xs muted">Role, status and module access for this property.
          </p>
        </div>
        {canAdd && !adding && (
          <button
            type="button"onClick={() =>setAdding({
                email: "",
                password: "",
                role: roles[roles.length - 1].value,
                modules: [],
              })
            }
            className="btn btn-primary text-xs"
          >
            + Add user
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 card px-3 py-2 sub">
          {notice}
        </p>
      )}

      {adding && (
        <div className="mb-3 card p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block label">Email
              <input
                type="email"value={adding.email}
                onChange={(e) => setAdding({ ...adding, email: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block label">Password
              <input
                type="password"value={adding.password}
                onChange={(e) => setAdding({ ...adding, password: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block label">Role
              <select
                value={adding.role}
                onChange={(e) => setAdding({ ...adding, role: e.target.value })}
                className={inputClass}
              >
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ModulePicker
            selected={adding.modules}
            onToggle={(m) => toggleModule(adding, setAdding, m)}
          />

          <div className="mt-3 flex gap-2">
            <button
              type="button"disabled={busy}
              onClick={() => addUser(adding)}
              className="btn btn-primary"
            >
              {busy ? "Adding…" : "Add user"}
            </button>
            <button
              type="button"onClick={() => setAdding(null)}
              className="btn btn-secondary"
            >Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center sub">Loading users…</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) =>editing?.id === u.id ? (
              <div
                key={u.id}
                className="card p-3"
              >
                <p className="mb-2 text-sm text-ink">{u.email}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block label">Role
                    <select
                      value={editing.role}
                      onChange={(e) =>setEditing({ ...editing, role: e.target.value })
                      }
                      className={inputClass}
                    >
                      {roles.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block label">Status
                    <select
                      value={editing.status || "Active"}
                      onChange={(e) =>setEditing({ ...editing, status: e.target.value })
                      }
                      className={inputClass}
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <ModulePicker
                  selected={editing.modules}
                  onToggle={(m) => toggleModule(editing, setEditing, m)}
                />

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"disabled={busy}
                    onClick={() => saveUser(editing)}
                    className="btn btn-primary"
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"onClick={() => setEditing(null)}
                    className="btn btn-secondary"
                  >Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 card px-3 py-2"
              >
                <div>
                  <span className="text-sm text-ink">{u.email}</span>
                  <span className="ml-2 text-xs muted">
                    {u.role} · {u.status || "Active"} ·{" "}
                    {u.modules?.length
                      ? `${u.modules.length} module${u.modules.length === 1 ? "" : "s"}`
                      : "no modules"}
                  </span>
                </div>
                <button
                  type="button"onClick={() => {
                    setEditing({ ...u, modules: u.modules || [] });
                    setNotice("");
                  }}
                  className="btn btn-secondary text-xs"
                >Edit
                </button>
              </div>
            )
          )}
          {users.length === 0 && (
            <p className="py-4 text-center sub">No users at this property yet.
            </p>
          )}
        </div>
      )}

      {!isSuperAdmin(session) && (
        <p className="mt-3 text-[11px] faint">Only a super admin can move a user to a different property.
        </p>
      )}
    </div>
  );
}

function ModulePicker({ selected = [], onToggle }) {
  return (
    <div className="mt-3">
      <p className="mb-1 label">Module access</p>
      <div className="flex flex-wrap gap-2">
        {MODULES.map((m) => {
          const on = selected.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"onClick={() => onToggle(m.id)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${
                on
                  ? "bg-white/20 text-ink ring-1 ring-white/30"
                  : "bg-[var(--surface)] muted hover:bg-[var(--surface-2)]"
              }`}
            >
              {on ? " " : ""}
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
