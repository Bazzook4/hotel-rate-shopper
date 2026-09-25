"use client";

import { useCallback, useEffect, useState } from "react";

const MAX = 6;

/** "3-star hotel" and 1.2 km, in the words the list shows. */
function describe(entry) {
  const bits = [];
  if (entry.hotel_class || entry.stars) {
    bits.push(entry.hotel_class || `${entry.stars}-star`);
  }
  if (entry.distance_m != null) {
    bits.push(
      entry.distance_m < 1000
        ? `${entry.distance_m} m away`
        : `${(entry.distance_m / 1000).toFixed(1)} km away`
    );
  }
  if (entry.rate != null) bits.push(`from ₹${Math.round(entry.rate).toLocaleString("en-IN")}`);
  return bits.join(" · ");
}

/**
 * Choosing who to compare against.
 *
 * Suggestions come from searching the property's own doorstep rather than a
 * typed-in city, so the hotelier picks from hotels Google already considers
 * nearby and comparable instead of recalling names.
 */
export default function ManageCompetitors({ propertyId, onClose, onSaved }) {
  const [added, setAdded] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`/api/compshopper/competitors${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not load your competitors.");
        return;
      }
      setAdded(json.competitors || []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function findNearby() {
    setSearching(true);
    setError("");
    try {
      const params = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`/api/compshopper/suggest${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not search for nearby hotels.");
        return;
      }
      // Anything already on the list is not offered again.
      const have = new Set(added.map((c) => c.property_token));
      setSuggestions((json.suggestions || []).filter((s) => !have.has(s.property_token)));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  function add(entry) {
    if (added.length >= MAX) {
      setError(`You can track up to ${MAX} competitors. Remove one before adding another.`);
      return;
    }
    setError("");
    setAdded((list) => [
      ...list,
      {
        property_token: entry.property_token,
        name: entry.name,
        address: entry.address,
        hotel_class: entry.hotel_class,
        latitude: entry.latitude,
        longitude: entry.longitude,
        added_via: "suggested",
      },
    ]);
    setSuggestions((list) => list.filter((s) => s.property_token !== entry.property_token));
  }

  function remove(token) {
    setAdded((list) => list.filter((c) => c.property_token !== token));
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/compshopper/competitors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, competitors: added }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not save your competitor list.");
        return;
      }
      onSaved?.(json.competitors || []);
      onClose?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="h2">Manage competitors</h3>
          <p className="sub">
            Track up to {MAX} hotels. {added.length} of {MAX} added.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card card-pad" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        </div>
      )}

      {/* Added */}
      <div className="card card-pad space-y-2">
        <h4 className="label" style={{ marginBottom: 0 }}>
          Added competitors
        </h4>
        {loading ? (
          <p className="sub">Loading…</p>
        ) : added.length === 0 ? (
          <p className="sub">
            None yet. Find the hotels near you below and add the ones you compete with.
          </p>
        ) : (
          added.map((c) => (
            <div
              key={c.property_token}
              className="flex items-start justify-between gap-3"
              style={{ borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                {c.address && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {c.address}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => remove(c.property_token)}
                aria-label={`Remove ${c.name}`}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {/* Suggestions */}
      <div className="card card-pad space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="label" style={{ marginBottom: 0 }}>
              Hotels near you
            </h4>
            <p className="sub">
              Found from your own listing, closest and most comparable first.
            </p>
          </div>
          <button type="button" className="btn" onClick={findNearby} disabled={searching}>
            {searching ? "Searching…" : suggestions.length ? "Search again" : "Find nearby hotels"}
          </button>
        </div>

        {suggestions.map((s) => {
          const full = added.length >= MAX;
          return (
            <div
              key={s.property_token}
              className="flex items-start justify-between gap-3"
              style={{ borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {describe(s) || s.address}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => add(s)}
                disabled={full}
                title={full ? `Remove one to add another (limit ${MAX})` : undefined}
              >
                Add
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
