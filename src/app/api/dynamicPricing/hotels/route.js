import { NextResponse } from 'next/server';
import {
  createDynamicPricingHotel,
  listDynamicPricingHotels,
  listRoomTypes,
  listRatePlans,
  createRoomType,
  createRatePlan,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId');

    const hotels = await listDynamicPricingHotels({
      propertyId: propertyId || session.propertyId,
    });

    return NextResponse.json({ hotels });
  } catch (error) {
    console.error('Error fetching dynamic pricing hotels:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch hotels' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { templateName, hotelName, location, copyFromTemplateId } = body;

    if (!hotelName || !location) {
      return NextResponse.json(
        { error: 'Hotel name and location are required' },
        { status: 400 }
      );
    }

    const hotel = await createDynamicPricingHotel({
      templateName: templateName || hotelName,
      hotelName,
      location,
      propertyId: session.propertyId,
      copyFromTemplateId,
    });

    // If copying from an existing template, copy room types and rate plans
    if (copyFromTemplateId) {
      try {
        const [roomTypes, ratePlans] = await Promise.all([
          listRoomTypes(copyFromTemplateId),
          listRatePlans(copyFromTemplateId),
        ]);

        // Copy room types
        await Promise.all(
          roomTypes.map(room =>
            createRoomType({
              hotelId: hotel.hotelId,
              roomTypeName: room.roomTypeName,
              basePrice: room.basePrice,
              numberOfRooms: room.numberOfRooms,
              description: room.description,
              amenities: room.amenities,
            })
          )
        );

        // Copy rate plans
        await Promise.all(
          ratePlans.map(plan =>
            createRatePlan({
              hotelId: hotel.hotelId,
              planName: plan.planName,
              multiplier: plan.multiplier,
              description: plan.description,
            })
          )
        );
      } catch (copyError) {
        console.error('Error copying template data:', copyError);
        // Continue even if copying fails - hotel is still created
      }
    }

    return NextResponse.json({ hotel }, { status: 201 });
  } catch (error) {
    console.error('Error creating hotel:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create hotel' },
      { status: 500 }
    );
  }
}
