const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const Review = require("../model/review");

let mongod;
let customerId;
let ownerId;
let venueId;
let spaceId;
let customerAgent;
let ownerAgent;
let adminAgent;

const PASSWORD = "Test@1234";

const loginAgent = async (email) => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  return agent;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const hashed = await bcrypt.hash(PASSWORD, 10);

  const customer = await User.create({ name: "Regular User", email: "user@test.com", password: hashed, role: "Customer" });
  const owner = await User.create({ name: "Venue Owner", email: "owner@test.com", password: hashed, role: "VenueOwner" });
  await User.create({ name: "Admin", email: "admin@test.com", password: hashed, role: "Admin" });
  customerId = customer._id;
  ownerId = owner._id;

  const venue = await Venue.create({
    venueName: "Test Venue",
    owner: ownerId,
    status: "approved",
    location: { address: "123 Venue St", city: "Test City", state: "Test State", country: "Test Country" },
  });
  venueId = venue._id;
  const space = await Space.create({ venue: venueId, name: "Hall", capacity: 100 });
  spaceId = space._id;

  customerAgent = await loginAgent("user@test.com");
  ownerAgent = await loginAgent("owner@test.com");
  adminAgent = await loginAgent("admin@test.com");
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

afterEach(async () => {
  await Review.deleteMany({});
  await Booking.deleteMany({});
  await Venue.updateOne({ _id: venueId }, { averageRating: 0, totalReviews: 0 });
});

const createCompletedBooking = async () => {
  return await Booking.create({
    customer: customerId,
    venue: venueId,
    space: spaceId,
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endTime: new Date(Date.now() - 60 * 60 * 1000),
    numberOfGuests: 10,
    eventType: "Birthday",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
    totalPrice: 10000,
    depositAmount: 2000,
    balanceAmount: 8000,
    status: "completed",
  });
};

describe("Review API", () => {
  test("POST /api/venue/:venueId - customer can review a completed booking", async () => {
    const booking = await createCompletedBooking();
    const res = await customerAgent
      .post(`/api/venue/${venueId}`)
      .send({ bookingId: booking._id.toString(), rating: 5, comment: "Great place", title: "Excellent" });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ rating: 5, comment: "Great place", title: "Excellent" });

    const venue = await Venue.findById(venueId);
    expect(venue.averageRating).toBe(5);
  });

  test("POST /api/venue/:venueId - rejects a review without a completed booking", async () => {
    const res = await customerAgent
      .post(`/api/venue/${venueId}`)
      .send({ bookingId: new mongoose.Types.ObjectId().toString(), rating: 5, comment: "Nice", title: "Good" });

    expect(res.statusCode).toBe(403);
  });

  test("POST /api/venue/:venueId - rejects a duplicate review for the same booking", async () => {
    const booking = await createCompletedBooking();
    await customerAgent
      .post(`/api/venue/${venueId}`)
      .send({ bookingId: booking._id.toString(), rating: 4, comment: "Nice", title: "Good" });

    const res = await customerAgent
      .post(`/api/venue/${venueId}`)
      .send({ bookingId: booking._id.toString(), rating: 3, comment: "Changed mind", title: "Okay" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already reviewed/);
  });

  test("GET /api/venue/:venueId - anyone can fetch reviews", async () => {
    const booking = await createCompletedBooking();
    await Review.create({ venue: venueId, booking: booking._id, user: customerId, rating: 5, comment: "Awesome!", title: "Superb" });

    const res = await request(app).get(`/api/venue/${venueId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({ comment: "Awesome!", rating: 5, title: "Superb" });
  });

  test("DELETE /api/:reviewId - the review's author can delete it", async () => {
    const booking = await createCompletedBooking();
    const review = await Review.create({ venue: venueId, booking: booking._id, user: customerId, rating: 4, comment: "My review", title: "Opinion" });

    const res = await customerAgent.delete(`/api/${review._id}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await Review.findById(review._id)).toBeNull();
  });

  test("DELETE /api/:reviewId - a different user cannot delete someone else's review", async () => {
    const booking = await createCompletedBooking();
    const review = await Review.create({ venue: venueId, booking: booking._id, user: customerId, rating: 5, comment: "User review", title: "Opinion" });

    const res = await ownerAgent.delete(`/api/${review._id}`);

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/owner - venue owner fetches reviews for their venues", async () => {
    const booking = await createCompletedBooking();
    await Review.create({ venue: venueId, booking: booking._id, user: customerId, rating: 4, comment: "Nice venue", title: "Good" });

    const res = await ownerAgent.get("/api/owner");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ comment: "Nice venue" });
    expect(res.body.data[0].venue).toMatchObject({ venueName: "Test Venue" });
  });

  test("PATCH /api/:reviewId/feature - admin can toggle featured status", async () => {
    const booking = await createCompletedBooking();
    const review = await Review.create({ venue: venueId, booking: booking._id, user: customerId, rating: 5, comment: "Great", title: "Nice" });

    const res = await adminAgent.patch(`/api/${review._id}/feature`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.isFeatured).toBe(true);
  });
});
