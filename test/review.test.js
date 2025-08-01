const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Venue = require("../model/venue");
const User = require("../model/user");

let mongod;
let userToken;
let ownerToken;
let userId;
let ownerId;
let venueId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create a normal user
  const user = await User.create({
    name: "Regular User",
    email: "user@test.com",
    password: "hashedpassword",
    role: "Customer",
  });
  userId = user._id;
  userToken = jwt.sign({ _id: userId, role: user.role }, process.env.JWT_SECRET);

  // Create a venue owner user
  const owner = await User.create({
    name: "Venue Owner",
    email: "owner@test.com",
    password: "hashedpassword",
    role: "VenueOwner",
  });
  ownerId = owner._id;
  ownerToken = jwt.sign({ _id: ownerId, role: owner.role }, process.env.JWT_SECRET);

  // Create a venue owned by the venue owner
  const venue = await Venue.create({
    venueName: "Test Venue",
    capacity: 100,
    description: "Test venue description",
    pricePerHour: 1000,
    amenities: ["WiFi"],
    location: {
      address: "123 Venue St",
      city: "Test City",
      state: "Test State",
      country: "Test Country",
    },
    owner: ownerId,
    status: "approved",
    averageRating: 0,
    reviews: [],
  });
  venueId = venue._id;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

afterEach(async () => {
  // Clean reviews and reset average rating
  await Venue.updateOne(
    { _id: venueId },
    { $set: { reviews: [], averageRating: 0 } }
  );
});

describe("Venue Review API", () => {
  test("POST /api/:id/reviews - user can add a review", async () => {
    const res = await request(app)
      .post(`/api/${venueId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 5, comment: "Great place", title: "Excellent" });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      rating: 5,
      comment: "Great place",
      title: "Excellent",
    });

    const venue = await Venue.findById(venueId);
    expect(venue.averageRating).toBe(5);
  });

  test("POST /api/:id/reviews - user cannot add multiple reviews", async () => {
    // First review
    await request(app)
      .post(`/api/${venueId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 4, comment: "Nice", title: "Good" });

    // Second review attempt by same user
    const res = await request(app)
      .post(`/api/${venueId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 3, comment: "Changed mind", title: "Okay" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already reviewed/);
  });

  test("GET /api/:id/reviews - anyone can fetch reviews", async () => {
    // Insert review directly into DB
    await Venue.findByIdAndUpdate(venueId, {
      $push: {
        reviews: { user: userId, rating: 5, comment: "Awesome!", title: "Superb" },
      },
      averageRating: 5,
    });

    const res = await request(app).get(`/api/${venueId}/reviews`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      comment: "Awesome!",
      rating: 5,
      title: "Superb",
    });
  });

  test("DELETE /api/:venueId/reviews/:reviewId - owner can delete their review", async () => {
    // Add review by owner user (who is also the venue owner)
    const venue = await Venue.findById(venueId);
    venue.reviews.push({
      user: ownerId,
      rating: 4,
      comment: "Owner review",
      title: "Owner's opinion",
    });
    await venue.save();

    const reviewId = venue.reviews[0]._id;

    const res = await request(app)
      .delete(`/api/${venueId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/deleted/);

    const updatedVenue = await Venue.findById(venueId);
    expect(updatedVenue.reviews.length).toBe(0);
    expect(updatedVenue.averageRating).toBe(0);
  });

  test("DELETE /api/:venueId/reviews/:reviewId - user who is not owner cannot delete", async () => {
    // Add review by user
    const venue = await Venue.findById(venueId);
    venue.reviews.push({
      user: userId,
      rating: 5,
      comment: "User review",
      title: "User opinion",
    });
    await venue.save();

    const reviewId = venue.reviews[0]._id;

    // Attempt delete with different user (venue owner, but not review owner)
    const res = await request(app)
      .delete(`/api/${venueId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(404); // Review not found or unauthorized
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found or unauthorized/);
  });

  test("GET /api/owner/reviews - venue owner fetches reviews for their venues", async () => {
    // Add reviews to venue
    const venue = await Venue.findById(venueId);
    venue.reviews.push({
      user: userId,
      rating: 4,
      comment: "Nice venue",
      title: "Good",
    });
    venue.averageRating = 4;
    await venue.save();

    const res = await request(app)
      .get("/api/owner/reviews")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const firstVenue = res.body.data[0];
    expect(firstVenue).toHaveProperty("venueId");
    expect(firstVenue).toHaveProperty("venueName", "Test Venue");
    expect(firstVenue).toHaveProperty("reviews");
    expect(Array.isArray(firstVenue.reviews)).toBe(true);
    expect(firstVenue.reviews[0]).toMatchObject({ comment: "Nice venue" });
  });
});
