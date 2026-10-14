// Creates one default Space per existing Venue, carrying over its old
// capacity/pricePerHour (now removed from the Venue schema). Idempotent —
// safe to re-run; skips venues that already have a migrated space.
//
// Usage: node scripts/migrate-spaces.js
require('dotenv').config();

const mongoose = require('mongoose');
const Venue = require('../model/venue.js');
const Space = require('../model/space.js');
const logger = require('../utils/logger');

const run = async () => {
  await mongoose.connect(process.env.DB_URL);
  logger.info('migrate-spaces: connected to database');

  // Read capacity/pricePerHour directly from the raw collection — the Venue
  // model no longer declares these fields, so Mongoose would strip them.
  const venues = await mongoose.connection.collection('venues').find({}).toArray();
  logger.info(`migrate-spaces: ${venues.length} venues found`);

  const venueIdToSpaceId = {};
  let created = 0;
  let skipped = 0;

  for (const venue of venues) {
    const existing = await Space.findOne({ venue: venue._id, migratedFromVenue: true });
    if (existing) {
      venueIdToSpaceId[venue._id.toString()] = existing._id;
      skipped += 1;
      continue;
    }

    const space = await Space.create({
      venue: venue._id,
      name: 'Main Space',
      capacity: venue.capacity || 1,
      indicativePricePerHour: venue.pricePerHour,
      isActive: true,
      migratedFromVenue: true,
    });

    venueIdToSpaceId[venue._id.toString()] = space._id;
    created += 1;
  }

  logger.info(`migrate-spaces: done — ${created} created, ${skipped} already migrated`);
  return venueIdToSpaceId;
};

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ message: 'migrate-spaces failed', error: error.message });
      process.exit(1);
    });
}

module.exports = { run };
