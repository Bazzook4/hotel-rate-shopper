/**
 * Dynamic Pricing Engine
 * Calculates hotel room prices based on multiple weighted factors
 */

/**
 * Calculate the number of days between two dates
 */
function getDaysDifference(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1 - date2) / oneDay));
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday)
 */
function getDayOfWeek(date) {
  return new Date(date).getDay();
}

/**
 * Check if a date falls within peak season
 */
function isInPeakSeason(checkInDate, peakSeasonStart, peakSeasonEnd) {
  if (!peakSeasonStart || !peakSeasonEnd) return false;

  const checkIn = new Date(checkInDate);
  const start = new Date(peakSeasonStart);
  const end = new Date(peakSeasonEnd);

  return checkIn >= start && checkIn <= end;
}

/**
 * Get occupancy multiplier based on current occupancy percentage
 */
function getOccupancyMultiplier(occupancy, factors) {
  if (occupancy <= 30) {
    return factors.occupancyLow || 0.9;
  } else if (occupancy <= 70) {
    return factors.occupancyMedium || 1.0;
  } else {
    return factors.occupancyHigh || 1.2;
  }
}

/**
 * Get day of week multiplier
 */
function getDayOfWeekMultiplier(dayOfWeek, factors) {
  const dayMultipliers = [
    factors.sundayMultiplier || 1.0,
    factors.mondayMultiplier || 0.85,
    factors.tuesdayMultiplier || 0.85,
    factors.wednesdayMultiplier || 0.9,
    factors.thursdayMultiplier || 0.95,
    factors.fridayMultiplier || 1.1,
    factors.saturdayMultiplier || 1.15,
  ];

  return dayMultipliers[dayOfWeek];
}

/**
 * Get lead time multiplier based on booking advance
 */
function getLeadTimeMultiplier(leadTimeDays, factors) {
  if (leadTimeDays <= 3) {
    return factors.leadTime0to3Days || 1.2; // Last-minute premium
  } else if (leadTimeDays <= 7) {
    return factors.leadTime4to7Days || 1.1;
  } else if (leadTimeDays <= 14) {
    return factors.leadTime8to14Days || 1.0;
  } else if (leadTimeDays <= 30) {
    return factors.leadTime15to30Days || 0.95;
  } else {
    return factors.leadTime31PlusDays || 0.9; // Early bird discount
  }
}

/**
 * Get length of stay multiplier
 */
function getLengthOfStayMultiplier(nights, factors) {
  if (nights === 1) {
    return factors.lengthOfStay1Night || 1.0;
  } else if (nights <= 3) {
    return factors.lengthOfStay2to3Nights || 0.98;
  } else if (nights <= 6) {
    return factors.lengthOfStay4to6Nights || 0.95;
  } else {
    return factors.lengthOfStay7PlusNights || 0.9;
  }
}

/**
 * Get seasonality multiplier
 */
function getSeasonalityMultiplier(checkInDate, factors) {
  const isPeak = isInPeakSeason(
    checkInDate,
    factors.peakSeasonStart,
    factors.peakSeasonEnd
  );

  if (isPeak) {
    return factors.peakSeasonMultiplier || 1.3;
  } else {
    return factors.offPeakMultiplier || 0.95;
  }
}

/**
 * Calculate competitor pricing adjustment
 */
function getCompetitorPricingMultiplier(basePrice, competitorPrices, weight) {
  if (!competitorPrices || competitorPrices.length === 0 || !weight) {
    return 1.0;
  }

  // Calculate average competitor price
  const avgCompetitorPrice = competitorPrices.reduce((sum, price) => sum + price, 0) / competitorPrices.length;

  // If our base price is lower than competitors, we can increase it
  // If higher, we should decrease it
  const priceDiff = avgCompetitorPrice - basePrice;
  const adjustmentFactor = (priceDiff / basePrice) * weight;

  // Cap the adjustment to +/- 20%
  const cappedAdjustment = Math.max(-0.2, Math.min(0.2, adjustmentFactor));

  return 1 + cappedAdjustment;
}

/**
 * Get effective base price from occupancy pricing if available
 */
function getEffectiveBasePrice(basePrice, occupancyPricing, numAdults = 2, numChildren = 0) {
  if (!occupancyPricing || typeof occupancyPricing !== 'object') {
    return basePrice;
  }

  const pricingMode = occupancyPricing.pricingMode || 'flat';

  // If flat pricing mode or no pricing data, use base price
  if (pricingMode === 'flat' || !occupancyPricing.adultPricing) {
    return basePrice;
  }

  // For occupancy-based or per-adult pricing modes
  let effectivePrice = basePrice;

  // Get base price for the number of adults
  const adultPricing = occupancyPricing.adultPricing || {};
  if (adultPricing[numAdults.toString()]) {
    effectivePrice = adultPricing[numAdults.toString()];
  } else if (adultPricing['1']) {
    // Fallback to single adult pricing
    effectivePrice = adultPricing['1'];
    // Add extra adult charges if applicable
    const extraAdults = Math.max(0, numAdults - 1);
    const extraAdultRate = occupancyPricing.extraAdult || 0;
    effectivePrice += extraAdults * extraAdultRate;
  }

  // Add extra child charges
  if (numChildren > 0 && occupancyPricing.extraChild) {
    effectivePrice += numChildren * occupancyPricing.extraChild;
  }

  return effectivePrice;
}

/**
 * Main pricing calculation function
 */
export function calculateDynamicPrice({
  basePrice,
  checkInDate,
  checkOutDate,
  currentOccupancy,
  pricingFactors,
  competitorPrices = [],
  occupancyPricing = null,
  numAdults = 2,
  numChildren = 0,
}) {
  // Validate required parameters and show exactly what's missing
  const missing = [];
  if (!basePrice) missing.push('basePrice');
  if (!checkInDate) missing.push('checkInDate');
  if (!checkOutDate) missing.push('checkOutDate');
  if (!pricingFactors) missing.push('pricingFactors');

  if (missing.length > 0) {
    throw new Error(`Missing required parameters for price calculation: ${missing.join(', ')}`);
  }

  // Get effective base price based on occupancy pricing configuration
  const effectiveBasePrice = getEffectiveBasePrice(basePrice, occupancyPricing, numAdults, numChildren);

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);
  const today = new Date();

  // Calculate variables
  const leadTimeDays = getDaysDifference(today, checkIn);
  const lengthOfStay = getDaysDifference(checkIn, checkOut);
  const dayOfWeek = getDayOfWeek(checkIn);

  // Get all multipliers
  const occupancyMultiplier = getOccupancyMultiplier(currentOccupancy || 50, pricingFactors);
  const seasonalityMultiplier = getSeasonalityMultiplier(checkInDate, pricingFactors);
  const dayOfWeekMultiplier = getDayOfWeekMultiplier(dayOfWeek, pricingFactors);
  const leadTimeMultiplier = getLeadTimeMultiplier(leadTimeDays, pricingFactors);
  const lengthOfStayMultiplier = getLengthOfStayMultiplier(lengthOfStay, pricingFactors);
  const competitorMultiplier = getCompetitorPricingMultiplier(
    effectiveBasePrice,
    competitorPrices,
    pricingFactors.competitorPricingWeight || 0
  );

  // Calculate final price using effective base price
  const finalPrice = effectiveBasePrice *
    occupancyMultiplier *
    seasonalityMultiplier *
    dayOfWeekMultiplier *
    leadTimeMultiplier *
    lengthOfStayMultiplier *
    competitorMultiplier;

  // Round to 2 decimal places
  const recommendedPrice = Math.round(finalPrice * 100) / 100;

  // Calculate price change percentage (compare against effective base price)
  const priceChange = ((recommendedPrice - effectiveBasePrice) / effectiveBasePrice) * 100;

  // Build breakdown
  const breakdown = {
    basePrice,
    effectiveBasePrice,
    recommendedPrice,
    priceChange: Math.round(priceChange * 100) / 100,
    guestConfiguration: {
      numAdults,
      numChildren,
      pricingMode: occupancyPricing?.pricingMode || 'flat',
    },
    factors: {
      occupancy: {
        value: currentOccupancy || 50,
        multiplier: occupancyMultiplier,
        impact: ((occupancyMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
      seasonality: {
        isPeakSeason: isInPeakSeason(checkInDate, pricingFactors.peakSeasonStart, pricingFactors.peakSeasonEnd),
        multiplier: seasonalityMultiplier,
        impact: ((seasonalityMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
      dayOfWeek: {
        day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
        multiplier: dayOfWeekMultiplier,
        impact: ((dayOfWeekMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
      leadTime: {
        days: leadTimeDays,
        multiplier: leadTimeMultiplier,
        impact: ((leadTimeMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
      lengthOfStay: {
        nights: lengthOfStay,
        multiplier: lengthOfStayMultiplier,
        impact: ((lengthOfStayMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
      competitorPricing: {
        enabled: (pricingFactors.competitorPricingWeight || 0) > 0,
        averageCompetitorPrice: competitorPrices.length > 0
          ? (competitorPrices.reduce((sum, p) => sum + p, 0) / competitorPrices.length).toFixed(2)
          : null,
        multiplier: competitorMultiplier,
        impact: ((competitorMultiplier - 1) * effectiveBasePrice).toFixed(2),
      },
    },
  };

  return breakdown;
}

/**
 * Calculate revenue optimization metrics
 */
export function calculateRevenueMetrics({
  roomTypes,
  pricingRecommendations,
  currentOccupancy,
  targetOccupancy = 80,
}) {
  const metrics = {
    totalRooms: 0,
    averageBasePrice: 0,
    averageRecommendedPrice: 0,
    potentialRevenueIncrease: 0,
    occupancyGap: targetOccupancy - currentOccupancy,
    recommendations: [],
  };

  if (!roomTypes || roomTypes.length === 0) {
    return metrics;
  }

  let totalBaseRevenue = 0;
  let totalRecommendedRevenue = 0;

  roomTypes.forEach((room, index) => {
    const recommendation = pricingRecommendations[index];
    if (!recommendation) return;

    metrics.totalRooms += room.numberOfRooms;
    const roomBaseRevenue = room.basePrice * room.numberOfRooms;
    const roomRecommendedRevenue = recommendation.recommendedPrice * room.numberOfRooms;

    totalBaseRevenue += roomBaseRevenue;
    totalRecommendedRevenue += roomRecommendedRevenue;
  });

  metrics.averageBasePrice = totalBaseRevenue / metrics.totalRooms;
  metrics.averageRecommendedPrice = totalRecommendedRevenue / metrics.totalRooms;
  metrics.potentialRevenueIncrease = ((totalRecommendedRevenue - totalBaseRevenue) / totalBaseRevenue) * 100;

  // Generate recommendations
  if (currentOccupancy < targetOccupancy - 10) {
    metrics.recommendations.push({
      type: 'warning',
      message: `Occupancy is ${metrics.occupancyGap.toFixed(1)}% below target. Consider reducing prices to attract more bookings.`,
    });
  } else if (currentOccupancy > targetOccupancy + 10) {
    metrics.recommendations.push({
      type: 'success',
      message: `Occupancy is ${Math.abs(metrics.occupancyGap).toFixed(1)}% above target. You can increase prices to maximize revenue.`,
    });
  }

  if (metrics.potentialRevenueIncrease > 5) {
    metrics.recommendations.push({
      type: 'info',
      message: `Dynamic pricing suggests a ${metrics.potentialRevenueIncrease.toFixed(1)}% revenue increase opportunity.`,
    });
  } else if (metrics.potentialRevenueIncrease < -5) {
    metrics.recommendations.push({
      type: 'info',
      message: `Market conditions suggest lowering prices by ${Math.abs(metrics.potentialRevenueIncrease).toFixed(1)}% to stay competitive.`,
    });
  }

  return metrics;
}

/**
 * Calculate prices for all days of the week
 */
export function calculateWeeklyPrices({
  basePrice,
  checkInDate,
  currentOccupancy,
  pricingFactors,
  competitorPrices = [],
  lengthOfStay = 1,
  occupancyPricing = null,
  numAdults = 2,
  numChildren = 0,
}) {
  // Validate required parameters and show exactly what's missing
  const missing = [];
  if (!basePrice) missing.push('basePrice');
  if (!checkInDate) missing.push('checkInDate');
  if (!pricingFactors) missing.push('pricingFactors');

  if (missing.length > 0) {
    throw new Error(`Missing required parameters for weekly price calculation: ${missing.join(', ')}`);
  }

  // Get effective base price based on occupancy pricing configuration
  const effectiveBasePrice = getEffectiveBasePrice(basePrice, occupancyPricing, numAdults, numChildren);

  const today = new Date();
  const checkIn = new Date(checkInDate);
  const leadTimeDays = getDaysDifference(today, checkIn);

  const occupancyMultiplier = getOccupancyMultiplier(currentOccupancy || 50, pricingFactors);
  const seasonalityMultiplier = getSeasonalityMultiplier(checkInDate, pricingFactors);
  const leadTimeMultiplier = getLeadTimeMultiplier(leadTimeDays, pricingFactors);
  const lengthOfStayMultiplier = getLengthOfStayMultiplier(lengthOfStay, pricingFactors);
  const competitorMultiplier = getCompetitorPricingMultiplier(
    effectiveBasePrice,
    competitorPrices,
    pricingFactors.competitorPricingWeight || 0
  );

  const weeklyPrices = {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  days.forEach((dayName, dayIndex) => {
    // dayIndex: 0=Monday, 6=Sunday
    // JavaScript Date: 0=Sunday, 6=Saturday
    // Convert: Monday(0) -> 1, Tuesday(1) -> 2, ..., Sunday(6) -> 0
    const jsDayOfWeek = (dayIndex + 1) % 7;
    const dayOfWeekMultiplier = getDayOfWeekMultiplier(jsDayOfWeek, pricingFactors);

    const finalPrice = effectiveBasePrice *
      occupancyMultiplier *
      seasonalityMultiplier *
      dayOfWeekMultiplier *
      leadTimeMultiplier *
      lengthOfStayMultiplier *
      competitorMultiplier;

    weeklyPrices[dayName] = Math.round(finalPrice * 100) / 100;
  });

  return weeklyPrices;
}

/**
 * Format pricing data for export
 */
export function formatPricingForExport(hotelData, roomTypes, recommendations, metrics) {
  const exportData = {
    hotel: {
      name: hotelData.Name || hotelData.propertyName,
      location: hotelData.Location || hotelData.location,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      totalRooms: metrics.totalRooms,
      currentOccupancy: `${recommendations[0]?.factors?.occupancy?.value || 0}%`,
      averageBasePrice: `$${metrics.averageBasePrice.toFixed(2)}`,
      averageRecommendedPrice: `$${metrics.averageRecommendedPrice.toFixed(2)}`,
      potentialRevenueChange: `${metrics.potentialRevenueIncrease > 0 ? '+' : ''}${metrics.potentialRevenueIncrease.toFixed(2)}%`,
    },
    roomPricing: roomTypes.map((room, index) => {
      const rec = recommendations[index];
      return {
        roomType: room.roomTypeName,
        inventory: room.numberOfRooms,
        basePrice: `$${room.basePrice.toFixed(2)}`,
        recommendedPrice: `$${rec.recommendedPrice.toFixed(2)}`,
        priceChange: `${rec.priceChange > 0 ? '+' : ''}${rec.priceChange.toFixed(2)}%`,
        factorBreakdown: {
          occupancy: `${rec.factors.occupancy.multiplier}x`,
          seasonality: `${rec.factors.seasonality.multiplier}x`,
          dayOfWeek: `${rec.factors.dayOfWeek.multiplier}x (${rec.factors.dayOfWeek.day})`,
          leadTime: `${rec.factors.leadTime.multiplier}x (${rec.factors.leadTime.days} days)`,
          lengthOfStay: `${rec.factors.lengthOfStay.multiplier}x (${rec.factors.lengthOfStay.nights} nights)`,
        },
      };
    }),
    recommendations: metrics.recommendations,
  };

  return exportData;
}
