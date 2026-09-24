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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Users</h3>
          <p className="text-xs text-slate-400">
            {canSwitchProperties(session)
              ? "All users across every property."
              : "Users attached to your property."}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Loading users…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Property</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/10">
                  <td className="px-3 py-2 text-white">{u.email}</td>
                  <td className="px-3 py-2 text-slate-300">{u.role}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        u.status === "Active"
                          ? "rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-300"
                          : "rounded bg-slate-500/20 px-1.5 py-0.5 text-xs text-slate-300"
                      }
                    >
                      {u.status || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {u.properties?.length
                      ? u.properties.map((p) => p.name || p.id).join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">
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
