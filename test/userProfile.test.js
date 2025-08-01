const request = require("supertest");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "testsecret";

const app = require("../app"); // Your express app
const User = require("../model/user");

let mongod;
let userId;
let userToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Create a test user
  const user = await User.create({
    name: "Test User",
    email: "testuser@example.com",
    password: "hashedpassword",
    phone: "1234567890",
    address: "Test Address",
  });

  userId = user._id;

  // Generate JWT for authentication
  userToken = jwt.sign({ _id: userId.toString() }, process.env.JWT_SECRET);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("User Profile API", () => {
  describe("GET /profile", () => {
    test("should return user profile without password", async () => {
      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user).toHaveProperty("name", "Test User");
      expect(res.body.user).toHaveProperty("email", "testuser@example.com");
      expect(res.body.user).not.toHaveProperty("password");
    });

    test("should return 401 if no auth token", async () => {
      const res = await request(app).get("/api/user/profile").expect(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /profile", () => {
    const uploadPath = path.join(__dirname, "../../uploads/users");

    afterEach(() => {
      // Clean uploaded files
      if (fs.existsSync(uploadPath)) {
        fs.readdirSync(uploadPath).forEach((file) => {
          fs.unlinkSync(path.join(uploadPath, file));
        });
      }
    });

    test("should update user profile fields", async () => {
      const res = await request(app)
        .put("/api/user/profile")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          name: "Updated Name",
          phone: "0987654321",
          address: "New Address",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Profile updated successfully");
      expect(res.body.user).toHaveProperty("name", "Updated Name");
      expect(res.body.user).toHaveProperty("phone", "0987654321");
      expect(res.body.user).toHaveProperty("address", "New Address");
    });

    test("should update user avatar image", async () => {
      const res = await request(app)
        .put("/api/user/profile")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("profileImage", path.join(__dirname, "testImage.jpg"))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty("avatar");
      expect(res.body.user.avatar).toMatch(/uploads\/users\/profileImage-/);
    });

    test("should reject non-image uploads", async () => {
      const res = await request(app)
        .put("/api/user/profile")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("profileImage", path.join(__dirname, "testFile.txt"))
        .expect(400); // changed from 500 to 400

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Only image files are allowed");
    });

    test("should return 401 if no auth token", async () => {
      const res = await request(app)
        .put("/api/user/profile")
        .send({ name: "NoAuth" })
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });
});
