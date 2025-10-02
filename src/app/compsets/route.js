import { NextResponse } from "next/server";
import { table } from "@/lib/airtable";

export async function POST(req) {
  try {
    const body = await req.json();
    // body: { name, ownerEmail, primaryHotel, competitors: [names], active }
    // Ensure hotels exist or create them quickly by name+query.
    const hotelsTbl = table("Hotels");
    const usersTbl  = table("Users");
    const compsTbl  = table("CompSets");

    // Find / upsert owner
    const owner = await usersTbl.select({
      filterByFormula: `{Email} = '${body.ownerEmail}'`,
      maxRecords: 1,
    }).firstPage().then(r => r[0]);
    const ownerId = owner ? owner.id : (await usersTbl.create([{ fields: { Email: body.ownerEmail } }]))[0].id;

    async function upsertHotel(nameOrObj) {
      const name = typeof nameOrObj === "string" ? nameOrObj : (nameOrObj.name || nameOrObj.query);
      const query = typeof nameOrObj === "string" ? nameOrObj : (nameOrObj.query || name);
      const found = await hotelsTbl.select({
        filterByFormula: `{Name} = '${name.replaceAll("'", "\\'")}'`,
        maxRecords: 1,
      }).firstPage().then(r => r[0]);
      if (found) return found.id;
      const created = await hotelsTbl.create([
        { fields: { Name: name, Query: query, Owner: [ownerId] } }
      ]);
      return created[0].id;
    }

    const primaryId = await upsertHotel(body.primaryHotel);
    const competitorIds = await Promise.all((body.competitors || []).map(upsertHotel));

    const created = await compsTbl.create([{
      fields: {
        Name: body.name || "CompSet",
        "Primary Hotel": [primaryId],
        Competitors: competitorIds,
        Active: !!body.active,
        Owner: [ownerId],
        LastSync: null,
      }
    }]);

    return NextResponse.json({ ok: true, id: created[0].id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}