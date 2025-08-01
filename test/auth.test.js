const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../model/user");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;

const testUser = {
  name: "Test User",
  email: "testuser@example.com",
  phone: "9812345678",
  password: "Test@1234",
  role: "Customer",
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("Auth API Tests (Full Coverage)", () => {
  describe("Register & Login", () => {
    test("should register a user successfully", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
    });

    test("should not allow duplicate registration", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("should return validation error if fields are missing", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "incomplete@example.com",
        password: "pass123",
      });
      expect(res.statusCode).toBe(400);
    });

    test("should login successfully with correct credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    test("should fail login with wrong password", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: "WrongPass",
      });
      expect(res.statusCode).toBe(404);
    });

    test("should fail login with non-existent email", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "notexist@example.com",
        password: "Pass@123",
      });
      expect(res.statusCode).toBe(404);
    });

    test("should fail if login fields are missing", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Verify Password", () => {
    let userId;

    beforeAll(async () => {
      const user = await User.findOne({ email: testUser.email });
      userId = user._id;
    });

    test("should verify correct password", async () => {
      const res = await request(app).post("/api/auth/verify-password").send({
        userId,
        password: testUser.password,
      });
      expect(res.statusCode).toBe(200);
    });

    test("should fail for wrong password", async () => {
      const res = await request(app).post("/api/auth/verify-password").send({
        userId,
        password: "WrongPass",
      });
      expect(res.statusCode).toBe(401);
    });

    test("should fail if user not found", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).post("/api/auth/verify-password").send({
        userId: fakeId,
        password: testUser.password,
      });
      expect(res.statusCode).toBe(404);
    });

    test("should fail if fields missing", async () => {
      const res = await request(app).post("/api/auth/verify-password").send({});
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Forgot Password", () => {
    test("should send reset code if user exists", async () => {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: testUser.email });
      expect(res.statusCode).toBe(200);
    });

    test("should fail if user not found", async () => {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "nouser@example.com" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Verify Reset Code", () => {
    let resetCode;

    beforeAll(async () => {
      const user = await User.findOne({ email: testUser.email });
      resetCode = user.getResetPasswordCode();
      await user.save({ validateBeforeSave: false });
    });

    test("should verify valid reset code", async () => {
      const res = await request(app).post("/api/auth/verify-reset-code").send({
        email: testUser.email,
        code: resetCode,
      });
      expect(res.statusCode).toBe(200);
    });

    test("should fail for invalid/expired code", async () => {
      const res = await request(app).post("/api/auth/verify-reset-code").send({
        email: testUser.email,
        code: "wrongcode",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Reset Password with Code", () => {
  let resetCode;

  beforeEach(async () => {
    // Create a fresh reset code before each test
    const user = await User.findOne({ email: testUser.email });
    resetCode = user.getResetPasswordCode();
    await user.save({ validateBeforeSave: false });
  });

  test("should reset password with valid code", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        code: resetCode, // match the stored one
        password: "NewPass@1234",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Password reset successful");
  });

  test("should fail with wrong code", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        code: "wrongcode",
        password: "NewPass@1234",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid or expired code");
  });
});

});
