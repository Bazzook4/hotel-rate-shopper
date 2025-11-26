import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { propertyId } = body;

  if (!propertyId) {
    return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
  }

  // Check if property exists
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .single();

  if (propertyError || !property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // Check if already linked
  const { data: existingLink } = await supabase
    .from('user_properties')
    .select('*')
    .eq('user_id', session.userId)
    .eq('property_id', propertyId)
    .single();

  if (existingLink) {
    return NextResponse.json({
      message: "Property already linked to your account",
      property
    }, { status: 200 });
  }

  // Create the link
  const { error: linkError } = await supabase
    .from('user_properties')
    .insert({
      user_id: session.userId,
      property_id: propertyId,
    });

  if (linkError) {
    console.error('Failed to link property:', linkError);
    return NextResponse.json({ error: "Failed to link property" }, { status: 500 });
  }

  return NextResponse.json({
    message: "Property linked successfully",
    property
  }, { status: 200 });
}
