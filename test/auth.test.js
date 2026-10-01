const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../model/user");
const { MongoMemoryServer } = require("mongodb-memory-server");

// No real Gmail credentials in the test env — avoid a real network call.
jest.mock("../utils/sendEmail", () => jest.fn().mockResolvedValue(undefined));

let mongod;

const testUser = {
  name: "Test User",
  email: "testuser@example.com",
  phone: "9812345678",
  password: "Test@1234",
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

const hasCookie = (res, name) =>
  (res.headers["set-cookie"] || []).some((c) => c.startsWith(`${name}=`));

describe("Auth API", () => {
  describe("Register", () => {
    test("creates the account and logs the user in immediately", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testUser.email.toLowerCase());
      expect(res.body.data.password).toBeUndefined();
      // Auto-login: the session cookies are set on the same response, no second login needed.
      expect(hasCookie(res, "accessToken")).toBe(true);
      expect(hasCookie(res, "refreshToken")).toBe(true);
    });

    test("rejects a duplicate email", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);
      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
    });

    test("rejects a request with missing required fields", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: "incomplete@example.com", password: "Test@1234" });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Login", () => {
    test("logs in with correct credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.email).toBe(testUser.email.toLowerCase());
      expect(hasCookie(res, "accessToken")).toBe(true);
    });

    test("rejects the wrong password with a generic message", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: "WrongPass1",
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    });

    test("rejects a non-existent email with the same generic message (no enumeration)", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "notexist@example.com",
        password: "Pass@1234",
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    });

    test("rejects a request with a missing password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Verify current password (requires an active session)", () => {
    const agent = request.agent(app);

    beforeAll(async () => {
      await agent.post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });
    });

    test("accepts the correct current password", async () => {
      const res = await agent
        .post("/api/password/verify-password")
        .send({ password: testUser.password });
      expect(res.statusCode).toBe(200);
    });

    test("rejects the wrong current password", async () => {
      const res = await agent
        .post("/api/password/verify-password")
        .send({ password: "WrongPass1" });
      expect(res.statusCode).toBe(401);
    });

    test("rejects the request without a logged-in session", async () => {
      const res = await request(app)
        .post("/api/password/verify-password")
        .send({ password: testUser.password });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("Forgot password", () => {
    test("returns a generic success response for an existing email", async () => {
      const res = await request(app)
        .post("/api/password/forgot-password")
        .send({ email: testUser.email });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("returns the identical generic response for an email that doesn't exist", async () => {
      const res = await request(app)
        .post("/api/password/forgot-password")
        .send({ email: "nouser@example.com" });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Verify reset code", () => {
    test("rejects a code that doesn't match the active one", async () => {
      const user = await User.findOne({ email: testUser.email });
      user.getResetPasswordCode();
      await user.save({ validateBeforeSave: false });

      const res = await request(app)
        .post("/api/password/verify-code")
        .send({ email: testUser.email, code: "000000" });
      expect(res.statusCode).toBe(400);
    });

    test("accepts the active code", async () => {
      const user = await User.findOne({ email: testUser.email });
      const code = user.getResetPasswordCode();
      await user.save({ validateBeforeSave: false });

      const res = await request(app)
        .post("/api/password/verify-code")
        .send({ email: testUser.email, code });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("Reset password with code", () => {
    test("resets the password, and only the new password works afterward", async () => {
      const user = await User.findOne({ email: testUser.email });
      const code = user.getResetPasswordCode();
      await user.save({ validateBeforeSave: false });

      const res = await request(app).post("/api/password/reset-password").send({
        email: testUser.email,
        code,
        password: "NewPass@1234",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const oldLogin = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: "NewPass@1234",
      });
      expect(newLogin.statusCode).toBe(200);
    });

    test("rejects a code once it's already been consumed", async () => {
      const res = await request(app).post("/api/password/reset-password").send({
        email: testUser.email,
        code: "000000",
        password: "AnotherPass@1234",
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
