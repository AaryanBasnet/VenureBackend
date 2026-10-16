const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const LandingContent = require("../model/landingContent");
const landingService = require("../services/landingService");
const { LANDING_DEFAULTS } = require("../services/landingDefaults");

let mongod;
let adminCookie;
let customerCookie;
let owner;

const cookieFor = (user) => [`accessToken=${jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" })}`];
const clone = () => JSON.parse(JSON.stringify(LANDING_DEFAULTS));
const makeVenue = (extra = {}) =>
  Venue.create({
    owner: owner._id,
    venueName: "Landing Test Venue",
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
    category: "garden-estates",
    ...extra,
  });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const admin = await User.create({ name: "Admin", email: "landing-admin@test.dev", password: "hashedpassword", role: "Admin" });
  const customer = await User.create({ name: "Cust", email: "landing-cust@test.dev", password: "hashedpassword", role: "Customer" });
  owner = await User.create({ name: "Owner", email: "landing-owner@test.dev", password: "hashedpassword", role: "VenueOwner" });
  adminCookie = cookieFor(admin);
  customerCookie = cookieFor(customer);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await LandingContent.deleteMany({});
  await Venue.deleteMany({});
  landingService.invalidate();
});

describe("landing seed", () => {
  it("creates the default document once and never overwrites edits", async () => {
    await landingService.ensureSeed();
    await landingService.ensureSeed();
    expect(await LandingContent.countDocuments({ key: "home" })).toBe(1);

    const edited = clone();
    edited.hero.tagline = "Edited tagline";
    await landingService.updateLanding(edited, null);
    await landingService.ensureSeed();
    expect((await LandingContent.findOne({ key: "home" })).content.hero.tagline).toBe("Edited tagline");
  });
});

describe("GET /api/landing", () => {
  it("is public, seeds on first read and returns the current copy with caching headers", async () => {
    const res = await request(app).get("/api/landing");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toEqual(LANDING_DEFAULTS);
    expect(res.body.data.categoryCounts).toEqual({});
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers.etag).toBeTruthy();
  });

  it("answers 304 to a repeat request carrying the ETag", async () => {
    const first = await request(app).get("/api/landing");
    const second = await request(app).get("/api/landing").set("If-None-Match", first.headers.etag);
    expect(second.status).toBe(304);
  });

  it("includes live approved-venue counts per category", async () => {
    await makeVenue({ venueName: "A" });
    await makeVenue({ venueName: "B" });
    await makeVenue({ venueName: "C", category: "rooftop-terraces" });
    await makeVenue({ venueName: "Hidden", status: "pending" });
    const res = await request(app).get("/api/landing");
    expect(res.body.data.categoryCounts).toEqual({ "garden-estates": 2, "rooftop-terraces": 1 });
  });

  it("serves from the in-memory cache until it is invalidated", async () => {
    await request(app).get("/api/landing");
    await LandingContent.updateOne({ key: "home" }, { $set: { "content.hero.tagline": "Changed behind the cache" } });
    const cached = await request(app).get("/api/landing");
    expect(cached.body.data.content.hero.tagline).toBe(LANDING_DEFAULTS.hero.tagline);

    landingService.invalidate();
    const fresh = await request(app).get("/api/landing");
    expect(fresh.body.data.content.hero.tagline).toBe("Changed behind the cache");
  });

  it("only links a story to a venue that is still public", async () => {
    const live = await makeVenue();
    const hidden = await makeVenue({ venueName: "Hidden", status: "pending" });
    const content = clone();
    content.stories[0].venueId = String(live._id);
    content.stories[1].venueId = String(hidden._id);
    await landingService.updateLanding(content, null);

    const res = await request(app).get("/api/landing");
    expect(res.body.data.content.stories[0].venueId).toBe(String(live._id));
    expect(res.body.data.content.stories[1].venueId).toBeNull();
    expect(res.body.data.content.stories[1].category).toBe("garden-estates");
  });
});

describe("PUT /api/landing", () => {
  it("rejects anonymous users with 401 and non-admins with 403", async () => {
    const body = clone();
    expect((await request(app).put("/api/landing").send(body)).status).toBe(401);
    expect((await request(app).put("/api/landing").set("Cookie", customerCookie).send(body)).status).toBe(403);
  });

  it("lets an admin replace the content, shows it straight away and drops the old cache", async () => {
    await request(app).get("/api/landing"); // warm the cache
    const body = clone();
    body.hero.tagline = "A new tagline";
    body.partnerCta.title = "Own a venue?";

    const put = await request(app).put("/api/landing").set("Cookie", adminCookie).send(body);
    expect(put.status).toBe(200);
    expect(put.body.data.content.hero.tagline).toBe("A new tagline");

    const get = await request(app).get("/api/landing");
    expect(get.body.data.content.hero.tagline).toBe("A new tagline");
    expect(get.body.data.content.partnerCta.title).toBe("Own a venue?");
  });

  it("validates the body", async () => {
    const send = (mutate) => {
      const body = clone();
      mutate(body);
      return request(app).put("/api/landing").set("Cookie", adminCookie).send(body);
    };

    expect((await send((b) => delete b.hero)).status).toBe(400);
    expect((await send((b) => (b.hero.tagline = ""))).status).toBe(400);
    expect((await send((b) => (b.stories[0].description = "x".repeat(400)))).status).toBe(400);
    expect((await send((b) => (b.stories[0].imageKey = "../../etc/passwd"))).status).toBe(400);
    expect((await send((b) => (b.stories[0].venueId = "not-an-id"))).status).toBe(400);
    expect((await send((b) => (b.venueTypes[0].slug = "Bad Slug"))).status).toBe(400);
    expect((await send((b) => (b.extra = "field"))).status).toBe(400);
    expect((await send((b) => (b.seasons = []))).status).toBe(400);

    // Nothing was stored by the failed attempts
    expect(await LandingContent.countDocuments({})).toBe(0);
  });
});
