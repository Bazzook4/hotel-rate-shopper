"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PropertyAdmin from "../components/PropertyAdmin";
import UserList from "../components/UserList";
import PartnerSettings from "../components/PartnerSettings";
import SchemaStatus from "../components/SchemaStatus";
import ThemeToggle from "../components/ThemeToggle";
import { isAnyAdmin, isSuperAdmin } from "@/lib/permissions";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("properties");

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        // Both admin tiers reach this page; a PropertyAdmin edits only their
        // own property, which the API enforces.
        if (!data.user || !isAnyAdmin(data.user)) {
          router.push("/");
          return;
        }
        if (!cancelled) setSession(data.user);
      } catch {
        router.push("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center ">
        <div className="space-y-3 text-center">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="sub">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <main className="relative min-h-screen ">
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="h1">Admin</h1>
          <ThemeToggle />
        </div>
        {isSuperAdmin(session) && <SchemaStatus />}
        <div className="flex gap-2">
          {[
            ["properties", "Properties"],
            ["users", "Users"],
            ...(isSuperAdmin(session) ? [["partners", "Partners"]] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                tab === id
                  ? "bg-white/15 text-ink"
                  : "muted hover:bg-[var(--surface-2)] hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "properties" && <PropertyAdmin session={session} />}
        {tab === "users" && <UserList session={session} />}
        {tab === "partners" && isSuperAdmin(session) && <PartnerSettings />}
      </div>
    </main>
  );
}
