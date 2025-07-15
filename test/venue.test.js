const request = require("supertest");
const app = require("../app");
const mongoose = require("mongoose");
const User = require("../model/user");
const Venue = require("../model/venue");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;
let token;
let ownerId;
let venueId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create Venue Owner
  const owner = await User.create({
    name: "Test Owner",
    email: "owner@example.com",
    phone: "9812345678",
    password: "hashedpassword",
    role: "VenueOwner",
  });

  ownerId = owner._id;

  // Generate Token
  token = jwt.sign(
    { _id: ownerId, role: "VenueOwner" },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Venue API Tests", () => {
  test("Create a venue without images", async () => {
    const res = await request(app)
      .post("/api/venueOwner/venues")
      .set("Authorization", `Bearer ${token}`)
      .send({
        venueName: "Test Venue",
        capacity: 200,
        description: "A test venue for weddings",
        ownerId: ownerId.toString(),
        pricePerHour: 5000,
        amenities: ["Wifi", "Parking"],
        location: {
          address: "Street 1",
          city: "Kathmandu",
          state: "Bagmati",
          country: "Nepal",
        },
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("_id");
    expect(res.body.data.venueName).toBe("Test Venue");

    venueId = res.body.data._id; // Save for other tests
  });

  test("Get venues by owner", async () => {
    const res = await request(app)
      .get(`/api/venueOwner/venues?ownerId=${ownerId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("Get approved venue count (should be 0 initially)", async () => {
    const res = await request(app)
      .get(`/api/venueOwner/venues/approvedCountByOwner?ownerId=${ownerId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
  });

  test("Delete venue", async () => {
    const res = await request(app)
      .delete(`/api/venueOwner/venues/${venueId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Venue deleted successfully");
  });
});
