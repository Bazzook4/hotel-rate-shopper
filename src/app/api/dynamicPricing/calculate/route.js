import { NextResponse } from 'next/server';
import {
  getDynamicPricingHotelById,
  listRoomTypes,
  listRatePlans,
  getPricingFactors,
  createPricingSnapshot,
  listDynamicPricingHotels,
} from '@/lib/airtable';
import { calculateDynamicPrice, calculateWeeklyPrices, calculateRevenueMetrics, formatPricingForExport } from '@/lib/pricingEngine';
import { getSessionFromRequest } from '@/lib/session';

export async function POST(request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      hotelId,
      checkInDate,
      checkOutDate,
      currentOccupancy,
      includeCompetitors = false,
    } = body;

    if (!hotelId || !checkInDate || !checkOutDate) {
      return NextResponse.json(
        { error: 'Missing required fields: hotelId, checkInDate, checkOutDate' },
        { status: 400 }
      );
    }

    // Fetch hotel data
    const hotel = await getDynamicPricingHotelById(hotelId);
    if (!hotel) {
      return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
    }

    // Fetch room types and rate plans
    const [roomTypes, ratePlans] = await Promise.all([
      listRoomTypes(hotelId),
      listRatePlans(hotelId)
    ]);

    if (!roomTypes || roomTypes.length === 0) {
      return NextResponse.json(
        { error: 'No room types configured for this hotel' },
        { status: 400 }
      );
    }

    // Fetch pricing factors or use defaults
    let pricingFactors = await getPricingFactors(hotelId);
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
    let competitorPrices = [];
    if (includeCompetitors && (pricingFactors.competitorPricingWeight || 0) > 0) {
      try {
        const allHotels = await listDynamicPricingHotels({ propertyId: hotel.propertyId });
        const competitors = allHotels.filter(h => h.hotelId !== hotelId);

        // Get average base price from competitor hotels
        for (const competitor of competitors) {
          const competitorRooms = await listRoomTypes(competitor.hotelId);
          if (competitorRooms.length > 0) {
            const avgPrice = competitorRooms.reduce((sum, room) => sum + room.basePrice, 0) / competitorRooms.length;
            competitorPrices.push(avgPrice);
          }
        }
      } catch (error) {
        console.error('Error fetching competitor prices:', error);
        // Continue without competitor pricing
      }
    }

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
    const exportData = formatPricingForExport(hotel, roomTypes, recommendations, metrics);

    // Save snapshot
    try {
      for (let i = 0; i < roomTypes.length; i++) {
        await createPricingSnapshot({
          hotelId,
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

    return NextResponse.json({
      hotel,
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
