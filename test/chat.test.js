const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const Chat = require("../model/chat");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret";

let mongod;
let user1Token, user2Token, venueId, user1Id, user2Id;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Create users
  const user1 = await User.create({
    name: "User One",
    email: "user1@example.com",
    password: "hashed",
    role: "Customer",
  });
  user1Id = user1._id;

  const user2 = await User.create({
    name: "User Two",
    email: "user2@example.com",
    password: "hashed",
    role: "VenueOwner",
  });
  user2Id = user2._id;

  // Create venue owned by user2
  const venue = await Venue.create({
    venueName: "Test Venue",
    owner: user2Id,
    location: {
      country: "Nepal",
      state: "Bagmati",
      city: "Kathmandu",
      address: "Street 1",
    },
    pricePerHour: 1000,
  });
  venueId = venue._id;

  // Generate tokens
  user1Token = jwt.sign(
    { _id: user1Id.toString(), role: user1.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  user2Token = jwt.sign(
    { _id: user2Id.toString(), role: user2.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

// Clean Chat collection before each test to avoid data conflicts
beforeEach(async () => {
  await Chat.deleteMany({});
});

describe("Chat API", () => {
  test("GET /api/chats - getUserChats returns empty array initially", async () => {
    const res = await request(app)
      .get("/api/chats")
      .set("Authorization", `Bearer ${user1Token}`);

    if (res.statusCode !== 200) console.log(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  test("POST /api/chats - getOrCreateChat creates new chat", async () => {
    const res = await request(app)
      .post("/api/chats")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        participantId: user2Id.toString(),
        venueId: venueId.toString(),
      });

    if (res.statusCode !== 200) console.log(res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("_id");

    const participantIds = res.body.participants.map((p) =>
      typeof p === "string" ? p : p._id.toString()
    );

    expect(participantIds).toEqual(
      expect.arrayContaining([user1Id.toString(), user2Id.toString()])
    );
    expect(res.body.venueId).toBe(venueId.toString());
  });

  test("POST /api/chats - getOrCreateChat returns existing chat if found", async () => {
    const chat = await Chat.create({
      participants: [user1Id, user2Id],
      venueId,
    });

    console.log("Created chat ID:", chat._id.toString());

    const res = await request(app)
      .post("/api/chats")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        participantId: user2Id.toString(),
        venueId: venueId.toString(),
      });

    if (res.statusCode !== 200) console.log(res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body._id).toBe(chat._id.toString());
  });

  test("GET /api/chats with venueId filter returns chats", async () => {
    await Chat.create({
      participants: [user1Id, user2Id],
      venueId,
    });

    const res = await request(app)
      .get(`/api/chats?venueId=${venueId.toString()}`)
      .set("Authorization", `Bearer ${user1Token}`);

    if (res.statusCode !== 200) console.log(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("participants");
    expect(res.body[0]).toHaveProperty("venueId");
  });

  test("GET /api/chats without auth returns 401", async () => {
    const res = await request(app).get("/api/chats");
    expect(res.statusCode).toBe(401);
  });

  test("POST /api/chats without auth returns 401", async () => {
    const res = await request(app).post("/api/chats").send({
      participantId: user2Id.toString(),
      venueId: venueId.toString(),
    });
    expect(res.statusCode).toBe(401);
  });
});
