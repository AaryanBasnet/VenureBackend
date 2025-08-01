// test/adminUser.spec.js
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../app");
const User = require("../model/user");
const Booking = require("../model/booking");
const Venue = require("../model/venue");

let mongod;
let adminId, customerId, ownerId, venueId;
let adminToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create Admin
  const admin = await User.create({
    name: "Admin",
    email: "admin@test.com",
    password: "adminpass",
    role: "Admin",
  });
  adminId = admin._id;

  // Create Owner
  const owner = await User.create({
    name: "Venue Owner",
    email: "owner@test.com",
    password: "ownerpass",
    role: "VenueOwner",
  });
  ownerId = owner._id;

  // Create Customer
  const customer = await User.create({
    name: "John Doe",
    email: "john@test.com",
    password: "customerpass",
    role: "Customer",
  });
  customerId = customer._id;

  // Create Venue
  const venue = await Venue.create({
    venueName: "Test Venue",
    owner: ownerId,
    location: {
      country: "Nepal",
      state: "Bagmati",
      city: "Kathmandu",
      address: "Baneshwor, Kathmandu",
    },
    pricePerHour: 100,
  });
  venueId = venue._id;

  // Generate adminToken
  adminToken = jwt.sign(
    { _id: adminId, role: "Admin" },
    process.env.JWT_SECRET || "testsecret"
  );

  // Create Booking for Customer
  await Booking.create({
    customer: customerId,
    venue: venueId,
    bookingDate: new Date(),
    timeSlot: "12:00-14:00",
    hoursBooked: 2,
    numberOfGuests: 30,
    eventType: "Party",
    contactName: "John",
    phoneNumber: "9800000000",
    selectedAddons: [],
    totalPrice: 4000,
    status: "booked",
    paymentDetails: {
      paymentIntentId: "pi_123",
      amountReceived: 4000,
      paymentMethod: "card",
      status: "succeeded",
    },
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Admin User Management", () => {
  test("Get paginated users with booking count", async () => {
    const res = await request(app)
      .get("/api/admin/user/getAll?page=1&limit=10") // <-- matches your router.get("/getAll")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("bookingCount");
  });

  test("Get single user by ID", async () => {
    const res = await request(app)
      .get(`/api/admin/user/${customerId}`) // <-- matches router.get("/:id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe("john@test.com");
  });

  test("Delete user", async () => {
    const newUser = await User.create({
      name: "Delete Me",
      email: "delete@test.com",
      password: "testpass",
      role: "Customer",
    });

    const res = await request(app)
      .delete(`/api/admin/user/${newUser._id}`) // <-- matches router.delete("/:id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Get total customers count", async () => {
    const res = await request(app)
      .get("/api/admin/user/getCustomerCount") // <-- matches router.get("/getCustomerCount")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.totalCustomers).toBe("number");
    expect(res.body.totalCustomers).toBeGreaterThan(0);
  });
});
