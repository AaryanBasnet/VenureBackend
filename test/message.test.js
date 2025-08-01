const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
process.env.JWT_SECRET = "testsecret"; // set before app import

const app = require("../app");
const User = require("../model/user");
const Message = require("../model/message");
const jwt = require("jsonwebtoken");

let mongod;
let user1Token, user2Token, user1Id, user2Id;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Create test users
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
    role: "Customer",
  });
  user2Id = user2._id;

  // Generate tokens
  user1Token = jwt.sign({ _id: user1Id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  user2Token = jwt.sign({ _id: user2Id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Message.deleteMany({});
});

describe("Message Controller", () => {
  describe("GET /api/messages/chat/:chatId", () => {
    test("should return messages for given chatId sorted by createdAt", async () => {
      const chatId = new mongoose.Types.ObjectId();

      // Create two messages in chat
      await Message.create([
        {
          chatId,
          sender: user1Id,
          receiver: user2Id,
          text: "First message",
          createdAt: new Date("2023-01-01T10:00:00Z"),
        },
        {
          chatId,
          sender: user1Id,
          receiver: user2Id,
          text: "Second message",
          createdAt: new Date("2023-01-01T11:00:00Z"),
        },
      ]);

      const res = await request(app)
        .get(`/api/messages/${chatId.toString()}`)
        .set("Authorization", `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.length).toBe(2);
      expect(res.body[0].text).toBe("First message");
      expect(res.body[1].text).toBe("Second message");

      expect(res.body[0].sender.name).toBe("User One");
      expect(res.body[0].receiver.name).toBe("User Two");
    });
  });

  describe("GET /api/messages/user/all", () => {
    test("should return messages where user is sender or receiver", async () => {
      const otherUser = await User.create({
        name: "Other User",
        email: "other@example.com",
        password: "hashed",
        role: "Customer",
      });

      await Message.create([
        {
          chatId: new mongoose.Types.ObjectId(),
          sender: user1Id,
          receiver: otherUser._id,
          text: "User sent message",
          createdAt: new Date(),
        },
        {
          chatId: new mongoose.Types.ObjectId(),
          sender: otherUser._id,
          receiver: user1Id,
          text: "User received message",
          createdAt: new Date(),
        },
        {
          chatId: new mongoose.Types.ObjectId(),
          sender: otherUser._id,
          receiver: new mongoose.Types.ObjectId(),
          text: "Not related to user",
          createdAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get(`/api/messages/user/all`)
        .set("Authorization", `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.length).toBe(2);

      const texts = res.body.map((msg) => msg.text);
      expect(texts).toContain("User sent message");
      expect(texts).toContain("User received message");

      expect(res.body[0].sender).toHaveProperty("name");
      expect(res.body[0].receiver).toHaveProperty("name");
    });
  });
});
