import Airtable from "airtable";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export async function POST(req) {
  const body = await req.json();

  const record = await base("CompSets").create([
    {
      fields: {
        Hotel: body.hotel,
        Competitors: body.competitors.join(", "),
        LastSync: new Date().toISOString(),
      },
    },
  ]);

  return Response.json(record);
}