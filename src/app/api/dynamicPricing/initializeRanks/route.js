import { NextResponse } from 'next/server';
import { listRoomTypes, updateRoomType } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/session';

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

    console.log(`Initializing ranks for property: ${session.propertyId}`);
    const roomTypes = await listRoomTypes(session.propertyId);

    console.log(`Found ${roomTypes.length} room types`);

    // Assign ranks based on current order
    const updatePromises = roomTypes.map((room, index) => {
      const rank = index + 1;
      console.log(`Setting rank ${rank} for: ${room.roomTypeName}`);
      return updateRoomType(room.id, { rank });
    });

    await Promise.all(updatePromises);

    console.log('All room types have been assigned ranks!');

    // Return updated room types
    const updatedRooms = await listRoomTypes(session.propertyId);
    const sorted = updatedRooms.sort((a, b) => (a.rank || 999) - (b.rank || 999));

    return NextResponse.json({
      success: true,
      message: `Successfully initialized ranks for ${roomTypes.length} room types`,
      roomTypes: sorted,
    });

  } catch (error) {
    console.error('Error initializing ranks:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to initialize ranks' },
      { status: 500 }
    );
  }
}
