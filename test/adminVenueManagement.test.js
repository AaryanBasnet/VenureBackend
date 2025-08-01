const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const app = require("../app");
const Venue = require("../model/venue");
const User = require("../model/user");

let mongod;
let adminToken;
let adminId;
let venueApprovedId;
let venuePendingId;

const ROUTE_PREFIX = "/api/admin/venues"; // Matches your routes

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create admin user
  const admin = await User.create({
    name: "Admin Test",
    email: "admin@test.com",
    password: "hashedpassword",
    role: "Admin",
  });
  adminId = admin._id;

  adminToken = jwt.sign(
    { _id: adminId, role: "Admin" },
    process.env.JWT_SECRET || "testsecret"
  );

  // Create approved venue
  const venueApproved = await Venue.create({
    venueName: "Approved Venue",
    capacity: 100,
    description: "Desc",
    pricePerHour: 5000,
    location: { address: "Addr", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    owner: adminId,
    status: "approved",
  });
  venueApprovedId = venueApproved._id;

  // Create pending venue
  const venuePending = await Venue.create({
    venueName: "Pending Venue",
    capacity: 80,
    description: "Desc",
    pricePerHour: 4000,
    location: { address: "Addr", city: "Pokhara", state: "Gandaki", country: "Nepal" },
    owner: adminId,
    status: "pending",
  });
  venuePendingId = venuePending._id;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Admin Venue Management Routes", () => {
  describe("GET /api/admin/venues", () => {
    test("should return all venues without filters", async () => {
      const res = await request(app)
        .get(`${ROUTE_PREFIX}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    test("should filter venues by status", async () => {
      const res = await request(app)
        .get(`${ROUTE_PREFIX}?status=approved`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe("approved");
    });

    test("should search venues by city", async () => {
      const res = await request(app)
        .get(`${ROUTE_PREFIX}?search=Pokhara`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].location.city).toMatch(/Pokhara/i);
    });

    test("should apply pagination", async () => {
      const res = await request(app)
        .get(`${ROUTE_PREFIX}?page=1&limit=1`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.pagination.total).toBe(2);
    });
  });

  describe("GET /api/admin/venues/getApprovedCount", () => {
    test("should return the count of approved venues", async () => {
      const res = await request(app)
        .get(`${ROUTE_PREFIX}/getApprovedCount`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalApproved).toBe(1);
    });
  });

  describe("PATCH /api/admin/venues/:id/status", () => {
    test("should update venue status to approved", async () => {
      const res = await request(app)
        .patch(`${ROUTE_PREFIX}/${venuePendingId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "approved" });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("approved");
    });

    test("should reject invalid status", async () => {
      const res = await request(app)
        .patch(`${ROUTE_PREFIX}/${venueApprovedId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "wrongstatus" });

      expect(res.statusCode).toBe(400);
    });

    test("should return 404 if venue not found", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`${ROUTE_PREFIX}/${fakeId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "approved" });

      expect(res.statusCode).toBe(404);
    });
  });
});
