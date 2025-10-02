"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton({ className = "" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // ignore, we'll still redirect
    } finally {
      setLoading(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={loading}
      className={`w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:bg-white/20 disabled:opacity-50 ${className}`}
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
