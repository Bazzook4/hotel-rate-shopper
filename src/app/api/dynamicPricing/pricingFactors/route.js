import { NextResponse } from 'next/server';
import {
  createOrUpdatePricingFactors,
  getPricingFactors,
} from '@/lib/database';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hotelId = searchParams.get('hotelId');

    if (!hotelId) {
      return NextResponse.json(
        { error: 'hotelId is required' },
        { status: 400 }
      );
    }

    const factors = await getPricingFactors(hotelId);

    return NextResponse.json({ factors });
  } catch (error) {
    console.error('Error fetching pricing factors:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pricing factors' },
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
    const { hotelId, ...factors } = body;

    if (!hotelId) {
      return NextResponse.json(
        { error: 'hotelId is required' },
        { status: 400 }
      );
    }

    const pricingFactors = await createOrUpdatePricingFactors(hotelId, factors);

    return NextResponse.json({ factors: pricingFactors });
  } catch (error) {
    console.error('Error saving pricing factors:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save pricing factors' },
      { status: 500 }
    );
  }
}
