import { NextResponse } from 'next/server';
import { getPropertyById, updateProperty } from '@/lib/database';
import { getSessionFromRequest } from '@/lib/session';

/**
 * GET /api/dynamicPricing/property
 * Returns the user's property for dynamic pricing
 */
export async function GET(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.propertyId) {
      return NextResponse.json({ property: null });
    }

    const property = await getPropertyById(session.propertyId);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    return NextResponse.json({ property });
  } catch (error) {
    console.error('Error fetching property:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch property' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/dynamicPricing/property
 * Updates the user's property details
 */
export async function PATCH(request) {
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
    const { Name, Location, ...otherFields } = body;

    const updates = {};
    if (Name) updates.Name = Name;
    if (Location) updates.Location = Location;
    Object.assign(updates, otherFields);

    const updatedProperty = await updateProperty(session.propertyId, updates);

    return NextResponse.json({ property: updatedProperty });
  } catch (error) {
    console.error('Error updating property:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update property' },
      { status: 500 }
    );
  }
}
