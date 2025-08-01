const request = require("supertest");
const app = require("../app");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Booking = require("../model/booking");
const Venue = require("../model/venue");
const User = require("../model/user");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "testsecret"; // ✅ Ensure JWT works

let mongod;
let customerToken, ownerToken, adminToken;
let customerId, ownerId, venueId, bookingId;

jest.mock("stripe", () => {
  return jest.fn(() => ({
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({
        id: "pi_test_123",
        amount_received: 300,
        payment_method: "card",
        status: "succeeded",
      }),
    },
  }));
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create Users
  const customer = await User.create({
    name: "Cust",
    role: "Customer",
    email: "cust@test.com",
    password: "hashed",
  });

  const owner = await User.create({
    name: "Owner",
    role: "VenueOwner",
    email: "owner@test.com",
    password: "hashed",
  });

  const admin = await User.create({
    name: "Admin",
    role: "Admin",
    email: "admin@test.com",
    password: "hashed",
  });

  customerId = customer._id;
  ownerId = owner._id;

  // JWT Tokens
  customerToken = jwt.sign({ _id: customerId, role: "Customer" }, process.env.JWT_SECRET);
  ownerToken = jwt.sign({ _id: ownerId, role: "VenueOwner" }, process.env.JWT_SECRET);
  adminToken = jwt.sign({ _id: admin._id, role: "Admin" }, process.env.JWT_SECRET);

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

  // Create Initial Booking
  const booking = await Booking.create({
    customer: customerId,
    venue: venueId,
    bookingDate: new Date(),
    timeSlot: "10:00-12:00",
    hoursBooked: 2,
    numberOfGuests: 10,
    eventType: "Wedding",
    contactName: "Contact Person",
    phoneNumber: "1234567890",
    selectedAddons: [],
    totalPrice: 200,
    paymentDetails: {
      paymentIntentId: "pi_test_123",
      amountReceived: 300,
      paymentMethod: "card",
      status: "succeeded",
    },
  });

  bookingId = booking._id;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Booking API Tests", () => {
  test("Customer can create a booking", async () => {
    const res = await request(app)
      .post("/api/bookings/createBooking")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        customer: customerId,
        venue: venueId,
        bookingDate: new Date().toISOString(), // ✅ safer
        timeSlot: "14:00-16:00",
        hoursBooked: 2,
        numberOfGuests: 20,
        eventType: "Party",
        contactName: "John Doe",
        phoneNumber: "9876543210",
        selectedAddons: [],
        totalPrice: 300,
        paymentDetails: { // ✅ matches schema
          paymentIntentId: "pi_test_456",
          amountReceived: 300,
          paymentMethod: "card",
          status: "succeeded",
        },
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("booking");
    expect(res.body.booking.customer).toBe(String(customerId));
  });
});

describe("Booking API Tests", () => {
  test("Customer can create a booking", async () => {
    const res = await request(app)
      .post("/api/bookings/createBooking")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        customer: customerId,
        venue: venueId,
        bookingDate: new Date(),
        timeSlot: "14:00-16:00",
        hoursBooked: 2,
        numberOfGuests: 20,
        eventType: "Party",
        contactName: "John Doe",
        phoneNumber: "9876543210",
        selectedAddons: [],
        totalPrice: 300,
        paymentDetails: {
          paymentIntentId: "pi_test_123",
          amountReceived: 300,
          paymentMethod: "card",
          status: "succeeded",
        },
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("booking");
    expect(res.body.booking.customer).toBe(String(customerId));
  });

  test("Owner can cancel a booking", async () => {
    const res = await request(app)
      .put(`/api/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.booking.status).toBe("cancelled");
  });

  test("Owner can approve a booking", async () => {
    const newBooking = await Booking.create({
      customer: customerId,
      venue: venueId,
      bookingDate: new Date(),
      timeSlot: "16:00-18:00",
      hoursBooked: 2,
      numberOfGuests: 5,
      eventType: "Meeting",
      contactName: "Jane Doe",
      phoneNumber: "9876543210",
      selectedAddons: [],
      totalPrice: 150,
      paymentDetails: {
        cardNumber: "4111111111111111",
        expiryDate: "11/25",
        cvv: "321",
        cardholderName: "Jane Doe",
      },
      status: "booked",
    });

    const res = await request(app)
      .put(`/api/bookings/${newBooking._id}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.booking.status).toBe("approved");
  });

  test("Owner can get their bookings", async () => {
    const res = await request(app)
      .get("/api/bookings/owner")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("Admin can get total bookings", async () => {
    const res = await request(app)
      .get("/api/bookings/admin/total")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data).toBe("number");
  });

  test("Customer cannot access admin route", async () => {
    const res = await request(app)
      .get("/api/bookings/admin/total")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.statusCode).toBe(403);
  });

  test("Customer can get their own bookings", async () => {
    const res = await request(app)
      .get("/api/bookings/my-bookings")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("Get customer booking count", async () => {
    const res = await request(app)
      .get("/api/bookings/count")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data).toBe("number");
  });

  test("Owner can get monthly earnings", async () => {
    const res = await request(app)
      .get("/api/bookings/owner/monthly-earning")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("Owner can get total approved/completed bookings", async () => {
    const res = await request(app)
      .get("/api/bookings/owner/total")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data).toBe("number");
  });

  test("Get top venues by booking", async () => {
    const res = await request(app).get("/api/bookings/top-venues");

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
