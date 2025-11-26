import { NextResponse } from 'next/server';
import {
  getPropertyById,
  listRoomTypes,
  listRatePlans,
  getPricingFactors,
  createPricingSnapshot,
} from '@/lib/database';
import { calculateDynamicPrice, calculateWeeklyPrices, calculateRevenueMetrics, formatPricingForExport } from '@/lib/pricingEngine';
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

    const body = await request.json();
    const {
      checkInDate,
      checkOutDate,
      currentOccupancy,
      includeCompetitors = false,
    } = body;

    if (!checkInDate || !checkOutDate) {
      return NextResponse.json(
        { error: 'Missing required fields: checkInDate, checkOutDate' },
        { status: 400 }
      );
    }

    // Fetch property data
    const property = await getPropertyById(session.propertyId);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // Fetch room types and rate plans
    const [roomTypes, ratePlans] = await Promise.all([
      listRoomTypes(session.propertyId),
      listRatePlans(session.propertyId)
    ]);

    if (!roomTypes || roomTypes.length === 0) {
      return NextResponse.json(
        { error: 'No room types configured for this property' },
        { status: 400 }
      );
    }

    // Fetch pricing factors or use defaults
    let pricingFactors = await getPricingFactors(session.propertyId);
    if (!pricingFactors) {
      // Use default pricing factors
      pricingFactors = {
        occupancyWeight: 0.3,
        seasonalityWeight: 0.2,
        dayOfWeekWeight: 0.15,
        leadTimeWeight: 0.15,
        lengthOfStayWeight: 0.1,
        competitorPricingWeight: 0.1,
        minPriceMultiplier: 0.7,
        maxPriceMultiplier: 1.5,
        peakSeasonMonths: [6, 7, 8, 11, 12], // Summer and holidays
        lowOccupancyThreshold: 50,
        highOccupancyThreshold: 80,
      };
    }

    // Get competitor prices if requested
    // Note: For now, competitors are disabled until we implement cross-property comparison
    let competitorPrices = [];
    // TODO: Implement competitor pricing by comparing with other properties

    // Calculate pricing for each room type
    const recommendations = roomTypes.map(room => {
      return calculateDynamicPrice({
        basePrice: room.basePrice,
        checkInDate,
        checkOutDate,
        currentOccupancy: currentOccupancy || 50,
        pricingFactors,
        competitorPrices,
      });
    });

    // Calculate weekly prices for each room type
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const lengthOfStay = Math.round(Math.abs((checkOut - checkIn) / (24 * 60 * 60 * 1000)));

    const weeklyPrices = roomTypes.map(room => {
      return calculateWeeklyPrices({
        basePrice: room.basePrice,
        checkInDate,
        currentOccupancy: currentOccupancy || 50,
        pricingFactors,
        competitorPrices,
        lengthOfStay,
      });
    });

    // Calculate revenue metrics
    const metrics = calculateRevenueMetrics({
      roomTypes,
      pricingRecommendations: recommendations,
      currentOccupancy: currentOccupancy || 50,
      targetOccupancy: 80,
    });

    // Format for export
    const exportData = formatPricingForExport(property, roomTypes, recommendations, metrics);

    // Save snapshot
    try {
      for (let i = 0; i < roomTypes.length; i++) {
        await createPricingSnapshot({
          propertyId: session.propertyId,
          roomTypeId: roomTypes[i].roomTypeId,
          checkInDate,
          checkOutDate,
          currentOccupancy: currentOccupancy || 50,
          recommendedPrice: recommendations[i].recommendedPrice,
          adjustmentBreakdown: JSON.stringify(recommendations[i].factors),
          competitorPrices: JSON.stringify(competitorPrices),
        });
      }
    } catch (error) {
      console.error('Error saving pricing snapshot:', error);
      // Continue even if snapshot fails
    }

    // Normalize property to hotel format for backward compatibility with frontend
    const hotel = {
      ...property,
      hotelName: property.Name,
      location: property.Location,
    };

    return NextResponse.json({
      hotel,
      property,
      roomTypes,
      ratePlans,
      recommendations,
      weeklyPrices,
      metrics,
      exportData,
      competitorPrices: competitorPrices.length > 0 ? competitorPrices : null,
    });
  } catch (error) {
    console.error('Error calculating dynamic pricing:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate pricing' },
      { status: 500 }
    );
  }
}
