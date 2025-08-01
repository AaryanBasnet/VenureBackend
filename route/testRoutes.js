const express = require('express');
const mongoose = require('mongoose');
const Venue = require('../model/venue');
const User = require('../model/user');

const router = express.Router();

router.post('/seed', async (req, res) => {
  try {
    // 1. Create or find test user (owner)
    let owner = await User.findOne({ email: 'testowner@example.com' });
    if (!owner) {
      owner = await User.create({
        name: 'Test Owner',
        email: 'testowner@example.com',
        password: 'Secret123', // hash it accordingly in your model middleware
        role: 'VenueOwner',
        isTest: true, // optional flag to identify test users
      });
    }

    // 2. Create venue linked to this owner
    const venueData = {
      owner: owner._id,
      venueName: 'Test Hall',
      location: {
        address: '123 Test Street',
        city: 'Kathmandu',
        state: 'Bagmati',
        country: 'Nepal',
      },
      capacity: 100,
      venueImages: [
        { filename: 'test1.jpg', url: '/images/test1.jpg' },
        { filename: 'test2.jpg', url: '/images/test2.jpg' },
      ],
      description: 'This is a test venue for automated testing.',
      amenities: ['WiFi', 'Projector', 'Parking'],
      pricePerHour: 1500,
      status: 'approved',
      isDeleted: false,
      reviews: [],
      averageRating: 4.5,
    };

    await Venue.create(venueData);

    res.json({ message: 'Test DB seeded with user and venue' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Seed failed' });
  }
});

module.exports = router;
