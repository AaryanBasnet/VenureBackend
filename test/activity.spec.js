const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const ActivityLog = require("../model/activityLog");
const Booking = require("../model/booking");
const {
  createActivityLog,
} = require("../controller/admin/adminDashboardController");

let mongod;
let adminId;
let customerToken, ownerToken, adminToken;
let customerId, ownerId, venueId, bookingId;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // 1️⃣ Create users
  const adminUser = await User.create({
    name: "Admin Test",
    email: "admin@example.com",
    password: "hashedpassword",
    role: "Admin",
  });

  const ownerUser = await User.create({
    name: "Owner Test",
    email: "owner@example.com",
    password: "hashedpassword",
    role: "VenueOwner",
  });

  const customerUser = await User.create({
    name: "Customer Test",
    email: "customer@example.com",
    password: "hashedpassword",
    role: "Customer",
  });

  adminId = adminUser._id;
  ownerId = ownerUser._id;
  customerId = customerUser._id;

  // 2️⃣ Create tokens
  adminToken = jwt.sign(
    { _id: adminId, role: "Admin" },
    process.env.JWT_SECRET || "testsecret"
  );
  ownerToken = jwt.sign(
    { _id: ownerId, role: "VenueOwner" },
    process.env.JWT_SECRET || "testsecret"
  );
  customerToken = jwt.sign(
    { _id: customerId, role: "Customer" },
    process.env.JWT_SECRET || "testsecret"
  );

  // 3️⃣ Create venue
  const venue = await Venue.create({
    venueName: "Test Venue",
    capacity: 100,
    description: "Test venue description",
    pricePerHour: 5000,
    amenities: ["Wifi"],
    location: {
      address: "Some address",
      city: "Kathmandu",
      state: "Bagmati",
      country: "Nepal",
    },
    owner: ownerId,
    status: "pending",
  });
  venueId = venue._id;

  // 4️⃣ Create activity logs
  for (let i = 0; i < 5; i++) {
    await ActivityLog.create({
      type: "system",
      message: `Log ${i}`,
      createdBy: adminId,
      createdAt: new Date(Date.now() - i * 1000),
    });
  }

  // 5️⃣ Create booking
  await Booking.create({
    customer: customerId,
    venue: venue._id,
    bookingDate: new Date(new Date().getFullYear(), 0, 15),
    timeSlot: "10:00-12:00",
    hoursBooked: 2,
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Test Contact",
    phoneNumber: "9800000000",
    selectedAddons: [],
    totalPrice: 5000,
    status: "approved",
    paymentDetails: {
      paymentIntentId: "pi_test_123",
      amountReceived: 5000,
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

describe("Admin Dashboard - Activity Logs", () => {
  test("should return latest logs", async () => {
    const res = await request(app).get("/api/admin/activity/logs");

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("message");
  });

  test("should handle DB error on logs route", async () => {
    const origFind = ActivityLog.find;
    ActivityLog.find = jest.fn().mockImplementation(() => {
      throw new Error("DB error");
    });

    const res = await request(app).get("/api/admin/activity/logs");

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to fetch activity logs");

    ActivityLog.find = origFind; // restore
  });
});

describe("Admin Dashboard - Monthly Earnings", () => {
  test("should return earnings for 12 months", async () => {
    const res = await request(app)
      .get("/api/admin/earnings/monthly")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(12);

    const jan = res.body.data.find((m) => m.month === "Jan");
    expect(jan.totalEarnings).toBeGreaterThan(0);
    expect(jan.bookingCount).toBeGreaterThan(0);
  });

  test("should require authentication for monthly earnings", async () => {
    const res = await request(app).get("/api/admin/earnings/monthly");
    expect(res.statusCode).toBe(401);
  });

  test("should handle DB error on monthly earnings route", async () => {
    const origAggregate = Booking.aggregate;
    Booking.aggregate = jest.fn().mockImplementation(() => {
      throw new Error("DB error");
    });

    const res = await request(app)
      .get("/api/admin/earnings/monthly")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Server error");

    Booking.aggregate = origAggregate; // restore
  });
});

describe("Admin Dashboard - createActivityLog helper", () => {
  test("should create a log successfully", async () => {
    await createActivityLog("system", "Helper test log", adminId, {
      foo: "bar",
    });

    const log = await ActivityLog.findOne({ message: "Helper test log" });
    expect(log).not.toBeNull();
    expect(log.type).toBe("system");
    expect(log.data.foo).toBe("bar");
  });

  test("should handle error without throwing", async () => {
    const origSave = ActivityLog.prototype.save;
    ActivityLog.prototype.save = jest
      .fn()
      .mockRejectedValue(new Error("Save failed"));

    await expect(
      createActivityLog("system", "Will fail", adminId)
    ).resolves.not.toThrow();

    ActivityLog.prototype.save = origSave; // restore
  });
});
