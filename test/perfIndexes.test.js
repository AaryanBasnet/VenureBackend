// The hot query shapes must be served by an index (no COLLSCAN) and the denormalised fields must stay correct.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Review = require("../model/review");
const Notification = require("../model/notification");
const Chat = require("../model/chat");
const Message = require("../model/message");

let mongod;
const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };

// True when any stage of the winning plan is a full collection scan
const hasCollScan = (plan) => {
  if (!plan || typeof plan !== "object") return false;
  if (plan.stage === "COLLSCAN") return true;
  return Object.values(plan).some((v) => (Array.isArray(v) ? v.some(hasCollScan) : hasCollScan(v)));
};
const planOf = async (query) => (await query.explain("queryPlanner")).queryPlanner.winningPlan;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Venue.init(), Space.init(), Review.init(), Notification.init(), Chat.init(), Message.init(), User.init()]);
  const owner = await User.create({ name: "O", email: "o@idx.test", password: "hashedpassword", role: "VenueOwner" });
  await Venue.insertMany(
    Array.from({ length: 30 }, (_, i) => ({
      owner: owner._id, venueName: `V${i}`, location, status: "approved", category: "hotel-resort", isFeatured: i < 3,
      packages: [{ name: "P", pricePerPlate: 500 + i * 10 }],
    }))
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("venue list queries use an index", () => {
  const base = { status: "approved", isDeleted: false };
  const cases = {
    "newest": [base, { createdAt: -1, _id: -1 }],
    "city": [{ ...base, "location.city": "Kathmandu" }, { createdAt: -1, _id: -1 }],
    "category": [{ ...base, category: "hotel-resort" }, { createdAt: -1, _id: -1 }],
    "space type": [{ ...base, spaceTypes: "garden-estates" }, { createdAt: -1, _id: -1 }],
    "popular": [base, { totalReviews: -1, averageRating: -1, createdAt: -1, _id: -1 }],
    "rating": [base, { averageRating: -1, totalReviews: -1, createdAt: -1, _id: -1 }],
    "price_asc": [base, { priceSortKey: 1, createdAt: -1, _id: -1 }],
    "price_desc": [base, { minPricePerPlate: -1, createdAt: -1, _id: -1 }],
    "guests": [{ ...base, maxCapacity: { $gte: 100 } }, { createdAt: -1 }],
    "price range": [{ ...base, packages: { $elemMatch: { pricePerPlate: { $gte: 400, $lte: 900 } } } }, { createdAt: -1 }],
    "featured": [{ isFeatured: true, ...base }, { createdAt: -1 }],
  };
  for (const [name, [filter, sort]] of Object.entries(cases)) {
    it(`${name}`, async () => {
      expect(hasCollScan(await planOf(Venue.find(filter).sort(sort).limit(12)))).toBe(false);
    });
  }
});

describe("other hot queries use an index", () => {
  const id = () => new mongoose.Types.ObjectId();
  it("a user's notifications, newest first", async () => {
    expect(hasCollScan(await planOf(Notification.find({ recipient: id() }).sort("-createdAt").limit(50)))).toBe(false);
  });
  it("mark-all-read", async () => {
    expect(hasCollScan(await planOf(Notification.find({ recipient: id(), read: false })))).toBe(false);
  });
  it("a venue's reviews, newest first", async () => {
    expect(hasCollScan(await planOf(Review.find({ venue: id() }).sort("-createdAt").limit(50)))).toBe(false);
  });
  it("the admin review list", async () => {
    expect(hasCollScan(await planOf(Review.find({}).sort("-createdAt -_id").limit(10)))).toBe(false);
  });
  it("a user's conversation list", async () => {
    expect(hasCollScan(await planOf(Chat.find({ participants: id() }).sort("-updatedAt")))).toBe(false);
  });
  it("unread message counts", async () => {
    expect(hasCollScan(await planOf(Message.find({ receiver: id(), seen: false })))).toBe(false);
  });
  it("messages of a chat", async () => {
    expect(hasCollScan(await planOf(Message.find({ chatId: id() }).sort("-createdAt").limit(200)))).toBe(false);
  });
  it("login by email", async () => {
    expect(hasCollScan(await planOf(User.find({ email: "x@y.z" })))).toBe(false);
  });
});

describe("the one-review-per-booking rule lives in the database", () => {
  it("rejects a second review for the same booking and user", async () => {
    const [user, venue, booking] = [id(), id(), id()];
    await Review.create({ user, venue, booking, rating: 4, comment: "a" });
    await expect(Review.create({ user, venue, booking, rating: 5, comment: "b" })).rejects.toMatchObject({ code: 11000 });
  });
  function id() { return new mongoose.Types.ObjectId(); }
});

describe("denormalised venue fields", () => {
  it("count only active spaces and follow deactivation and deletion", async () => {
    const venue = await Venue.findOne({ venueName: "V5" });
    const a = await Space.create({ venue: venue._id, name: "A", capacity: 80 });
    const b = await Space.create({ venue: venue._id, name: "B", capacity: 200 });
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 200, spaceCount: 2 });
    await Space.findByIdAndUpdate(b._id, { isActive: false });
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 80, spaceCount: 1 });
    await a.deleteOne();
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 0, spaceCount: 0 });
  });
});
