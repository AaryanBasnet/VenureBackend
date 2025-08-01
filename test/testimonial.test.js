const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
process.env.JWT_SECRET = "testsecret"; // must be set before importing app

const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const Testimonial = require("../model/testimonial");
const jwt = require("jsonwebtoken");

let mongod;
let userToken, userId, venueId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Create test user
  const user = await User.create({
    name: "Test User",
    email: "testuser@example.com",
    password: "hashedpassword",
    role: "Customer",
  });
  userId = user._id;

  // Create test venue
  const venue = await Venue.create({
    venueName: "Test Venue",
    owner: userId,
    location: {
      country: "Nepal",
      state: "Bagmati",
      city: "Kathmandu",
      address: "Street 1",
    },
    pricePerHour: 1000,
  });
  venueId = venue._id;

  // Create approved booking so user can get booked venues
  await Booking.create({
    customer: userId,
    venue: venueId,
    bookingDate: new Date(),
    timeSlot: "morning",
    status: "approved",
    totalPrice: 1000,
    phoneNumber: "1234567890",
    contactName: "John Doe",
    eventType: "Wedding",
    numberOfGuests: 50,
    hoursBooked: 4,
    selectedAddons: [],
    paymentDetails: {
      paymentIntentId: "pi_test_123",
      amountReceived: 1000,
      paymentMethod: "card",
      status: "succeeded",
    },
  });

  // Generate JWT token for auth
  userToken = jwt.sign({ _id: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Testimonial.deleteMany({});
});

describe("Testimonial Controller", () => {
  describe("GET /api/testimonials/my-venues", () => {
    test("should return unique booked venues for user", async () => {
      const res = await request(app)
        .get("/api/testimonials/my-venues")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]).toHaveProperty("venueName", "Test Venue");
    });
  });

  describe("POST /api/testimonials", () => {
    test("should create a new testimonial", async () => {
      const res = await request(app)
        .post("/api/testimonials")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          venue: venueId.toString(),
          rating: 5,
          comment: "Amazing venue!",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Testimonial submitted!");

      const created = await Testimonial.findOne({
        user: userId,
        venue: venueId,
      });
      expect(created).not.toBeNull();
      expect(created.rating).toBe(5);
      expect(created.comment).toBe("Amazing venue!");
    });

    test("should return 400 if fields are missing", async () => {
      const res = await request(app)
        .post("/api/testimonials")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          venue: venueId.toString(),
          rating: 5,
          // comment missing
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("All fields required");
    });
  });

  describe("GET /api/testimonials/admin", () => {
    // create an admin user token for testing admin route
    let adminToken;
    beforeAll(async () => {
      const adminUser = await User.create({
        name: "Admin User",
        email: "admin@example.com",
        password: "hashedpassword",
        role: "Admin",
      });
      adminToken = jwt.sign(
        { _id: adminUser._id.toString(), role: "Admin" },
        process.env.JWT_SECRET,
        {
          expiresIn: "1d",
        }
      );

      // Create some testimonials
      await Testimonial.create([
        { venue: venueId, user: userId, rating: 4, comment: "Nice place" },
        {
          venue: venueId,
          user: userId,
          rating: 5,
          comment: "Great experience",
        },
      ]);
    });

    test("should fetch all testimonials with populated user and venue", async () => {
      // Create testimonials before fetching
      await Testimonial.create([
        {
          venue: venueId,
          user: userId,
          rating: 4,
          comment: "Nice place",
        },
        {
          venue: venueId,
          user: userId,
          rating: 5,
          comment: "Great experience",
        },
      ]);

      const res = await request(app)
        .get("/api/testimonials/admin")
        .set("Authorization", `Bearer ${adminToken}`) // Ensure admin auth token
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0]).toHaveProperty("user");
      expect(res.body.data[0]).toHaveProperty("venue");
      expect(res.body.data[0].user).toHaveProperty("name");
    });
  });

  describe("GET /api/testimonials/highest-rated", () => {
    test("should fetch the testimonial with highest rating", async () => {
      await Testimonial.create([
        { venue: venueId, user: userId, rating: 3, comment: "Okay" },
        { venue: venueId, user: userId, rating: 5, comment: "Excellent!" },
        { venue: venueId, user: userId, rating: 4, comment: "Good" },
      ]);

      const res = await request(app)
        .get("/api/testimonials/highest-rated")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.rating).toBe(5);
      expect(res.body.data.comment).toBe("Excellent!");
      expect(res.body.data).toHaveProperty("user");
      expect(res.body.data).toHaveProperty("venue");
    });
  });
});

test("GET /api/testimonials/booked-venues returns empty array if no bookings", async () => {
  // create a user without bookings
  const noBookingUser = await User.create({
    name: "NoBookingUser",
    email: "nobooking@example.com",
    password: "hashed",
    role: "Customer",
  });
  const noBookingToken = jwt.sign({ _id: noBookingUser._id.toString() }, process.env.JWT_SECRET);

  const res = await request(app)
    .get("/api/testimonials/my-venues")
    .set("Authorization", `Bearer ${noBookingToken}`)
    .expect(200);

  expect(res.body.success).toBe(true);
  expect(Array.isArray(res.body.data)).toBe(true);
  expect(res.body.data.length).toBe(0);
});

