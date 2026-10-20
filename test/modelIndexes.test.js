// The server builds its indexes itself when it starts (Mongoose autoIndex), so a fresh database needs no script.
// This proves the models declare every index the app relies on, including the ones that guard correctness.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Booking = require("../model/booking");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const ActivityLog = require("../model/activityLog");
const User = require("../model/user");
const Review = require("../model/review");
const VenueApplication = require("../model/venueApplication");
const Venue = require("../model/venue");

let mongod;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { autoIndex: true });
  await Promise.all([Booking, Inquiry, Quotation, ActivityLog, User, Review, VenueApplication, Venue].map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

const keysOf = async (model) => (await model.collection.indexes()).map((i) => JSON.stringify(i.key));
const has = (keys, spec) => expect(keys).toContain(JSON.stringify(spec));

describe("indexes created by the models alone", () => {
  it("bookings: the list, availability, quotation and earnings lookups", async () => {
    const keys = await keysOf(Booking);
    for (const spec of [
      { customer: 1, createdAt: -1 },
      { venue: 1, createdAt: -1 },
      { venue: 1, status: 1, startTime: 1 },
      { status: 1, startTime: 1 },
      { quotation: 1, status: 1 },
      { venue: 1, status: 1, endTime: 1 },
      { space: 1, startTime: 1, endTime: 1 },
    ]) has(keys, spec);
  });

  it("bookings: the guard that makes a double booking impossible is a unique index on the slot keys", async () => {
    const guard = (await Booking.collection.indexes()).find((i) => i.name === "active_slot_keys_unique");
    expect(guard).toBeDefined();
    expect(guard.unique).toBe(true);
    expect(guard.partialFilterExpression).toBeDefined(); // only live bookings take part
  });

  it("inquiries, quotations and the activity log", async () => {
    const inquiries = await keysOf(Inquiry);
    for (const spec of [{ customer: 1, createdAt: -1 }, { venue: 1, createdAt: -1 }, { venue: 1, status: 1, createdAt: -1 }]) has(inquiries, spec);
    const quotations = await keysOf(Quotation);
    for (const spec of [{ owner: 1, createdAt: -1 }, { inquiry: 1, status: 1, createdAt: -1 }]) has(quotations, spec);
    has(await keysOf(ActivityLog), { createdAt: -1 });
  });

  it("the unique rules: one account per email, one review per booking, one open application per email", async () => {
    expect((await User.collection.indexes()).find((i) => i.key.email === 1)?.unique).toBe(true);
    expect((await Review.collection.indexes()).some((i) => i.unique && i.key.booking === 1 && i.key.user === 1)).toBe(true);
    const application = (await VenueApplication.collection.indexes()).find((i) => i.key.email === 1);
    expect(application.unique).toBe(true);
    expect(application.partialFilterExpression).toEqual({ status: "pending" });
  });

  it("venues: the type, kind-of-space and listing filters", async () => {
    const keys = await keysOf(Venue);
    has(keys, { status: 1, isDeleted: 1, category: 1, createdAt: -1 });
    has(keys, { status: 1, isDeleted: 1, spaceTypes: 1, createdAt: -1 });
  });
});
