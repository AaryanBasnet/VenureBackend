const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../app");
const Contact = require("../model/contact");
const User = require("../model/user");
const jwt = require("jsonwebtoken");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Create an Admin user and generate token for tests
  const adminUser = await User.create({
    name: "Admin User",
    email: "admin@example.com",
    password: "hashedpassword", // mock or hash accordingly
    role: "Admin",
  });

  adminToken = jwt.sign(
    { _id: adminUser._id, role: adminUser.role },
    process.env.JWT_SECRET
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

afterEach(async () => {
  await Contact.deleteMany();
});

describe("Contact API", () => {
  test("POST /api/contact - submit contact form", async () => {
    const res = await request(app).post("/api/contact").send({
      name: "John Doe",
      email: "john@example.com",
      phone: "1234567890",
      message: "Hello there!",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Contact form submitted successfully");

    const contact = await Contact.findOne({ email: "john@example.com" });
    expect(contact).not.toBeNull();
  });

  test("POST /api/contact - missing required fields", async () => {
    const res = await request(app).post("/api/contact").send({
      email: "john@example.com",
      phone: "1234567890",
      message: "",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/required/);
  });

  test("GET /api/contact/admin - success with admin token", async () => {
    // Insert a contact first
    await Contact.create({
      name: "Jane Admin",
      email: "jane@example.com",
      phone: "0987654321",
      message: "Admin check",
    });

    const res = await request(app)
      .get("/api/contact/admin")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("name", "Jane Admin");
  });
});
