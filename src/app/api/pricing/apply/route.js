import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  listPricingRecommendations,
  listRatePlans,
  listRatePlanRooms,
  saveDailyRates,
  decideRecommendations,
} from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";

/**
 * Accept recommendations and put them into effect.
 *
 * Accepting writes the rate into daily_rates exactly as a manual edit in the
 * Channel Manager does, so there is one path to the OTAs and everything that
 * guards it -- code mapping, activity switches, the stricter-restriction
 * merge -- still applies. Pushing is then the Channel Manager's own route,
 * called rather than reimplemented.
 *
 * Saving before pushing is deliberate, and matches the Channel Manager: a
 * connection failure leaves the accepted rate recorded rather than losing it.
 */
export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Choose at least one rate to apply." }, { status: 400 });
  }

  // Dismissing is a decision too, and needs no rate work.
  if (body?.decision === "dismissed") {
    const updated = await decideRecommendations(propertyId, ids, "dismissed", "manual");
    return NextResponse.json({ dismissed: updated.length });
  }

  let recommendations;
  let ratePlans;
  let planRooms;
  try {
    [recommendations, ratePlans, planRooms] = await Promise.all([
      // Re-read rather than trusting the rates the browser sent: a stale tab
      // must not be able to apply a number the algorithm has since revised.
      listPricingRecommendations(propertyId, "1900-01-01", "2999-12-31"),
      listRatePlans(propertyId),
      listRatePlanRooms(propertyId),
    ]);
  } catch (err) {
    console.error("Pricing apply failed to load:", err.message);
    return NextResponse.json({ error: "Could not load the rates to apply." }, { status: 500 });
  }

  const chosen = recommendations.filter((r) => ids.includes(r.id));
  if (chosen.length === 0) {
    return NextResponse.json(
      { error: "Those recommendations are no longer available. Recalculate and try again." },
      { status: 409 }
    );
  }

  // A room is priced inside a rate plan, so a recommendation for a room
  // becomes a rate on every plan that sells it.
  const plansForRoom = new Map();
  for (const link of planRooms) {
    if (!plansForRoom.has(link.room_type_id)) plansForRoom.set(link.room_type_id, []);
    plansForRoom.get(link.room_type_id).push(link);
  }

  // Derived plans follow their master through the existing derivation, so
  // writing to a derived plan as well would double-apply the difference.
  const masterIds = new Set(
    ratePlans.filter((p) => !p.derive_from_id).map((p) => p.id)
  );

  const rateRows = [];
  const unmapped = [];
  for (const rec of chosen) {
    const links = (plansForRoom.get(rec.room_type_id) || []).filter((l) =>
      masterIds.has(l.rate_plan_id)
    );
    if (links.length === 0) {
      unmapped.push(rec.id);
      continue;
    }
    for (const link of links) {
      // A room is priced per adult, not at one rate, so a recommendation has
      // to move every occupancy the plan sells rather than just the headline
      // one -- otherwise single occupancy keeps its old price and can end up
      // dearer than double.
      //
      // The proposed rate is for the room's full occupancy, so the others
      // keep their existing relationship to it. Scaling preserves the
      // hotelier's own differential instead of imposing a flat one.
      const adultRates = link.adult_rates || {};
      const base = Number(link.full_rate) || null;
      const occupancies = Object.keys(adultRates).length > 0 ? Object.keys(adultRates) : ["2"];

      for (const occ of occupancies) {
        const occRate = Number(adultRates[occ]);
        let rate = Number(rec.recommended_rate);

        if (base && Number.isFinite(occRate) && occRate > 0 && base > 0) {
          rate = Math.round((occRate / base) * Number(rec.recommended_rate));
        }

        rateRows.push({
          rate_plan_id: link.rate_plan_id,
          room_type_id: rec.room_type_id,
          occupancy: Number(occ),
          stay_date: rec.stay_date,
          rate,
        });
      }
    }
  }

  if (rateRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Those rooms are not assigned to a rate plan yet, so there is nothing to price. Assign them in Rate Plan Setup first.",
      },
      { status: 409 }
    );
  }

  try {
    await saveDailyRates(propertyId, rateRows);
  } catch (err) {
    console.error("Pricing apply failed to save rates:", err.message);
    return NextResponse.json({ error: "Could not save the new rates." }, { status: 500 });
  }

  const applied = chosen.filter((r) => !unmapped.includes(r.id)).map((r) => r.id);
  await decideRecommendations(propertyId, applied, "applied", body?.decidedBy || "manual").catch(
    (err) => console.error("Marking recommendations applied failed:", err.message)
  );

  // Push through the Channel Manager's own route, so this feature can never
  // drift from how a manual publish behaves.
  let push = null;
  if (body?.push !== false) {
    try {
      // Grouped one update per date, which is the shape the push route
      // validates and the Channel Manager already sends.
      const byDate = {};
      for (const row of rateRows) {
        (byDate[row.stay_date] ||= []).push({
          roomCode: row.room_type_id,
          rateplanCode: row.rate_plan_id,
          occupancy: row.occupancy,
          rate: Number(row.rate),
        });
      }
      const updates = Object.entries(byDate).map(([date, rates]) => ({
        startDate: date,
        endDate: date,
        rates,
      }));

      const res = await fetch(new URL("/api/cm/push", req.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The push route authenticates the caller like any other request.
          cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify({ kind: "rates", updates, propertyId }),
      });
      push = await res.json().catch(() => null);
      if (!res.ok) {
        // The rates are saved either way, which is the part that must not be
        // lost; the message says so rather than implying nothing happened.
        return NextResponse.json({
          applied: applied.length,
          saved: rateRows.length,
          pushed: false,
          warning:
            push?.error ||
            "The new rates are saved, but could not be sent to your channels. Publish from Rates & Inventory to retry.",
        });
      }
    } catch (err) {
      console.error("Pricing apply push failed:", err.message);
      return NextResponse.json({
        applied: applied.length,
        saved: rateRows.length,
        pushed: false,
        warning:
          "The new rates are saved, but could not be sent to your channels. Publish from Rates & Inventory to retry.",
      });
    }
  }

  return NextResponse.json({
    applied: applied.length,
    saved: rateRows.length,
    pushed: body?.push !== false,
    push,
    skipped: unmapped.length,
  });
}
