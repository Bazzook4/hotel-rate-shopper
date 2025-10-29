import { NextResponse } from 'next/server';
import {
  createRoomType,
  listRoomTypes,
  updateRoomType,
  deleteRoomType,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.propertyId) {
      return NextResponse.json({ roomTypes: [] });
    }

    const roomTypes = await listRoomTypes(session.propertyId);

    return NextResponse.json({ roomTypes });
  } catch (error) {
    console.error('Error fetching room types:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch room types' },
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

    if (!session.propertyId) {
      return NextResponse.json(
        { error: 'No property associated with user' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { roomTypeName, basePrice, numberOfRooms, maxAdults, description, amenities } = body;

    if (!roomTypeName || !basePrice || !numberOfRooms) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const roomType = await createRoomType({
      propertyId: session.propertyId,
      roomTypeName,
      basePrice,
      numberOfRooms,
      maxAdults,
      description,
      amenities,
    });

    return NextResponse.json({ roomType }, { status: 201 });
  } catch (error) {
    console.error('Error creating room type:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create room type' },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { recordId, ...updates } = body;

    if (!recordId) {
      return NextResponse.json(
        { error: 'recordId is required' },
        { status: 400 }
      );
    }

    const roomType = await updateRoomType(recordId, updates);

    return NextResponse.json({ roomType });
  } catch (error) {
    console.error('Error updating room type:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update room type' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('recordId');

    if (!recordId) {
      return NextResponse.json(
        { error: 'recordId is required' },
        { status: 400 }
      );
    }

    await deleteRoomType(recordId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting room type:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete room type' },
      { status: 500 }
    );
  }
}
