# Dynamic Pricing Feature - Setup Guide

## Overview

The Dynamic Pricing feature is a comprehensive hotel revenue optimization system that uses multiple weighted factors to calculate optimal room pricing. This feature allows hotels to:

- Setup properties with detailed room type configurations
- Configure dynamic pricing factors (occupancy, seasonality, day of week, lead time, etc.)
- View real-time pricing recommendations with factor breakdowns
- Analyze revenue optimization opportunities
- Compare pricing against competitors
- Export results for use in other systems

## Features Implemented

### 1. Property Setup
- Create and manage hotel properties
- Configure multiple room types per property
- Set base prices and inventory for each room type
- Add room descriptions and amenities

### 2. Dynamic Pricing Factors (All Multipliers)
- **Occupancy Rate**: Different multipliers for low (0-30%), medium (31-70%), and high (71-100%) occupancy
- **Seasonality**: Peak and off-peak season definitions with multipliers
- **Day of Week**: Individual multipliers for each day (Monday-Sunday)
- **Booking Lead Time**: Multipliers based on advance booking (0-3 days, 4-7, 8-14, 15-30, 31+ days)
- **Length of Stay**: Discounts for longer stays (1 night, 2-3, 4-6, 7+ nights)
- **Competitor Pricing**: Automatic pickup from existing hotels with configurable weight (0-1)

### 3. Pricing Recommendations
- Suggested price per room type based on all factors
- Detailed breakdown showing impact of each factor
- Revenue optimization suggestions
- Occupancy vs pricing balance analysis
- Comparative analysis against competitors

### 4. Export/Copy Functionality
- One-click copy of all pricing recommendations
- Formatted text output ready for external systems
- Includes summary, room pricing breakdown, and recommendations

## Airtable Tables Structure

You'll need to create the following tables in your Airtable base:

### 1. DynamicPricingHotels
Fields:
- `hotelId` (Single line text) - Primary key
- `propertyId` (Single line text) - Link to Properties table
- `hotelName` (Single line text)
- `location` (Single line text)
- `createdAt` (Date)
- `updatedAt` (Date)

### 2. RoomTypes
Fields:
- `roomTypeId` (Single line text) - Primary key
- `hotelId` (Single line text) - Link to DynamicPricingHotels
- `roomTypeName` (Single line text) - e.g., "Standard Double", "Deluxe Suite"
- `basePrice` (Number) - Base price per night
- `numberOfRooms` (Number) - Total inventory
- `description` (Long text)
- `amenities` (Multiple select) - WiFi, AC, TV, etc.
- `occupancyPricing` (Long text) - JSON string with occupancy-specific pricing (single, double, triple, extraAdult, extraChild)
- `createdAt` (Date)

### 3. RatePlans
Fields:
- `ratePlanId` (Single line text) - Primary key
- `hotelId` (Single line text) - Link to DynamicPricingHotels
- `planName` (Single line text) - e.g., "Standard Rate", "Non-Refundable"
- `multiplier` (Number) - e.g., 0.9 for 10% discount, 1.1 for 10% premium
- `description` (Long text)
- `createdAt` (Date)

### 4. PricingFactors
Fields:
- `factorId` (Single line text) - Primary key
- `hotelId` (Single line text) - Link to DynamicPricingHotels
- `occupancyLow` (Number) - Multiplier for 0-30% occupancy
- `occupancyMedium` (Number) - Multiplier for 31-70% occupancy
- `occupancyHigh` (Number) - Multiplier for 71-100% occupancy
- `peakSeasonStart` (Date)
- `peakSeasonEnd` (Date)
- `peakSeasonMultiplier` (Number)
- `offPeakMultiplier` (Number)
- `mondayMultiplier` (Number)
- `tuesdayMultiplier` (Number)
- `wednesdayMultiplier` (Number)
- `thursdayMultiplier` (Number)
- `fridayMultiplier` (Number)
- `saturdayMultiplier` (Number)
- `sundayMultiplier` (Number)
- `leadTime0to3Days` (Number) - Last minute premium
- `leadTime4to7Days` (Number)
- `leadTime8to14Days` (Number)
- `leadTime15to30Days` (Number)
- `leadTime31PlusDays` (Number)
- `lengthOfStay1Night` (Number)
- `lengthOfStay2to3Nights` (Number)
- `lengthOfStay4to6Nights` (Number)
- `lengthOfStay7PlusNights` (Number)
- `competitorPricingWeight` (Number) - 0-1, how much to consider competitor prices
- `updatedAt` (Date)

### 5. PricingSnapshots
Fields:
- `snapshotId` (Single line text) - Primary key
- `hotelId` (Single line text) - Link to DynamicPricingHotels
- `roomTypeId` (Single line text)
- `checkInDate` (Date)
- `checkOutDate` (Date)
- `currentOccupancy` (Number) - Percentage
- `recommendedPrice` (Number)
- `adjustmentBreakdown` (Long text) - JSON string with factor breakdown
- `competitorPrices` (Long text) - JSON array of competitor prices
- `createdAt` (Date)

## Environment Variables

Add to your `.env` file:

```
AIRTABLE_DYNAMIC_PRICING_HOTELS_TABLE=DynamicPricingHotels
AIRTABLE_ROOM_TYPES_TABLE=RoomTypes
AIRTABLE_RATE_PLANS_TABLE=RatePlans
AIRTABLE_PRICING_FACTORS_TABLE=PricingFactors
AIRTABLE_PRICING_SNAPSHOTS_TABLE=PricingSnapshots
```

## Setup Instructions

### Step 1: Create Airtable Tables

1. Log in to your Airtable account
2. Open your existing base (the one used for your Rate Shopper app)
3. Create the 5 tables listed above with the exact field names and types

**Important Notes:**
- Field names must match exactly (case-sensitive)
- Use the correct field types (Single line text, Number, Date, etc.)
- The `id` field is auto-generated by Airtable, don't create it manually

### Step 2: Update Environment Variables

Add the following to your `.env` file (optional, as defaults are provided):

```bash
AIRTABLE_DYNAMIC_PRICING_HOTELS_TABLE=DynamicPricingHotels
AIRTABLE_ROOM_TYPES_TABLE=RoomTypes
AIRTABLE_RATE_PLANS_TABLE=RatePlans
AIRTABLE_PRICING_FACTORS_TABLE=PricingFactors
AIRTABLE_PRICING_SNAPSHOTS_TABLE=PricingSnapshots
```

If you don't add these, the default table names above will be used.

### Step 3: Run the Application

```bash
npm run dev
```

### Step 4: Access Dynamic Pricing

1. Navigate to http://localhost:3000
2. Log in with your credentials
3. Click on the "Dynamic Pricing 💰" tab in the sidebar
4. Follow the wizard to:
   - Create a new property or select an existing one
   - Add room types with base prices
   - Configure pricing factors
   - Generate pricing recommendations

## Usage Guide

### Creating a Property

1. Click "New Property" or "Create First Property"
2. Enter hotel name and location
3. Click "Create Property"

### Adding Room Types

1. After creating a property, click "+ Add Room Type"
2. Fill in:
   - Room Type Name (e.g., "Deluxe Suite", "Standard Double")
   - Base Price (per night)
   - Number of Rooms (inventory)
   - Optional description
3. Click "Add Room Type"
4. Repeat for all room types
5. Click "Continue to Pricing Configuration"

### Configuring Pricing Factors

The configuration page has several sections:

#### Pricing Parameters
- **Check-in/Check-out Dates**: The dates for which you want pricing recommendations
- **Current Occupancy**: Your current occupancy percentage
- **Include Competitor Pricing**: Toggle to use competitor data from other properties

#### Occupancy Multipliers
- **Low (0-30%)**: Typically 0.9 (10% discount to attract bookings)
- **Medium (31-70%)**: Typically 1.0 (no change)
- **High (71-100%)**: Typically 1.2 (20% premium due to high demand)

#### Seasonality
- **Peak Season Start/End**: Define your peak season dates
- **Peak Season Multiplier**: Typically 1.3 (30% premium)
- **Off-Peak Multiplier**: Typically 0.95 (5% discount)

#### Day of Week Multipliers
Configure each day individually:
- **Monday/Tuesday**: Typically 0.85 (weekday discount)
- **Friday/Saturday**: Typically 1.1-1.15 (weekend premium)
- **Sunday**: Typically 1.0 (neutral)

#### Lead Time Multipliers
- **0-3 Days**: 1.2 (last-minute premium)
- **4-7 Days**: 1.1
- **8-14 Days**: 1.0 (baseline)
- **15-30 Days**: 0.95
- **31+ Days**: 0.9 (early bird discount)

#### Length of Stay Multipliers
- **1 Night**: 1.0 (no discount)
- **2-3 Nights**: 0.98 (2% discount)
- **4-6 Nights**: 0.95 (5% discount)
- **7+ Nights**: 0.9 (10% discount)

#### Competitor Pricing
- **Weight (0-1)**: How much influence competitor prices have
  - 0 = Ignore competitors completely
  - 0.3 = Moderate influence (recommended)
  - 1 = Maximum influence

### Generating Recommendations

1. After configuring factors, click "Save Configuration"
2. Click "Calculate Pricing"
3. View your recommendations with:
   - Summary cards showing total rooms, occupancy, avg prices, and revenue change
   - AI-powered recommendations based on market conditions
   - Competitor analysis (if enabled)
   - Detailed room-by-room pricing with factor breakdowns

### Copying Results

Click the "Copy Results" button to copy a formatted text version of all recommendations to your clipboard. The format includes:
- Hotel and booking details
- Summary metrics
- Room pricing breakdown with all factor impacts
- AI recommendations

You can paste this directly into emails, spreadsheets, or your PMS.

## Understanding the Pricing Algorithm

The recommended price is calculated as:

```
Recommended Price = Base Price ×
  Occupancy Multiplier ×
  Seasonality Multiplier ×
  Day of Week Multiplier ×
  Lead Time Multiplier ×
  Length of Stay Multiplier ×
  Competitor Pricing Multiplier
```

### Example Calculation

**Base Price**: $100
**Occupancy**: 75% → High (1.2x)
**Season**: Peak (1.3x)
**Day**: Friday (1.1x)
**Lead Time**: 10 days → 8-14 range (1.0x)
**Length**: 2 nights → 2-3 range (0.98x)
**Competitor**: Avg competitor $120, weight 0.3 → 1.06x

**Calculation**:
$100 × 1.2 × 1.3 × 1.1 × 1.0 × 0.98 × 1.06 = **$163.34**

This represents a 63.34% increase from the base price due to favorable market conditions.

## Best Practices

1. **Start Conservative**: Begin with multipliers close to 1.0 and adjust based on actual booking patterns
2. **Review Regularly**: Update pricing factors monthly or seasonally
3. **Monitor Competitors**: Enable competitor pricing to stay market-competitive
4. **Test and Iterate**: Run different scenarios before implementing prices
5. **Save Snapshots**: The system automatically saves pricing snapshots for historical analysis
6. **Use AI Recommendations**: Pay attention to the AI-generated suggestions for occupancy optimization

## Troubleshooting

### "No room types configured for this hotel"
- Make sure you've added at least one room type before calculating pricing

### "Pricing factors not configured for this hotel"
- Complete the pricing configuration step before calculating

### Competitor pricing not working
- Ensure you have multiple hotels configured in the system
- Check that "Include Competitor Pricing" is enabled
- Set the competitor pricing weight > 0

### Can't see Dynamic Pricing tab
- Make sure you're logged in
- Check that your session is active

## API Endpoints

If you want to integrate with external systems:

### Hotels
- `GET /api/dynamicPricing/hotels` - List all hotels
- `POST /api/dynamicPricing/hotels` - Create a hotel
- `GET /api/dynamicPricing/hotels/[hotelId]` - Get hotel details
- `PATCH /api/dynamicPricing/hotels/[hotelId]` - Update hotel

### Room Types
- `GET /api/dynamicPricing/roomTypes?hotelId={id}` - List room types
- `POST /api/dynamicPricing/roomTypes` - Create room type
- `PATCH /api/dynamicPricing/roomTypes` - Update room type
- `DELETE /api/dynamicPricing/roomTypes?recordId={id}` - Delete room type

### Rate Plans
- `GET /api/dynamicPricing/ratePlans?hotelId={id}` - List rate plans
- `POST /api/dynamicPricing/ratePlans` - Create rate plan
- `PATCH /api/dynamicPricing/ratePlans` - Update rate plan
- `DELETE /api/dynamicPricing/ratePlans?recordId={id}` - Delete rate plan

### Pricing Factors
- `GET /api/dynamicPricing/pricingFactors?hotelId={id}` - Get factors
- `POST /api/dynamicPricing/pricingFactors` - Create/update factors

### Calculate Pricing
- `POST /api/dynamicPricing/calculate` - Calculate pricing recommendations

## Technical Architecture

### Frontend Components
- **DynamicPricing.jsx**: Main orchestrator component
- **PropertySetup.jsx**: Hotel and room type management
- **PricingConfiguration.jsx**: Factor configuration interface
- **PricingRecommendations.jsx**: Results display with export

### Backend Services
- **pricingEngine.js**: Core pricing calculation logic
- **airtable.js**: Database operations for all pricing tables
- **API Routes**: RESTful endpoints for CRUD operations

### Data Flow
1. User creates/selects hotel
2. User configures room types and pricing factors
3. User sets pricing parameters (dates, occupancy)
4. System calculates recommendations using pricing engine
5. System saves snapshot to Airtable
6. User views recommendations and exports results

## Future Enhancements

Potential features for future versions:
- Historical pricing analytics and trends
- Automated price adjustments based on real-time occupancy
- Integration with PMS systems
- Multi-property pricing strategies
- Event-based pricing (conferences, holidays, etc.)
- Machine learning price optimization
- Bulk pricing updates
- CSV export functionality
- Email notifications for price recommendations
