import { NextResponse } from 'next/server';
import {
  getDynamicPricingHotelById,
  updateDynamicPricingHotel,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(request, { params }) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { hotelId } = await params;
    const hotel = await getDynamicPricingHotelById(hotelId);

    if (!hotel) {
      return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
    }

    return NextResponse.json({ hotel });
  } catch (error) {
    console.error('Error fetching hotel:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch hotel' },
      { status: 500 }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { hotelId } = await params;
    const body = await request.json();

    const hotel = await getDynamicPricingHotelById(hotelId);
    if (!hotel) {
      return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
    }

    const updatedHotel = await updateDynamicPricingHotel(hotel.id, body);

    return NextResponse.json({ hotel: updatedHotel });
  } catch (error) {
    console.error('Error updating hotel:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update hotel' },
      { status: 500 }
    );
  }
}
