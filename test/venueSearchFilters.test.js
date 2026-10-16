const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const venueService = require("../services/venueService");
const app = require("../app");

let mongod;
let owner;
const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };
const pkg = (name, pricePerPlate) => ({ name, pricePerPlate });

const names = async (filters) => (await venueService.getApprovedVenues(filters)).venues.map((v) => v.venueName);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  owner = await User.create({ name: "Owner", email: "owner@filters.test", password: "hashedpassword", role: "VenueOwner" });

  const make = (venueName, extra) => Venue.create({ owner: owner._id, venueName, location, status: "approved", ...extra });
  // Created oldest -> newest so "newest" order is the reverse of this list
  await make("Budget Hall", { packages: [pkg("Basic", 800), pkg("Plus", 1500)], totalReviews: 1, averageRating: 3 });
  await make("Mid Garden", { packages: [pkg("Std", 1800), pkg("Deluxe", 3000)], totalReviews: 10, averageRating: 4 });
  await make("Royal Palace", { packages: [pkg("Royal", 5000)], totalReviews: 10, averageRating: 5 });
  await make("No Menu Yard", { totalReviews: 20, averageRating: 2 });
  await Venue.create({ owner: owner._id, venueName: "Hidden Pending", location, status: "pending", packages: [pkg("X", 1000)] });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("denormalised price", () => {
  it("stores the cheapest package, null when there are none", async () => {
    const budget = await Venue.findOne({ venueName: "Budget Hall" }).lean();
    const none = await Venue.findOne({ venueName: "No Menu Yard" }).lean();
    expect(budget.minPricePerPlate).toBe(800);
    expect(none.minPricePerPlate).toBeNull();
  });

  it("follows package edits made through save()", async () => {
    const v = await Venue.findOne({ venueName: "Mid Garden" });
    v.packages = [pkg("Cheap", 1200)];
    await v.save();
    expect((await Venue.findById(v._id).lean()).minPricePerPlate).toBe(1200);
    v.packages = [pkg("Std", 1800), pkg("Deluxe", 3000)];
    await v.save();
    expect((await Venue.findById(v._id).lean()).minPricePerPlate).toBe(1800);
  });

  it("follows packages set through findOneAndUpdate", async () => {
    const v = await Venue.findOne({ venueName: "Royal Palace" });
    await Venue.findOneAndUpdate({ _id: v._id }, { $set: { packages: [pkg("Royal", 4500)] } });
    expect((await Venue.findById(v._id).lean()).minPricePerPlate).toBe(4500);
    await Venue.findOneAndUpdate({ _id: v._id }, { $set: { packages: [pkg("Royal", 5000)] } });
  });

  it("does not leak the internal sort key", async () => {
    const { venues } = await venueService.getApprovedVenues({});
    expect(venues.every((v) => v.priceSortKey === undefined)).toBe(true);
  });
});

describe("minPrice / maxPrice", () => {
  it("matches when ANY package lies inside the range", async () => {
    // Budget has 800 and 1500; Mid has 1800 and 3000
    expect((await names({ minPrice: 1400, maxPrice: 1600 })).sort()).toEqual(["Budget Hall"]);
    expect((await names({ minPrice: 2000, maxPrice: 3500 })).sort()).toEqual(["Mid Garden"]);
    expect((await names({ minPrice: 1000, maxPrice: 2000 })).sort()).toEqual(["Budget Hall", "Mid Garden"]);
  });

  it("works with only one bound", async () => {
    expect((await names({ minPrice: 4000 })).sort()).toEqual(["Royal Palace"]);
    expect((await names({ maxPrice: 900 })).sort()).toEqual(["Budget Hall"]);
  });

  it("includes both bounds and drops venues without packages", async () => {
    expect((await names({ minPrice: 5000, maxPrice: 5000 }))).toEqual(["Royal Palace"]);
    expect(await names({ minPrice: 0 })).not.toContain("No Menu Yard");
    expect(await names({})).toContain("No Menu Yard");
  });

  it("keeps the total in step with the filter", async () => {
    const { total } = await venueService.getApprovedVenues({ minPrice: 1000, maxPrice: 2000 });
    expect(total).toBe(2);
  });
});

describe("sort", () => {
  it("price_asc orders by cheapest package, venues without packages last", async () => {
    expect(await names({ sort: "price_asc" })).toEqual(["Budget Hall", "Mid Garden", "Royal Palace", "No Menu Yard"]);
  });

  it("price_desc orders by cheapest package descending, venues without packages last", async () => {
    expect(await names({ sort: "price_desc" })).toEqual(["Royal Palace", "Mid Garden", "Budget Hall", "No Menu Yard"]);
  });

  it("popular orders by reviews, then rating, then newest", async () => {
    expect(await names({ sort: "popular" })).toEqual(["No Menu Yard", "Royal Palace", "Mid Garden", "Budget Hall"]);
  });

  it("paginates a sort without repeating or losing venues", async () => {
    const p1 = await names({ sort: "price_asc", limit: 2, page: 1 });
    const p2 = await names({ sort: "price_asc", limit: 2, page: 2 });
    expect([...p1, ...p2]).toEqual(["Budget Hall", "Mid Garden", "Royal Palace", "No Menu Yard"]);
  });

  it("keeps newest as the default and combines with a price range", async () => {
    expect((await names({}))[0]).toBe("No Menu Yard");
    expect(await names({ minPrice: 1000, sort: "price_desc" })).toEqual(["Royal Palace", "Mid Garden", "Budget Hall"]);
  });
});

describe("denormalised capacity", () => {
  it("tracks active spaces", async () => {
    const v = await Venue.findOne({ venueName: "Budget Hall" });
    const a = await Space.create({ venue: v._id, name: "A", capacity: 100 });
    await Space.create({ venue: v._id, name: "B", capacity: 300 });
    let doc = await Venue.findById(v._id).lean();
    expect([doc.maxCapacity, doc.spaceCount]).toEqual([300, 2]);
    a.isActive = false;
    await a.save();
    doc = await Venue.findById(v._id).lean();
    expect([doc.maxCapacity, doc.spaceCount]).toEqual([300, 1]);
    expect(await names({ guests: 250 })).toEqual(["Budget Hall"]);
    expect(await names({ guests: 400 })).toEqual([]);
  });
});

describe("HTTP contract", () => {
  it("accepts the new query params", async () => {
    const res = await request(app).get("/api/venues?minPrice=1000&maxPrice=2000&sort=price_asc");
    expect(res.status).toBe(200);
    expect(res.body.data.map((v) => v.venueName)).toEqual(["Budget Hall", "Mid Garden"]);
  });

  it("rejects an unknown sort and a non-integer price", async () => {
    expect((await request(app).get("/api/venues?sort=cheapest")).status).toBe(400);
    expect((await request(app).get("/api/venues?minPrice=abc")).status).toBe(400);
  });
});
