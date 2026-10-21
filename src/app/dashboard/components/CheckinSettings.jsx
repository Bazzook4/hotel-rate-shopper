"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CHECKIN_PREFS } from "@/lib/onlineCheckinShared";
import Select from "@/app/components/Select";

/**
 * What the hotel asks of guests on online check-in, for Property Setup: on
 * or off, ID from every adult or the main guest only, and which answers are
 * required.
 */

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-1.5 text-sm" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export default function CheckinSettings({ propertyId }) {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  useEffect(() => {
    let cancelled = false;
    setPrefs(null);
    setError("");
    setNotice("");
    fetch(`/api/setup/checkin${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the online check-in settings.");
        if (!cancelled) setPrefs(json.prefs);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setPrefs(DEFAULT_CHECKIN_PREFS);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const set = (patch) => {
    setNotice("");
    setPrefs((p) => ({ ...p, ...patch }));
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/setup/checkin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertyId || undefined, prefs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the online check-in settings.");
      setPrefs(json.prefs);
      setNotice(json.prefs.enabled ? "Saved." : "Saved. Online check-in is off; links already sent stop working.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return (
      <div className="card card-pad">
        <p className="sub">Loading...</p>
      </div>
    );
  }

  const off = !prefs.enabled;

  return (
    <form onSubmit={save} className="card card-pad space-y-3">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="h2">Online check-in</h3>
          <Check checked={prefs.enabled} onChange={(v) => set({ enabled: v })}>
            <span className="font-medium">Turn on</span>
          </Check>
        </div>
        <p className="sub">
          Send guests a link from the booking to fill in their details and upload their ID before they arrive.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <fieldset disabled={off} className="flex flex-wrap items-center gap-x-5 gap-y-2" style={{ opacity: off ? 0.5 : 1 }}>
          <legend className="sr-only">What guests are asked for</legend>
          <label className="flex items-center gap-1.5 text-sm">
            ID from
            <Select
              className="input"
              style={{ width: "auto", padding: "0.25rem 0.5rem" }}
              value={prefs.idFrom}
              onChange={(e) => set({ idFrom: e.target.value })}
            >
              <option value="all">every adult</option>
              <option value="booker">the main guest only</option>
            </Select>
          </label>
          <Check checked={prefs.idPhoto} onChange={(v) => set({ idPhoto: v })}>
            Photo of ID required
          </Check>
          <Check checked={prefs.address} onChange={(v) => set({ address: v })}>
            Address required
          </Check>
          <Check checked={prefs.formC} onChange={(v) => set({ formC: v })}>
            Form C details from foreign guests
          </Check>
        </fieldset>
        <button type="submit" className="btn btn-primary sm:ml-auto" style={{ padding: "0.3rem 0.75rem" }} disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          {notice}
        </p>
      )}
    </form>
  );
}
