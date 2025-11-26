import { NextResponse } from 'next/server';
import {
  createRatePlan,
  listRatePlans,
  updateRatePlan,
  deleteRatePlan,
} from '@/lib/database';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.property_id) {
      return NextResponse.json({ ratePlans: [] });
    }

    const ratePlans = await listRatePlans(session.property_id);

    return NextResponse.json({ ratePlans });
  } catch (error) {
    console.error('Error fetching rate plans:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch rate plans' },
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

    if (!session.property_id) {
      return NextResponse.json(
        { error: 'No property associated with user' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { plan_name, multiplier, cost_per_adult, pricing_type, description } = body;

    if (!plan_name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate based on pricing type
    if (pricing_type === 'multiplier' && multiplier === undefined) {
      return NextResponse.json(
        { error: 'Multiplier is required for multiplier-based pricing' },
        { status: 400 }
      );
    }
    if (pricing_type === 'flat' && cost_per_adult === undefined) {
      return NextResponse.json(
        { error: 'Cost per adult is required for flat-rate pricing' },
        { status: 400 }
      );
    }

    const ratePlan = await createRatePlan({
      property_id: session.property_id,
      plan_name,
      multiplier,
      cost_per_adult,
      pricing_type: pricing_type || 'multiplier',
      description,
    });

    return NextResponse.json({ ratePlan }, { status: 201 });
  } catch (error) {
    console.error('Error creating rate plan:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create rate plan' },
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

    const ratePlan = await updateRatePlan(recordId, updates);

    return NextResponse.json({ ratePlan });
  } catch (error) {
    console.error('Error updating rate plan:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update rate plan' },
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

    await deleteRatePlan(recordId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting rate plan:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete rate plan' },
      { status: 500 }
    );
  }
}
