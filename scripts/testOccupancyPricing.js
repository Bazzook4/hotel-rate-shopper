#!/usr/bin/env node

// Test script to verify occupancy pricing calculations

const occupancyPricing = {
  isBase: true,
  pricingMode: "occupancy",
  numAdultOptions: 2,
  adultPricing: {
    "1": 2500,
    "2": 2500
  },
  perAdultRate: 0,
  extraAdult: 1000,
  extraChild: 1000,
  calcType: "manual",
  fixedAdjustment: {},
  ratioMultiplier: {}
};

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

console.log('\n=== Occupancy Pricing Calculation Tests ===\n');

// Test 1: 1 Adult, 0 Children
const price1 = getEffectiveBasePrice(2500, occupancyPricing, 1, 0);
console.log('Test 1: 1 Adult, 0 Children');
console.log('Expected: 2500');
console.log('Actual:', price1);
console.log('Status:', price1 === 2500 ? '✓ PASS' : '✗ FAIL');

// Test 2: 2 Adults, 0 Children
const price2 = getEffectiveBasePrice(2500, occupancyPricing, 2, 0);
console.log('\nTest 2: 2 Adults, 0 Children');
console.log('Expected: 2500');
console.log('Actual:', price2);
console.log('Status:', price2 === 2500 ? '✓ PASS' : '✗ FAIL');

// Test 3: 3 Adults, 0 Children (should add extra adult charge)
const price3 = getEffectiveBasePrice(2500, occupancyPricing, 3, 0);
console.log('\nTest 3: 3 Adults, 0 Children');
console.log('Expected: 3500 (2500 base + 1000 extra adult)');
console.log('Actual:', price3);
console.log('Status:', price3 === 3500 ? '✓ PASS' : '✗ FAIL');

// Test 4: 2 Adults, 1 Child
const price4 = getEffectiveBasePrice(2500, occupancyPricing, 2, 1);
console.log('\nTest 4: 2 Adults, 1 Child');
console.log('Expected: 3500 (2500 base + 1000 extra child)');
console.log('Actual:', price4);
console.log('Status:', price4 === 3500 ? '✓ PASS' : '✗ FAIL');

// Test 5: 2 Adults, 2 Children
const price5 = getEffectiveBasePrice(2500, occupancyPricing, 2, 2);
console.log('\nTest 5: 2 Adults, 2 Children');
console.log('Expected: 4500 (2500 base + 2000 extra children)');
console.log('Actual:', price5);
console.log('Status:', price5 === 4500 ? '✓ PASS' : '✗ FAIL');

// Test 6: 4 Adults, 1 Child
const price6 = getEffectiveBasePrice(2500, occupancyPricing, 4, 1);
console.log('\nTest 6: 4 Adults, 1 Child');
console.log('Expected: 6500 (2500 base + 3000 extra adults + 1000 extra child)');
console.log('Actual:', price6);
console.log('Status:', price6 === 6500 ? '✓ PASS' : '✗ FAIL');

console.log('\n=== All Tests Complete ===\n');
