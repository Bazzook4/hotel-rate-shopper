"use client";

import { useCallback, useEffect, useState } from "react";
import { canSwitchProperties } from "@/lib/permissions";

/**
 * Users visible to the signed-in admin. A SuperAdmin sees everyone; a
 * PropertyAdmin sees only their own property's users. The scope is enforced
 * by GET /api/users, not here.
 */
export default function UserList({ session, refreshKey = 0 }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load users");
      setUsers(json.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="card card-pad">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="h2">Users</h3>
          <p className="text-xs muted">
            {canSwitchProperties(session)
              ? "All users across every property."
              : "Users attached to your property."}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn btn-secondary text-xs"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-6 text-center sub">Loading users…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Property</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="">
                  <td className="px-3 py-2 text-ink">{u.email}</td>
                  <td className="px-3 py-2 muted">{u.role}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        u.status === "Active"
                          ? "chip chip-ok"
                          : "chip chip-off"
                      }
                    >
                      {u.status || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 muted">
                    {u.properties?.length
                      ? u.properties.map((p) => p.name || p.id).join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center sub">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
