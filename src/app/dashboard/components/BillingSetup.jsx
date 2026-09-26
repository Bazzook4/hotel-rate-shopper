"use client";

import { useCallback, useEffect, useState } from "react";
import ServicesSetup from "./ServicesSetup";
import TaxSetup from "./TaxSetup";
import { Loading, Messages } from "./SetupGrid";

/**
 * The Services Setup and Tax Setup pages.
 *
 * Two pages, one loader. They are set up separately, but each needs the
 * other's data: a service shows which taxes it carries, and a tax shows which
 * services it is charged on. So both load the same thing here and render one
 * panel or the other, the way PropertySetup renders rooms or plans.
 */

const PAGES = {
  services: {
    title: "Services Setup",
    sub: "Everything a stay is billed for is a service — the room itself, breakfast, a pickup — grouped into categories. Each service carries its own taxes, set up under Tax Setup.",
  },
  taxes: {
    title: "Tax Setup",
    sub: "The tax and fee rules, and the services each is charged on. A rule attached to no service charges nothing.",
  },
};

export default function BillingSetup({ session, only = "services" }) {
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

  if (loading && data.services.length === 0) return <Loading />;

  const Panel = only === "taxes" ? TaxSetup : ServicesSetup;
  return (
    <div className="space-y-4">
      {error && <Messages error={error} />}
      <Panel
        propertyId={propertyId}
        data={data}
        onChanged={load}
        title={PAGES[only].title}
        sub={PAGES[only].sub}
      />
    </div>
  );
}
