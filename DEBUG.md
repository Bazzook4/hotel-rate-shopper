# Debug: Check API Response for MakeMyTrip & Goibibo

## Issue
Not seeing MakeMyTrip (MMT) and Goibibo rates in search results.

## Root Cause
The app uses **SerpAPI's Google Hotels** engine, which scrapes Google's hotel search results.

**Important:** MMT and Goibibo availability depends on:
1. Whether Google Hotels shows them for that specific hotel
2. Your search location (Indian hotels have better MMT/Goibibo coverage)
3. The hotel's distribution on these platforms

## How to Debug

### Step 1: Check Raw API Response

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Search for a hotel
4. Find the request to `/api/hotel?q=...`
5. Click on it → **Response** tab
6. Look for these fields:
   - `featured_prices[]` - Sponsored results
   - `prices[]` - Organic results

### Step 2: Check What Sources Are Available

In the response, each price object has:
```json
{
  "source": "Booking.com",  // or "MakeMyTrip", "Goibibo", etc.
  "logo": "...",
  "link": "...",
  "rate_per_night": {
    "lowest": "₹5,000",
    "extracted_lowest": 5000
  }
}
```

### Step 3: Test with Known Indian Hotels

Try searching for these hotels (which typically show on MMT/Goibibo):
- **Taj Mahal Palace Mumbai**
- **ITC Grand Chola Chennai**
- **Fortune Retreat Ooty** (your hotel)
- **Oberoi Udaivilas Udaipur**

## Why Some OTAs Might Be Missing

### 1. Hotel Not Listed on Platform
- The hotel hasn't signed up with MMT/Goibibo
- Or has stopped distribution on those channels

### 2. Google Hotels Coverage
- Google Hotels may not always scrape MMT/Goibibo
- Coverage varies by region and hotel

### 3. API Limitations
- SerpAPI returns what Google shows
- If Google doesn't show MMT, we won't see it

## Solutions

### Option A: Verify on Google Hotels Directly
1. Go to https://www.google.com/travel/hotels
2. Search for your hotel manually
3. Check if MMT/Goibibo appear in the results
4. If they appear on Google but not in your app → API issue
5. If they don't appear on Google → distribution issue

### Option B: Add Direct API Integration (Future Enhancement)

Instead of relying only on Google Hotels, we could:
1. Integrate **MakeMyTrip API** directly
2. Integrate **Goibibo API** directly
3. Add **Booking.com API**
4. Add **Agoda API**

This requires:
- API keys from each platform
- Separate API calls for each OTA
- More complex rate comparison logic

### Option C: Check Console Logs

Add this to see what sources are available:

1. Open browser console
2. After a search, type:
```javascript
// This will show all available sources
console.log('Sources:',
  window.__NEXT_DATA__ ||
  'Search for a hotel first'
);
```

## Quick Test Script

To see the raw API response, run this in your browser console after a search:

```javascript
fetch('/api/hotel?q=Fortune+Retreat+Ooty&check_in_date=2025-02-01&check_out_date=2025-02-02&adults=2&children=0&currency=INR')
  .then(r => r.json())
  .then(data => {
    console.log('Sponsored sources:', data.featured_prices?.map(p => p.source));
    console.log('Organic sources:', data.prices?.map(p => p.source));
    console.log('Full response:', data);
  });
```

## Next Steps

1. **Test with the browser console** to see what sources are actually returned
2. **Check Google Hotels directly** for the same hotel
3. **If MMT/Goibibo show on Google but not in app:** API parsing issue (let me know!)
4. **If MMT/Goibibo don't show on Google:** Hotel distribution issue (need direct API integration)

Let me know what you find and I can help further! 🔍
