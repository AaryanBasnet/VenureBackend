const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { startDb, stopDb } = require("./helpers/api");

describe("GET /api/health", () => {
  it("answers without authentication or a database", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "ok" });
  });
});

describe("GET /api/ready", () => {
  beforeAll(startDb);
  afterAll(stopDb);

  it("says ready when the database answers", async () => {
    const res = await request(app).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "ready" });
  });

  it("503 when the database does not", async () => {
    const original = mongoose.connection.db.admin;
    mongoose.connection.db.admin = () => ({ ping: async () => { throw new Error("down"); } });
    try {
      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(503);
    } finally {
      mongoose.connection.db.admin = original;
    }
  });
});
