// 1. Load env vars FIRST
require('dotenv').config();

// 2. Import core dependencies
const mongoose = require('mongoose');
const User = require('../model/user.js');
const Venue = require('../model/venue.js');
const authService = require('../services/authService.js');
const logger = require('../utils/logger');

// Pass --reset to wipe users and venues first (never do this on a live DB with real data)
const RESET = process.argv.includes('--reset');

const img = (id) => ({
  filename: id,
  url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`,
});

const SAMPLE_VENUES = [
  {
    venueName: 'Grand Ballroom',
    location: { address: '123 University Way', city: 'Coventry', state: 'West Midlands', country: 'United Kingdom' },
    coords: [-1.5616, 52.4068],
    capacity: 300,
    pricePerHour: 500,
    amenities: ['Wifi', 'Parking', 'Catering', 'Sound System'],
    description: 'An elegant ballroom for weddings, galas and large receptions.',
    venueImages: [img('photo-1519167758481-83f550bb49b3')],
  },
  {
    venueName: 'Riverside Garden Hall',
    location: { address: '45 Lakeside Marg', city: 'Kathmandu', state: 'Bagmati', country: 'Nepal' },
    coords: [85.324, 27.7172],
    capacity: 150,
    pricePerHour: 250,
    amenities: ['Wifi', 'Parking', 'Garden'],
    description: 'Open-air garden venue beside the river, ideal for engagements and parties.',
    venueImages: [img('photo-1464366400600-7168b8af9bc3')],
  },
  {
    venueName: 'Skyline Conference Centre',
    location: { address: '10 Durbar Marg', city: 'Kathmandu', state: 'Bagmati', country: 'Nepal' },
    coords: [85.3188, 27.7115],
    capacity: 80,
    pricePerHour: 150,
    amenities: ['Wifi', 'Projector', 'Air Conditioning'],
    description: 'Modern conference space with city views, perfect for meetings and seminars.',
    venueImages: [img('photo-1497366216548-37526070297c')],
  },
  {
    venueName: 'Lakeview Pavilion',
    location: { address: '7 Lakeside Road', city: 'Pokhara', state: 'Gandaki', country: 'Nepal' },
    coords: [83.9596, 28.2096],
    capacity: 200,
    pricePerHour: 300,
    amenities: ['Parking', 'Catering', 'Lake View'],
    description: 'A pavilion overlooking Phewa Lake for weddings and celebrations.',
    venueImages: [img('photo-1505236858219-8359eb29e329')],
  },
];

const ensureUser = async ({ name, email, password, role }) => {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return authService.register({ name, email, password, role });
};

const seedData = async () => {
  try {
    await mongoose.connect(process.env.DB_URL);
    logger.info('Seeding: Connected to Database...');

    if (RESET) {
      await User.deleteMany({});
      await Venue.deleteMany({});
      logger.info('Seeding: Database cleared.');
    }

    await ensureUser({ name: 'Admin User', email: 'admin@venure.com', password: 'Password123!', role: 'Admin' });
    const owner = await ensureUser({ name: 'Venue Owner', email: 'owner@venure.com', password: 'Password123!', role: 'VenueOwner' });
    logger.info('Seeding: Admin and owner ready.');

    // Upsert by name so re-running never creates duplicates
    for (const { coords, ...venue } of SAMPLE_VENUES) {
      await Venue.findOneAndUpdate(
        { venueName: venue.venueName, owner: owner._id },
        {
          ...venue,
          owner: owner._id,
          geoCoordinates: { type: 'Point', coordinates: coords },
          status: 'approved',
          isDeleted: false,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }

    const approved = await Venue.countDocuments({ status: 'approved', isDeleted: false });
    logger.info(`Seeding complete! ${approved} approved venues in database.`);
    process.exit(0);
  } catch (error) {
    logger.error({ message: 'Seeding failed', error: error.message });
    process.exit(1);
  }
};

seedData();
