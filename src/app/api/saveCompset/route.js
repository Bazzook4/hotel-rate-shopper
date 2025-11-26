import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  const body = await req.json();

  const { data, error } = await supabase
    .from('compsets')
    .insert({
      name: body.hotel || 'Unnamed Compset',
      competitor_hotels: {
        competitors: body.competitors || [],
        lastSync: new Date().toISOString(),
      },
      property_id: body.propertyId || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
