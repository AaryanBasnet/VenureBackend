const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");

let mongod;
let userToken;
let venueId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create user
  await request(app).post("/api/auth/register").send({
    name: "Test User",
    email: "test@example.com",
    phone: "9812345678",
    password: "test123",
    role: "Customer",
  });

  const res = await request(app).post("/api/auth/login").send({
    email: "test@example.com",
    password: "test123",
  });
  userToken = res.body.token;

  // Create venue with a venue owner
  const owner = await User.create({
    name: "Owner",
    email: "owner@example.com",
    password: "hashedpassword",
    phone: "9800000000",
    role: "VenueOwner",
  });

  const venueRes = await request(app)
    .post("/api/venueOwner/venues")
    .set(
      "Authorization",
      `Bearer ${jwt.sign(
        { _id: owner._id, role: "VenueOwner" },
        process.env.JWT_SECRET
      )}`
    )
    .send({
      venueName: "Test Venue",
      capacity: 100,
      description: "Nice place",
      pricePerHour: 5000,
      ownerId: owner._id.toString(),
      amenities: ["Wifi"],
      location: {
        address: "Kathmandu",
        city: "Kathmandu",
        state: "Bagmati",
        country: "Nepal",
      },
    });

  venueId = venueRes.body.data._id;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});
describe("Favorites API", () => {
  it("should add a venue to favorites", async () => {
    const res = await request(app)
      .post(`/api/user/favorites/${venueId}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Added to favorites");
    expect(res.body.favorites).toContain(venueId.toString());
  });

  it("should remove the same venue if already in favorites (toggle off)", async () => {
    const res = await request(app)
      .post(`/api/user/favorites/${venueId}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Removed from favorites");
    expect(res.body.favorites).not.toContain(venueId.toString());
  });

  it("should return list of favorite venue IDs", async () => {
    // Add back to favorites
    await request(app)
      .post(`/api/user/favorites/${venueId}`)
      .set("Authorization", `Bearer ${userToken}`);

    const res = await request(app)
      .get("/api/user/favorites")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.favorites)).toBe(true);
    expect(
      res.body.favorites.some((v) => v._id.toString() === venueId.toString())
    ).toBe(true);
  });

  it("should return favorite venue details", async () => {
    const res = await request(app)
      .get("/api/user/favorites/venues")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty("venueName", "Test Venue");
  });
});
