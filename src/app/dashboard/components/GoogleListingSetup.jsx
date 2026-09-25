"use client";

import { useEffect, useState } from "react";

/**
 * Where the property tells us which hotel it is on Google.
 *
 * Rate parity reads rates from the hotel's Google listing, and a name alone is
 * ambiguous, so the hotelier pastes the Business / Maps URL. Shared between
 * Property Setup, where it belongs, and the parity page, which prompts for it
 * when it has nothing to look up.
 */
export default function GoogleListingSetup({ propertyId, initialUrl, onSaved, compact = false }) {
  const [url, setUrl] = useState(initialUrl || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);

  // A caller that already holds the value passes it in; one that does not --
  // Property Setup, which has no parity grid to load it -- gets it fetched
  // here rather than duplicating the read.
  useEffect(() => {
    if (initialUrl !== undefined && initialUrl !== null) {
      setUrl(initialUrl);
      return;
    }
    let cancelled = false;
    const params = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    fetch(`/api/parity/property${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.googleBusinessUrl) setUrl(json.googleBusinessUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialUrl, propertyId]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(null);
    try {
      const res = await fetch("/api/parity/property", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, googleBusinessUrl: url }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not save that link.");
        return;
      }
      setSaved(json);
      onSaved?.(json);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-3">
      <div>
        <h3 className="h2">{compact ? "Which hotel should we look up?" : "Google listing"}</h3>
        <p className="sub">
          Rate parity reads what each channel is charging from your hotel&apos;s Google listing.
          Open Google Maps, search for your property, and paste the address from your browser here.
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`google-url-${propertyId || "current"}`}>
          Google Business URL
        </label>
        <input
          id={`google-url-${propertyId || "current"}`}
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.google.com/maps/place/Your+Hotel+Name/..."
        />
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {saved?.googlePlaceQuery && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          Saved. Rates will be looked up for &ldquo;{saved.googlePlaceQuery}&rdquo;.
        </p>
      )}
      {saved && !saved.configured && (
        <p className="sub">Google listing cleared. Rate parity will not run until one is set.</p>
      )}

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : compact ? "Save and continue" : "Save"}
      </button>
    </form>
  );
}
