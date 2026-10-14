const request = require("supertest");
const app = require("../app");

describe("GET /api/health", () => {
  it("answers without authentication or a database", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "ok" });
  });
});
