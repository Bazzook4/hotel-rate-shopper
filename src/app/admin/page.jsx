"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PropertyAdmin from "../components/PropertyAdmin";
import UserList from "../components/UserList";
import PartnerSettings from "../components/PartnerSettings";
import SchemaStatus from "../components/SchemaStatus";
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="space-y-3 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <main className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-purple-500/20 blur-3xl" />
      </div>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
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
                  ? "bg-white/15 text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
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
