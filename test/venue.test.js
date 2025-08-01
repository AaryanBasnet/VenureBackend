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

  // Seed one approved venue for filtering tests
  await Venue.create({
    venueName: "Approved Venue",
    capacity: 150,
    description: "Already approved venue",
    owner: ownerId,
    pricePerHour: 3000,
    amenities: ["Wifi", "Parking", "AC"],
    status: "approved",
    isDeleted: false,
    location: {
      address: "Somewhere",
      city: "Kathmandu",
      state: "Bagmati",
      country: "Nepal",
    },
  });
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

  // test("Get approved venue count (should be 0 for new venue)", async () => {
  //   const res = await request(app)
  //     .get(`/api/venueOwner/venues/approvedCountByOwner?ownerId=${ownerId}`)
  //     .set("Authorization", `Bearer ${token}`);

  //   expect(res.statusCode).toBe(200);
  //   expect(res.body.success).toBe(true);
  //   expect(res.body.count).toBe(0);
  // });

  test("Fetch all approved venues (default)", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues");

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  test("Filter approved venues by search term", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?search=Approved");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.every(v => v.venueName.includes("Approved"))).toBe(true);
  });

  test("Filter approved venues by city", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?city=Kathmandu");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.every(v => v.location.city === "Kathmandu")).toBe(true);
  });

  test("Filter approved venues by capacity range", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?capacityRange=101-200");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.every(v => v.capacity >= 101 && v.capacity <= 200)).toBe(true);
  });

  test("Filter approved venues by amenities", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?amenities=Wifi,Parking");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("Sort approved venues by price low-to-high", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?sort=low-to-high");

    expect(res.statusCode).toBe(200);
    const prices = res.body.data.map(v => v.pricePerHour);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test("Paginated approved venues", async () => {
    const res = await request(app)
      .get("/api/user/venues/getApprovedVenues?page=1&limit=1");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.page).toBe(1);
  });

  test("Fetch a venue by ID", async () => {
    const res = await request(app)
      .get(`/api/user/venues/${venueId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(venueId.toString());
  });

  test("Return 404 for non-existing venue", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/user/venues/${fakeId}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Venue not found");
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
