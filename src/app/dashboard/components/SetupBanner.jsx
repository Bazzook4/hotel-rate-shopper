"use client";

import { useEffect } from "react";
import { SetUpLink, usePageNav } from "@/app/components/PageNav";
import { useReport } from "./reportKit";

// The last answer per property, so coming back to Calendar or Channel Manager
// draws the banner straight away instead of pushing the grid down a moment
// after the page appears.
const lastSetup = new Map();

/**
 * A one-line "Finish setting up" reminder for the pages a new hotel opens
 * first, pointing at the next step on Today's checklist. Shows nothing once
 * every step is done, or to staff who do not manage setup.
 *
 * `skip` lists steps the page's own empty state already asks for, so the
 * two never stack up saying the same thing. Taxes alone never bring it up:
 * a hotel can trade without them, and one that chose to should not find a
 * new box over its Calendar every day. Today's checklist still lists them.
 */
export default function SetupBanner({ session, skip = [] }) {
  const propertyId = session?.propertyId || null;
  const { canOpen } = usePageNav();
  const { report } = useReport("/api/today", propertyId ? { part: "setup" } : null, propertyId);
  const fresh = report ? (report.setup?.error ? null : report.setup) : undefined;
  useEffect(() => {
    if (fresh !== undefined && propertyId) lastSetup.set(propertyId, fresh);
  }, [fresh, propertyId]);
  const setup = fresh !== undefined ? fresh : lastSetup.get(propertyId);
  const next = setup?.steps.find((s) => !s.done);
  // Nothing to say without a way to act on it.
  if (!next || next.id === "taxes" || skip.includes(next.id) || !canOpen(next.page)) return null;

  return (
    <div
      className="mb-3 flex items-center gap-3 rounded-lg px-3 py-2"
      style={{ background: "var(--accent-soft)", border: "1px solid var(--border)" }}
    >
      <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text)" }}>
        <span className="font-medium">
          Setup {setup.done} of {setup.total}: {next.label}.
        </span>
        <span className="hidden md:inline" style={{ color: "var(--text-muted)" }}>
          {" "}
          {next.hint}
        </span>
      </p>
      <SetUpLink page={next.page} className="btn btn-primary text-xs">
        Start
      </SetUpLink>
    </div>
  );
}
