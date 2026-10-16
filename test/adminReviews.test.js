const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const Review = require("../model/review");

let mongod;
let adminAgent;
let customerAgent;
let anna;
let ben;
let venueA;
let venueB;

const PASSWORD = "Test@1234";

const loginAgent = async (email) => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  return agent;
};

const makeReview = (overrides = {}) =>
  Review.create({
    user: anna._id,
    venue: venueA._id,
    booking: new mongoose.Types.ObjectId(),
    rating: 5,
    title: "Lovely",
    comment: "A great evening",
    ...overrides,
  });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const hashed = await bcrypt.hash(PASSWORD, 10);

  anna = await User.create({ name: "Anna Sharma", email: "anna@test.com", password: hashed, role: "Customer" });
  ben = await User.create({ name: "Ben Thapa", email: "ben@test.com", password: hashed, role: "Customer" });
  const owner = await User.create({ name: "Owner", email: "owner@test.com", password: hashed, role: "VenueOwner" });
  await User.create({ name: "Admin", email: "admin@test.com", password: hashed, role: "Admin" });

  const location = { address: "1 St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };
  venueA = await Venue.create({ venueName: "Himalayan Hall", owner: owner._id, status: "approved", location });
  venueB = await Venue.create({ venueName: "Lakeside Gardens", owner: owner._id, status: "approved", location });

  adminAgent = await loginAgent("admin@test.com");
  customerAgent = await loginAgent("anna@test.com");
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

afterEach(async () => {
  await Review.deleteMany({});
});

describe("GET /api/admin/reviews", () => {
  test("rejects unauthenticated requests and customers", async () => {
    expect((await request(app).get("/api/admin/reviews")).statusCode).toBe(401);
    expect((await customerAgent.get("/api/admin/reviews")).statusCode).toBe(403);
  });

  test("returns reviews newest first with customer and venue populated", async () => {
    const older = await makeReview({ comment: "older", createdAt: new Date("2026-01-01") });
    const newer = await makeReview({ comment: "newer", user: ben._id, venue: venueB._id, createdAt: new Date("2026-02-01") });

    const res = await adminAgent.get("/api/admin/reviews");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.pages).toBe(1);
    expect(res.body.data.reviews.map((r) => r._id)).toEqual([newer._id.toString(), older._id.toString()]);
    expect(res.body.data.reviews[0].user.name).toBe("Ben Thapa");
    expect(res.body.data.reviews[0].venue.venueName).toBe("Lakeside Gardens");
    expect(res.body.data.reviews[0].user.email).toBeUndefined();
  });

  test("paginates", async () => {
    for (let i = 0; i < 5; i++) {
      await makeReview({ comment: `review ${i}`, createdAt: new Date(2026, 0, i + 1) });
    }

    const p1 = await adminAgent.get("/api/admin/reviews?page=1&limit=2");
    const p3 = await adminAgent.get("/api/admin/reviews?page=3&limit=2");

    expect(p1.body.data.reviews).toHaveLength(2);
    expect(p1.body.data.total).toBe(5);
    expect(p1.body.data.pages).toBe(3);
    expect(p1.body.data.reviews[0].comment).toBe("review 4");
    expect(p3.body.data.reviews).toHaveLength(1);
    expect(p3.body.data.reviews[0].comment).toBe("review 0");
  });

  test("filters by rating and featured", async () => {
    await makeReview({ rating: 5, isFeatured: true });
    await makeReview({ rating: 3 });
    await makeReview({ rating: 3, isFeatured: true });

    const byRating = await adminAgent.get("/api/admin/reviews?rating=3");
    const featured = await adminAgent.get("/api/admin/reviews?featured=true");
    const notFeatured = await adminAgent.get("/api/admin/reviews?featured=false");
    const both = await adminAgent.get("/api/admin/reviews?rating=3&featured=true");

    expect(byRating.body.data.total).toBe(2);
    expect(featured.body.data.total).toBe(2);
    expect(notFeatured.body.data.total).toBe(1);
    expect(both.body.data.total).toBe(1);
  });

  test("searches comment, title, venue name and customer name", async () => {
    await makeReview({ comment: "The momo was superb", title: "Tasty" });
    await makeReview({ comment: "Fine", title: "Wedding bliss", user: ben._id });
    await makeReview({ comment: "Okay", title: "Ok", venue: venueB._id });

    const count = async (q) => (await adminAgent.get(`/api/admin/reviews?search=${encodeURIComponent(q)}`)).body.data.total;

    expect(await count("momo")).toBe(1);
    expect(await count("wedding")).toBe(1);
    expect(await count("lakeside")).toBe(1);
    expect(await count("ben thapa")).toBe(1);
    expect(await count("anna")).toBe(2);
    expect(await count("nothing like this")).toBe(0);
    expect(await count(".*")).toBe(0);
  });

  test("rejects invalid query values", async () => {
    expect((await adminAgent.get("/api/admin/reviews?rating=9")).statusCode).toBe(400);
    expect((await adminAgent.get("/api/admin/reviews?page=0")).statusCode).toBe(400);
  });
});

describe("featuring and deleting as admin", () => {
  test("toggle feature shows up on the public featured list, delete removes it", async () => {
    const review = await makeReview({ rating: 5 });

    const on = await adminAgent.patch(`/api/${review._id}/feature`);
    expect(on.body.data.isFeatured).toBe(true);
    const featured = await request(app).get("/api/featured");
    expect(featured.body.data.map((r) => r._id)).toContain(review._id.toString());

    expect((await customerAgent.patch(`/api/${review._id}/feature`)).statusCode).toBe(403);

    const off = await adminAgent.patch(`/api/${review._id}/feature`);
    expect(off.body.data.isFeatured).toBe(false);

    expect((await adminAgent.delete(`/api/${review._id}`)).statusCode).toBe(200);
    expect(await Review.findById(review._id)).toBeNull();
  });
});
