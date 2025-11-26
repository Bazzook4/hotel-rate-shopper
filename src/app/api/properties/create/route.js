import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const session = await getSessionFromRequest(request);

  // Only admins can create properties
  if (!session || session.role !== "Admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const {
    name,
    address,
    city,
    state,
    country,
    postalCode,
    phone,
    email,
    website,
    description,
    starRating,
    totalRooms
  } = body;

  if (!name) {
    return NextResponse.json({ error: "Property name is required" }, { status: 400 });
  }

  // Create the property
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .insert({
      name,
      address: address || null,
      city: city || null,
      state: state || null,
      country: country || null,
      postal_code: postalCode || null,
      phone: phone || null,
      email: email || null,
      website: website || null,
      description: description || null,
      star_rating: starRating ? parseInt(starRating) : null,
      total_rooms: totalRooms ? parseInt(totalRooms) : null,
    })
    .select()
    .single();

  if (propertyError) {
    console.error('Failed to create property:', propertyError);
    return NextResponse.json({ error: "Failed to create property" }, { status: 500 });
  }

  // Link the property to the current user
  const { error: linkError } = await supabase
    .from('user_properties')
    .insert({
      user_id: session.userId,
      property_id: property.id,
    });

  if (linkError) {
    console.error('Failed to link property to user:', linkError);
    // Continue anyway - property was created
  }

  return NextResponse.json({ property }, { status: 201 });
}
