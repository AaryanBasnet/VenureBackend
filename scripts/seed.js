// 1. Load env vars FIRST
require('dotenv').config();

// 2. Import core dependencies
const mongoose = require('mongoose');
const User = require('../model/user.js');
const Venue = require('../model/Venue.js'); // Ensure case matches your filename
const  authService  = require('../services/authService.js');
const  venueService  = require('../services/venueService.js');
const logger = require('../utils/logger');

const seedData = async () => {
  try {
    // 3. Connect using your hardened DB logic
    await mongoose.connect(process.env.DB_URL);
    logger.info('Seeding: Connected to Database...');

    // 4. Clean Database
    await User.deleteMany({});
    await Venue.deleteMany({});
    logger.info('Seeding: Database cleared.');

    // 5. Create Admin
    const admin = await authService.register({
      name: 'Admin User',
      email: 'admin@venure.com',
      password: 'Password123!',
      role: 'Admin'
    });
    logger.info('Seeding: Admin created.');

    // 6. Create Venue Owner
    const owner = await authService.register({
      name: 'Venue Owner',
      email: 'owner@venure.com',
      password: 'Password123!',
      role: 'VenueOwner'
    });
    logger.info('Seeding: Owner created.');

    // 7. Create Sample Venue
   // 7. Create Sample Venue
await venueService.createVenue({
  venueName: 'Grand Ballroom',
  location: { 
    city: 'Coventry', 
    address: '123 University Way',
    state: 'West Midlands', // <--- ADDED
    country: 'United Kingdom' // <--- ADDED
  },
  description: 'A beautiful place for weddings.',
  price: 5000,
  venueImages: [{ filename: 'test', url: 'https://res.cloudinary.com/sample.jpg' }],
  status: 'approved' // Ensure status is set if required
}, owner._id);
    
    logger.info('Seeding: Venue created.');
    logger.info('Seeding complete! Successfully populated database.');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
};

seedData();