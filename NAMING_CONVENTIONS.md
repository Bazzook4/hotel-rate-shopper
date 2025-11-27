# Naming Conventions

## Overview

This project uses **TWO different naming conventions** intentionally:

### 1. Database & API Layer: `snake_case`
- **Where**: PostgreSQL database, Supabase, API routes
- **Why**: PostgreSQL standard convention
- **Examples**:
  - `room_type_name`
  - `base_price`
  - `number_of_rooms`
  - `max_adults`
  - `property_id`

### 2. Business Logic Layer: `camelCase`
- **Where**: `src/lib/pricingEngine.js` and other utility functions
- **Why**: JavaScript standard convention
- **Examples**:
  - `roomTypeName`
  - `basePrice`
  - `numberOfRooms`
  - `maxAdults`
  - `propertyId`

## The Mapping Layer

**CRITICAL**: Always map data at the API boundary before passing to pricing engine functions.

### Example (from `calculate/route.js`):

```javascript
// ✅ CORRECT - Map before passing to pricing engine
const roomTypesForEngine = roomTypes.map(room => ({
  roomTypeName: room.room_type_name,
  basePrice: room.base_price,
  numberOfRooms: room.number_of_rooms,
  maxAdults: room.max_adults,
}));

calculateRevenueMetrics({
  roomTypes: roomTypesForEngine  // Uses camelCase
});
```

```javascript
// ❌ WRONG - Passing snake_case directly
calculateRevenueMetrics({
  roomTypes: roomTypes  // Will fail - undefined fields!
});
```

## Field Mapping Reference

| Database (snake_case) | JavaScript (camelCase) |
|----------------------|------------------------|
| `room_type_name`     | `roomTypeName`        |
| `room_type_id`       | `roomTypeId`          |
| `base_price`         | `basePrice`           |
| `number_of_rooms`    | `numberOfRooms`       |
| `max_adults`         | `maxAdults`           |
| `occupancy_pricing`  | `occupancyPricing`    |
| `rate_plan_id`       | `ratePlanId`          |
| `plan_name`          | `planName`            |
| `pricing_type`       | `pricingType`         |
| `cost_per_adult`     | `costPerAdult`        |
| `property_id`        | `propertyId`          |

## Why Not Use One Convention Everywhere?

We maintain this separation because:

1. **Database standards**: PostgreSQL best practices use snake_case
2. **JavaScript standards**: camelCase is idiomatic in JavaScript
3. **Library compatibility**: Supabase expects snake_case, pricing algorithms expect camelCase
4. **Clear separation**: Makes it obvious which layer you're working in

## Common Mistakes to Avoid

### ❌ Mistake 1: Forgetting to map
```javascript
// WRONG - passing DB data directly to pricing engine
calculateDynamicPrice({
  base_price: room.base_price  // Will be undefined in pricing engine!
});
```

### ✅ Fix 1: Always map parameter names
```javascript
// CORRECT
calculateDynamicPrice({
  basePrice: room.base_price  // Mapping snake_case to camelCase
});
```

### ❌ Mistake 2: Inconsistent field access
```javascript
// WRONG - mixing conventions
const roomData = {
  room_type_name: "Deluxe",
  basePrice: 2500  // Mixed!
};
```

### ✅ Fix 2: Be consistent within each layer
```javascript
// CORRECT - consistent snake_case (database layer)
const roomData = {
  room_type_name: "Deluxe",
  base_price: 2500
};

// Then map when calling business logic
const engineData = {
  roomTypeName: roomData.room_type_name,
  basePrice: roomData.base_price
};
```

## Quick Checklist

When adding new features:

- [ ] Database schema uses `snake_case`
- [ ] API routes accept and return `snake_case`
- [ ] Frontend components use `snake_case` (matches API)
- [ ] Pricing engine functions use `camelCase`
- [ ] Added mapping layer if calling pricing engine from API
- [ ] Updated this document if adding new fields

## Questions?

If unsure about naming:
- **Reading from database?** → Use `snake_case`
- **Calling pricing engine?** → Map to `camelCase`
- **Creating new utility function?** → Use `camelCase` (JavaScript convention)
