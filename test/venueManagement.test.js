const request = require("supertest");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const app = require("../app");
const Venue = require("../model/venue");
const User = require("../model/user");

let mongod;
let ownerToken;
let ownerId;
let venueId;

// ✅ Route prefix - match whatever you use in app.js
// If in app.js you have: app.use("/api/owner/venues", venueRoutes);
// then ROUTE_PREFIX = "/api/owner/venues"
const ROUTE_PREFIX = "/api/venueOwner/venues";

// ✅ Path to dummy test image
const imgPath = path.join(__dirname, "fixtures", "test.jpg");

beforeAll(async () => {
  // Ensure dummy test image exists
  if (!fs.existsSync(imgPath)) {
    fs.mkdirSync(path.dirname(imgPath), { recursive: true });
    // Minimal JPEG header so multer accepts it
    fs.writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create test owner
  const owner = await User.create({
    name: "Owner Test",
    email: "owner@test.com",
    password: "hashedpassword",
    role: "VenueOwner",
  });
  ownerId = owner._id;

  // Sign JWT with test secret (same as app or fallback)
  ownerToken = jwt.sign(
    { _id: ownerId, role: "VenueOwner" },
    process.env.JWT_SECRET || "testsecret"
  );

  // Create test venue
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
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Venue Management Owner Routes", () => {
  test("POST - creates a venue", async () => {
    const res = await request(app)
      .post(ROUTE_PREFIX)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        venueName: "New Venue",
        capacity: 50,
        description: "Desc",
        ownerId,
        pricePerHour: 3000,
        amenities: JSON.stringify(["AC"]),
        location: JSON.stringify({
          address: "Address",
          city: "City",
          state: "State",
          country: "Nepal",
        }),
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("POST - All field needed", async () => {
    const res = await request(app)
      .post(ROUTE_PREFIX)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        venueName: "Invalid Venue",
        capacity: 50,
        description: "Desc",
        ownerId,
        pricePerHour: 3000,
      });

    expect(res.statusCode).toBe(500);
  });

  test("POST images - uploads images", async () => {
    const res = await request(app)
      .post(`${ROUTE_PREFIX}/${venueId}/images`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("venueImages", imgPath);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("POST images - returns 404 if not found", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`${ROUTE_PREFIX}/${fakeId}/images`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("venueImages", imgPath);

    expect(res.statusCode).toBe(404);
  });

  test("PUT - updates venue", async () => {
    const res = await request(app)
      .put(`${ROUTE_PREFIX}/${venueId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("venueName", "Updated Venue")
      .attach("venueImages", imgPath);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.venueName).toBe("Updated Venue");
  });

  test("PUT - returns 404 if venue not found", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .put(`${ROUTE_PREFIX}/${fakeId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("venueName", "Updated Venue");

    expect(res.statusCode).toBe(404);
  });

  test("DELETE - deletes venue", async () => {
    const venue = await Venue.create({
      venueName: "To Delete",
      capacity: 30,
      description: "temp",
      pricePerHour: 2000,
      location: {
        address: "Addr",
        city: "City",
        state: "State",
        country: "Nepal",
      },
      owner: ownerId,
    });

    const res = await request(app)
      .delete(`${ROUTE_PREFIX}/${venue._id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("DELETE - returns 404 if not found", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`${ROUTE_PREFIX}/${fakeId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(404);
  });

  test("GET - returns venues by owner", async () => {
    const res = await request(app)
      .get(`${ROUTE_PREFIX}?ownerId=${ownerId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET - returns 400 if missing ownerId", async () => {
    const res = await request(app)
      .get(`${ROUTE_PREFIX}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET approvedCount - returns count", async () => {
    const res = await request(app)
      .get(`${ROUTE_PREFIX}/approvedCountByOwner?ownerId=${ownerId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.count).toBe("number");
  });

  test("GET approvedCount - returns 400 if missing ownerId", async () => {
    const res = await request(app)
      .get(`${ROUTE_PREFIX}/approvedCountByOwner`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(400);
  });
});
