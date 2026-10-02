import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  deleteWorkflowRule,
  getWorkflowRule,
  listRatePlanRooms,
  listRatePlans,
  listRoomTypes,
  listWorkflowRules,
  saveWorkflowRule,
} from "@/lib/database";
import { resolveChannelManager } from "@/lib/cmResolver";
import { CHANNEL_LABELS, channelLabel } from "@/lib/channels";
import { plansForRoom } from "@/lib/ratePlanPricing";
import { METRICS, runWorkflows } from "@/lib/workflow";

/**
 * Workflow rules: list, add, change and delete.
 *
 * Every change is followed by a check of every rule over the year ahead, so
 * a new rule closes what it should at once, and a rule switched off or
 * deleted reopens what it had closed.
 */

const PAGE = "workflow";

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** The channels a rule can name: the hotel's rate channels in Aiosell. */
async function rateChannels(session, propertyId) {
  try {
    const { client, ready } = await resolveChannelManager(session, { propertyId });
    if (ready) {
      const details = await client.getPropertyDetails();
      const slugs = [
        ...new Set(
          (details?.connected_channels || [])
            .filter((c) => c.operation === "rates" && c.partner_id)
            .map((c) => c.partner_id)
        ),
      ];
      if (slugs.length) return { slugs, live: true };
    }
  } catch (err) {
    console.error("Could not read connected channels", err);
  }
  // Not connected, or Aiosell did not answer: the channels we know by name,
  // so a rule can still be set up before the connection goes live.
  return { slugs: Object.keys(CHANNEL_LABELS), live: false };
}

/** A problem with a rule as sent, or null. Fills in the clean values. */
function validate(input, { roomTypes, ratePlans }) {
  const rule = {};
  rule.name = String(input.name || "").trim();
  if (!rule.name) return { error: "Give the rule a name." };

  rule.enabled = input.enabled !== false;
  rule.action = "stop_sell";

  rule.room_type_id = input.room_type_id || null;
  if (rule.room_type_id && !roomTypes.some((r) => r.id === rule.room_type_id)) {
    return { error: "That room type is not this property's." };
  }

  rule.metric = input.metric;
  if (!METRICS[rule.metric]) return { error: "Choose what the rule counts." };

  const t = Number(input.threshold);
  if (input.threshold === "" || input.threshold === null || !Number.isFinite(t)) {
    return { error: "Give the number the rule acts at." };
  }
  if (rule.metric === "occupancy") {
    if (t <= 0 || t > 100) return { error: "Occupancy is a percentage from 1 to 100." };
  } else {
    if (!Number.isInteger(t)) return { error: "Rooms are counted in whole numbers." };
    if (rule.metric === "sold" && t < 1) return { error: "Rooms sold must be at least 1." };
    if (t < 0) return { error: "Rooms left cannot be negative." };
  }
  rule.threshold = t;

  const channels = Array.isArray(input.channels)
    ? [...new Set(input.channels.map((c) => String(c).trim()).filter(Boolean))]
    : [];
  if (!channels.length) return { error: "Choose at least one channel to stop selling on." };
  rule.channels = channels;

  if (Array.isArray(input.rate_plan_ids) && input.rate_plan_ids.length) {
    const ids = [...new Set(input.rate_plan_ids)];
    if (!ids.every((id) => ratePlans.some((p) => p.id === id))) {
      return { error: "One of those rate plans is not this property's." };
    }
    rule.rate_plan_ids = ids;
  } else {
    rule.rate_plan_ids = null;
  }

  if (input.within_days === null || input.within_days === undefined || input.within_days === "") {
    rule.within_days = null;
  } else {
    const d = Number(input.within_days);
    if (!Number.isInteger(d) || d < 1 || d > 365) {
      return { error: "Nights ahead must be a whole number from 1 to 365." };
    }
    rule.within_days = d;
  }

  return { rule };
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const [rules, roomTypes, ratePlans, assignments, channels] = await Promise.all([
      listWorkflowRules(propertyId),
      listRoomTypes(propertyId),
      listRatePlans(propertyId),
      listRatePlanRooms(propertyId).catch(() => []),
      rateChannels(session, propertyId),
    ]);

    // A channel a rule names stays listed even if it was disconnected since,
    // so the rule can still be read and changed.
    const slugs = [...new Set([...channels.slugs, ...rules.flatMap((r) => r.channels || [])])];

    return NextResponse.json({
      rules,
      roomTypes: roomTypes.map((r) => ({
        id: r.id,
        name: r.room_type_name,
        plans: plansForRoom(ratePlans, r.id, assignments).map((p) => p.id),
      })),
      ratePlans: ratePlans.map((p) => ({ id: p.id, name: p.plan_name })),
      channels: slugs.map((slug) => ({ slug, label: channelLabel(slug) })),
      channelsLive: channels.live,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Create (POST) or change (PUT) a rule, then check every rule. */
async function save(req, method) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const body = await readBody(req);
  if (!body?.rule) return NextResponse.json({ error: "No rule supplied" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    if (method === "PUT") {
      const current = body.rule.id ? await getWorkflowRule(body.rule.id) : null;
      if (!current || current.property_id !== propertyId) {
        return NextResponse.json({ error: "That rule could not be found." }, { status: 404 });
      }
    }

    const [roomTypes, ratePlans] = await Promise.all([
      listRoomTypes(propertyId),
      listRatePlans(propertyId),
    ]);
    const checked = validate(body.rule, { roomTypes, ratePlans });
    if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });

    const saved = await saveWorkflowRule(
      propertyId,
      method === "PUT" ? { ...checked.rule, id: body.rule.id } : checked.rule,
      session.userId
    );
    const result = await runWorkflows(propertyId);
    return NextResponse.json({ rule: saved, result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  return save(req, "POST");
}

export async function PUT(req) {
  return save(req, "PUT");
}

/**
 * Delete a rule. It is switched off and the rules checked first, so every
 * channel it closed is reopened and sent before it goes.
 */
export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const current = id ? await getWorkflowRule(id) : null;
    if (!current || current.property_id !== propertyId) {
      return NextResponse.json({ error: "That rule could not be found." }, { status: 404 });
    }

    await saveWorkflowRule(propertyId, { id, enabled: false });
    // A failed send still deletes: the reopening is saved either way, and
    // the result's message tells the page the channels did not hear of it.
    const result = await runWorkflows(propertyId);
    await deleteWorkflowRule(propertyId, id);
    return NextResponse.json({ deleted: true, result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
