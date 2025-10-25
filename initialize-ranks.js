/**
 * Script to initialize rank field for existing room types
 * Run this once: node initialize-ranks.js
 */

const { listRoomTypes, updateRoomType } = require('./src/lib/airtable.js');

async function initializeRanks() {
  try {
    // You need to replace this with your actual hotelId
    const hotelId = process.argv[2];

    if (!hotelId) {
      console.error('Please provide hotelId as argument: node initialize-ranks.js YOUR_HOTEL_ID');
      process.exit(1);
    }

    console.log(`Fetching room types for hotel: ${hotelId}`);
    const roomTypes = await listRoomTypes(hotelId);

    console.log(`Found ${roomTypes.length} room types`);

    // Assign ranks based on current order
    for (let i = 0; i < roomTypes.length; i++) {
      const room = roomTypes[i];
      const rank = i + 1;

      console.log(`Setting rank ${rank} for: ${room.roomTypeName} (ID: ${room.id})`);

      await updateRoomType(room.id, { rank });
    }

    console.log('✅ All room types have been assigned ranks!');

    // Verify
    const updatedRooms = await listRoomTypes(hotelId);
    console.log('\nFinal ranking:');
    updatedRooms
      .sort((a, b) => (a.rank || 999) - (b.rank || 999))
      .forEach(room => {
        console.log(`  ${room.rank || 'NO RANK'}: ${room.roomTypeName}`);
      });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

initializeRanks();
