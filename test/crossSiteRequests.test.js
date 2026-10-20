// CodeQL reports "missing CSRF middleware" because it only recognises token libraries. Venure's defence is different:
// the cors() setup in app.js answers 403 to any request that carries an Origin header which is not in FRONTEND_URL,
// before a handler runs. Browsers always send Origin on a cross-site POST (forms, multipart uploads included), so a page
// on another site cannot make a signed-in visitor's browser change anything. These tests pin that behaviour down.
const request = require("supertest");
const User = require("../model/user");
const Inquiry = require("../model/inquiry");
const { app, startDb, stopDb, clearDb, makeUser, makeVenue, cookieFor } = require("./helpers/api");

let customer;

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  customer = await makeUser("Customer", { name: "Original Name", phone: "9800000000" });
});

const withCookie = (req, user) => req.set("Cookie", cookieFor(user));

describe("a request that comes from another website", () => {
  it.each([["https://evil.example"], ["http://localhost.evil.example"], ["null"]])(
    "is refused with 403 and changes nothing (Origin: %s)",
    async (origin) => {
      const res = await withCookie(request(app).put("/api/user/profile"), customer).set("Origin", origin).send({ name: "Hijacked" });
      expect(res.status).toBe(403);
      expect((await User.findById(customer._id)).name).toBe("Original Name");
    }
  );

  it("is refused for a multipart upload too, the kind of request a plain HTML form can send", async () => {
    const venue = await makeVenue(await makeUser("VenueOwner"));
    const inquiry = await Inquiry.create({
      customer: customer._id, venue: venue._id, preferredDate: new Date(Date.now() + 30 * 864e5), numberOfGuests: 50,
      eventType: "Wedding", contactName: "A", phoneNumber: "9800000000",
    });
    const res = await withCookie(request(app).post(`/api/inquiries/${inquiry._id}/attachments`), customer)
      .set("Origin", "https://evil.example")
      .attach("attachments", Buffer.from("%PDF-1.4"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(403);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it("is refused for a cancel, a delete and a sign out as well", async () => {
    for (const [method, path] of [["put", "/api/inquiries/000000000000000000000001/cancel"], ["delete", "/api/venues/000000000000000000000001"], ["post", "/api/auth/logout"]]) {
      const res = await withCookie(request(app)[method](path), customer).set("Origin", "https://evil.example");
      expect(res.status).toBe(403);
    }
  });
});

describe("the real site and everything that sends no Origin", () => {
  it("works from the allowed origin", async () => {
    const res = await withCookie(request(app).put("/api/user/profile"), customer).set("Origin", "http://localhost:5173").send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect((await User.findById(customer._id)).name).toBe("New Name");
  });

  it("lets the browser keep a preflight answer for a day", async () => {
    const res = await request(app).options("/api/auth/me").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });

  it("works without an Origin header (server to server, curl, the test suite itself)", async () => {
    const res = await withCookie(request(app).put("/api/user/profile"), customer).send({ name: "No Origin" });
    expect(res.status).toBe(200);
  });
});
