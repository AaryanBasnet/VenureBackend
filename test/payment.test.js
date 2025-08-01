const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Booking = require("../model/booking");
const User = require("../model/user");
const jwt = require("jsonwebtoken");
const stripeLib = require("stripe");

jest.mock("stripe");

let mongoServer;
let app;
let authToken;

describe("Payment Controller - createPaymentIntent", () => {
  let stripeMock;
  let paymentIntentsCreateMock;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();

    await mongoose.connect(uri);

    app = require("../app");

    stripeMock = {
      paymentIntents: {
        create: jest.fn(),
      },
    };
    stripeLib.mockImplementation(() => stripeMock);
    paymentIntentsCreateMock = stripeMock.paymentIntents.create;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    jest.clearAllMocks();

    // Create fresh test user & generate token
    const user = await User.create({
      name: "Test User",
      email: "test@example.com",
      password: "hashedpassword",
      role: "Customer",
    });

    authToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
  });

  test("should create payment intent successfully when no booking conflict", async () => {
    jest.spyOn(Booking, "findOne").mockResolvedValue(null);

    paymentIntentsCreateMock.mockResolvedValue({
      client_secret: "test_client_secret",
      id: "pi_test123",
    });

    // Debug token before request
    console.log("AuthToken:", authToken);

    const res = await request(app)
      .post("/api/payment/create-payment-intent")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: 13200,
        venueId: new mongoose.Types.ObjectId().toString(),
        bookingDate: "2025-08-01",
        timeSlot: "morning",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      clientSecret: "test_client_secret",
      paymentIntentId: "pi_test123",
    });
    expect(paymentIntentsCreateMock).toHaveBeenCalledTimes(1);
  });

  test("should return 400 if booking slot already booked", async () => {
    jest
      .spyOn(Booking, "findOne")
      .mockResolvedValue({ _id: "existing_booking" });

    const res = await request(app)
      .post("/api/payment/create-payment-intent")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: 13200,
        venueId: new mongoose.Types.ObjectId().toString(),
        bookingDate: "2025-08-01",
        timeSlot: "morning",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Slot already booked.",
    });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  test("should return 500 if an error occurs", async () => {
    jest.spyOn(Booking, "findOne").mockRejectedValue(new Error("DB failure"));

    const res = await request(app)
      .post("/api/payment/create-payment-intent")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: 13200,
        venueId: new mongoose.Types.ObjectId().toString(),
        bookingDate: "2025-08-01",
        timeSlot: "morning",
      });

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });
});
