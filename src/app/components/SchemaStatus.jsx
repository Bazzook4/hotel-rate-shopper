"use client";

import { useEffect, useState } from "react";

/**
 * Warns when the deployed code expects columns the database does not have
 * yet. Code ships on push; migrations are applied by hand, so the two can
 * drift and the symptom is otherwise a cryptic "column does not exist".
 */
export default function SchemaStatus() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/schema")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setState(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.ok) return null;

  return (
    <div className="rounded-2xl border border-[var(--warn)] bg-[var(--warn-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--warn)]">
        {state.migrations.length === 1
          ? "One migration has not been run"
          : `${state.migrations.length} migrations have not been run`}
      </p>
      <p className="mt-1 text-xs text-[var(--warn)]">
        The deployed app expects database columns that do not exist yet. Run
        these from supabase/migrations in order, then reload:
      </p>
      <ul className="mt-2 space-y-1">
        {state.migrations.map((m) => (
          <li key={m} className="text-xs text-[var(--warn)]">
            <code className="rounded bg-black/30 px-1.5 py-0.5">{m}.sql</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
