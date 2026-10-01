import { createClient } from '@supabase/supabase-js';
import { getSessionFromRequest } from '@/lib/session';
import { resolvePropertyId } from '@/lib/propertyScope';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('compsets')
    .insert({
      name: body.hotel || 'Unnamed Compset',
      competitor_hotels: {
        competitors: body.competitors || [],
        lastSync: new Date().toISOString(),
      },
      property_id: propertyId,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
