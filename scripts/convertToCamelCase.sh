#!/bin/bash

# This script converts camelCase field names to snake_case across all components and API routes

echo "Converting frontend components and API routes to snake_case..."

# Define the files to convert
FILES=(
  "src/app/components/RatePlanManager.jsx"
  "src/app/components/WeeklyPricingTable.jsx"
  "src/app/components/PricingRecommendations.jsx"
  "src/app/components/OccupancyPricingTable.jsx"
  "src/app/components/PropertySetup.jsx"
  "src/app/components/MealPlanConfig.jsx"
  "src/app/components/OccupancyConfig.jsx"
  "src/app/api/dynamicPricing/roomTypes/route.js"
  "src/app/api/dynamicPricing/ratePlans/route.js"
  "src/app/api/dynamicPricing/pricingFactors/route.js"
  "src/app/api/dynamicPricing/calculate/route.js"
)

# Room type field conversions
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    sed -i '' 's/roomTypeName/room_type_name/g' "$file"
    sed -i '' 's/roomTypeId/room_type_id/g' "$file"
    sed -i '' 's/basePrice/base_price/g' "$file"
    sed -i '' 's/numberOfRooms/number_of_rooms/g' "$file"
    sed -i '' 's/maxAdults/max_adults/g' "$file"
    sed -i '' 's/occupancyPricing/occupancy_pricing/g' "$file"

    # Rate plan fields
    sed -i '' 's/ratePlanId/rate_plan_id/g' "$file"
    sed -i '' 's/planName/plan_name/g' "$file"
    sed -i '' 's/pricingType/pricing_type/g' "$file"
    sed -i '' 's/costPerAdult/cost_per_adult/g' "$file"

    # Pricing factor fields
    sed -i '' 's/demandFactor/demand_factor/g' "$file"
    sed -i '' 's/seasonalFactor/seasonal_factor/g' "$file"
    sed -i '' 's/competitorFactor/competitor_factor/g' "$file"
    sed -i '' 's/weekendMultiplier/weekend_multiplier/g' "$file"
    sed -i '' 's/weekdayMultipliers/weekday_multipliers/g' "$file"
    sed -i '' 's/extraAdultRate/extra_adult_rate/g' "$file"
    sed -i '' 's/extraChildRate/extra_child_rate/g' "$file"
    sed -i '' 's/propertyId/property_id/g' "$file"
  fi
done

echo "Conversion complete!"
