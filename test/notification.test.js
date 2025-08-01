const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const app = require("../app");
const Notification = require("../model/notification");
const User = require("../model/user");

let mongod;
let userId;
let userToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create test user
  const user = await User.create({
    name: "Test User",
    email: "testuser@example.com",
    password: "password123",
    role: "Customer",
  });
  userId = user._id;

  userToken = jwt.sign(
    { _id: userId, role: "Customer" },
    process.env.JWT_SECRET || "testsecret"
  );

  // Create some notifications for this user
  await Notification.create([
    {
      recipient: userId,
      type: "security",
      message: "Notification 1",
      read: false,
    },
    {
      recipient: userId,
      type: "security",
      message: "Notification 2",
      read: false,
    },
    {
      recipient: userId,
      type: "security",
      message: "Notification 3",
      read: true,
    },
  ]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});
describe("Notification Controller", () => {
  test("GET /api/notification - should fetch notifications for user", async () => {
    const res = await request(app)
      .get("/api/notification")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body[0]).toHaveProperty("recipient");
    expect(res.body[0].recipient).toBe(String(userId));
  });

  test("PATCH /api/notification/:id/read - should mark notification as read", async () => {
    const unreadNotification = await Notification.findOne({
      recipient: userId,
      read: false,
    });
    expect(unreadNotification).not.toBeNull();

    const res = await request(app)
      .patch(`/api/notification/${unreadNotification._id}/read`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Notification.findById(unreadNotification._id);
    expect(updated.read).toBe(true);
  });

  test("PATCH /api/notification/read-all - should mark all unread as read", async () => {
    let unreadCountBefore = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });
    expect(unreadCountBefore).toBeGreaterThan(0);

    const res = await request(app)
      .patch("/api/notification/read-all")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const unreadCountAfter = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });
    expect(unreadCountAfter).toBe(0);
  });

  test("Unauthorized requests should be rejected", async () => {
    const res = await request(app).get("/api/notification");
    expect(res.statusCode).toBe(401);
  });
});
