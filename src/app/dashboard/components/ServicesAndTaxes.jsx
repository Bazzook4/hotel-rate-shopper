"use client";

import { useCallback, useEffect, useState } from "react";
import ServicesSetup from "./ServicesSetup";
import TaxSetup from "./TaxSetup";

/**
 * The Services & Taxes page: what the hotel bills for, and how each is taxed.
 *
 * One page because the two are one decision. A tax charges nothing until it
 * is attached to a service, and a service's price means little without the
 * tax that goes with it, so the hotelier sets both up looking at both. The
 * data is loaded once here and handed to each panel, so ticking a tax on a
 * service shows up in the tax list's "charged on" at the same moment.
 */
export default function ServicesAndTaxes({ session }) {
  const propertyId = session?.propertyId || null;

  const [data, setData] = useState({ categories: [], services: [], taxes: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const res = await fetch(`/api/pms/services${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load services");
      setData({
        categories: body.categories || [],
        services: body.services || [],
        taxes: body.taxes || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">Services &amp; Taxes</h2>
        <p className="sub">
          Everything a stay is billed for is a service — the room itself,
          breakfast, a pickup — grouped into categories. Each service carries
          its own taxes.
        </p>
      </div>

      {error && (
        <div
          className="card card-pad text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {loading && data.services.length === 0 ? (
        <p className="sub">Loading…</p>
      ) : (
        <>
          <ServicesSetup propertyId={propertyId} data={data} onChanged={load} />
          <TaxSetup propertyId={propertyId} data={data} onChanged={load} />
        </>
      )}
    </div>
  );
}
