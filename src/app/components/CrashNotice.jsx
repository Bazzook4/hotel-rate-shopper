"use client";

import { useEffect, useState } from "react";
import { isStaleBuildError, reloadForNewRelease } from "@/lib/staleBuild";

/**
 * What a hotelier sees when a page breaks, instead of a blank error screen.
 * A tab from an older release reloads itself; anything else offers Reload.
 */
export default function CrashNotice({ error, onRetry }) {
  const stale = isStaleBuildError(error);
  const [reloading, setReloading] = useState(stale);

  useEffect(() => {
    if (error) console.error(error);
    if (stale && !reloadForNewRelease()) setReloading(false);
  }, [error, stale]);

  if (reloading) {
    return (
      <div className="card" style={{ padding: 16, color: "var(--text-muted)" }}>
        Loading the latest version...
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, color: "var(--text)" }}>This page could not open</div>
      <p style={{ margin: "6px 0 12px", color: "var(--text-muted)" }}>
        {stale
          ? "A new version of the app is out. Reload to get it."
          : "Something went wrong on this page. Nothing you saved is lost. Reload to try again."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        {onRetry && !stale && (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
