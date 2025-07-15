const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../model/user");
const { MongoMemoryServer } = require("mongodb-memory-server");

const testUser = {
  name: "Test User",
  email: "testuser@example.com",
  phone: "9812345678",
  password: "Test@1234",
  role: "Customer",
};

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Auth API Tests", () => {
  describe("POST /api/auth/register", () => {
    test("should register a user successfully", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("User registered succesfully");
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.role).toBe("Customer");
    });

    test("should not allow duplicate registration", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("User Already exists");
    });

    test("should return validation error if fields are missing", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "incomplete@example.com",
        password: "pass123",
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("All fields are required");
    });
  });

  describe("POST /api/auth/login", () => {
    test("should login successfully with correct credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("User logged in successfully.");
      expect(res.body.token).toBeDefined();
      expect(res.body.userData.email).toBe(testUser.email.toLowerCase());
    });

    test("should fail login with wrong password", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: "WrongPassword123",
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Invalid Credential");
    });

    test("should fail login with non-existent email", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "notexist@example.com",
        password: "Password@123",
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("User Doesnt exist");
    });

    test("should fail if fields are missing", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Please enter all the fields");
    });
  });
});
