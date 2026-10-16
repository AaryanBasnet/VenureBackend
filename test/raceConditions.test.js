// Concurrency tests: many requests at once against the same resource.
// (mongodb-memory-server is a standalone mongod: no multi-document transactions. Every guarantee below comes from
// a single atomic update or a unique index, which is also what production relies on.)
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

jest.mock("../utils/sendEmail", () => jest.fn().mockResolvedValue(undefined));

const app = require("../app");
const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const Review = require("../model/review");
const Chat = require("../model/chat");
const Message = require("../model/message");
const Notification = require("../model/notification");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const PaymentAttempt = require("../model/paymentAttempt");
const Payment = require("../model/payment");
const favoriteService = require("../services/favoriteService");
const reviewService = require("../services/reviewService");
const chatService = require("../services/chatService");
const { createBookingFromQuotation } = require("../services/bookingService");

let mongod;
let owner;
let venue;
let space;
const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };
const HOUR = 3600000;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Review.init(), Booking.init(), Payment.init()]);
  owner = await User.create({ name: "Owner", email: "owner@race.test", password: "hashedpassword", role: "VenueOwner" });
  venue = await Venue.create({ owner: owner._id, venueName: "Race Palace", location, status: "approved" });
  space = await Space.create({ venue: venue._id, name: "Main", capacity: 300 });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("favorites", () => {
  it("N concurrent toggles never duplicate a venue and land on the right parity", async () => {
    const user = await User.create({ name: "Fan", email: "fan@race.test", password: "hashedpassword" });
    await Promise.all(Array.from({ length: 21 }, () => favoriteService.toggleFavorite(user._id, venue._id)));
    const after = await User.findById(user._id).lean();
    expect(after.favorites.map(String)).toEqual([String(venue._id)]); // 21 toggles: odd -> present, exactly once

    await Promise.all(Array.from({ length: 20 }, () => favoriteService.toggleFavorite(user._id, venue._id)));
    expect((await User.findById(user._id).lean()).favorites).toHaveLength(1); // 41 toggles: still present, once
  });

  it("different venues toggled at once all survive (no lost update)", async () => {
    const user = await User.create({ name: "Fan2", email: "fan2@race.test", password: "hashedpassword" });
    const venues = await Promise.all(
      Array.from({ length: 12 }, (_, i) => Venue.create({ owner: owner._id, venueName: `Fav ${i}`, location, status: "approved" }))
    );
    await Promise.all(venues.map((v) => favoriteService.toggleFavorite(user._id, v._id)));
    expect((await User.findById(user._id).lean()).favorites).toHaveLength(12);
  });
});

describe("reviews", () => {
  it("20 concurrent reviews for the same booking create exactly one and keep the venue stats right", async () => {
    const customer = await User.create({ name: "Reviewer", email: "reviewer@race.test", password: "hashedpassword" });
    const start = new Date(Date.now() - 48 * HOUR);
    const booking = await Booking.create({
      customer: customer._id, venue: venue._id, space: space._id, startTime: start, endTime: new Date(start.getTime() + 4 * HOUR),
      numberOfGuests: 50, eventType: "Wedding", contactName: "R", phoneNumber: "9800000000", totalPrice: 1000, depositAmount: 200, balanceAmount: 800, status: "completed",
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reviewService.addReview(venue._id, customer._id, booking._id, { rating: 5, comment: "Lovely" }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    results.filter((r) => r.status === "rejected").forEach((r) => expect(r.reason.statusCode).toBe(400));
    expect(await Review.countDocuments({ booking: booking._id })).toBe(1);
    const stats = await Venue.findById(venue._id).lean();
    expect(stats.totalReviews).toBe(1);
    expect(stats.averageRating).toBe(5);
  });

  it("concurrent reviews on DIFFERENT bookings all count (the average is recomputed from the truth)", async () => {
    const customers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => User.create({ name: `C${i}`, email: `c${i}@race.test`, password: "hashedpassword" }))
    );
    const bookings = await Promise.all(
      customers.map((c, i) => {
        const start = new Date(Date.now() - (100 + i) * HOUR);
        return Booking.create({
          customer: c._id, venue: venue._id, space: space._id, startTime: start, endTime: new Date(start.getTime() + 4 * HOUR),
          numberOfGuests: 50, eventType: "Wedding", contactName: "R", phoneNumber: "9800000000", totalPrice: 1000, depositAmount: 200, balanceAmount: 800, status: "completed",
        });
      })
    );
    await Promise.all(bookings.map((b, i) => reviewService.addReview(venue._id, customers[i]._id, b._id, { rating: i % 2 ? 3 : 5, comment: "ok" })));
    const stats = await Venue.findById(venue._id).lean();
    const all = await Review.find({ venue: venue._id }).lean();
    expect(stats.totalReviews).toBe(all.length);
    expect(stats.averageRating).toBeCloseTo(all.reduce((s, r) => s + r.rating, 0) / all.length, 1);
  });
});

describe("registration", () => {
  it("20 concurrent sign-ups with the same email create exactly one account", async () => {
    const body = { name: "Dup", email: "dup@race.test", phone: "9812345678", password: "Test@1234" };
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => request(app).post("/api/auth/register").set("X-Forwarded-For", `10.1.0.${i + 1}`).send(body)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    responses.filter((r) => r.status !== 201).forEach((r) => expect(r.status).toBeLessThan(500)); // 409/400, never a crash
    expect(await User.countDocuments({ email: "dup@race.test" })).toBe(1);
  });

  it("emails differing only by case are the same account", async () => {
    // distinct client IPs so the per-IP sign-up limiter does not decide the outcome
    let ip = 0;
    const make = (email) => request(app).post("/api/auth/register").set("X-Forwarded-For", `10.2.0.${++ip}`).send({ name: "Case", email, phone: "9812345678", password: "Test@1234" });
    const responses = await Promise.all([make("Case@race.test"), make("case@RACE.test"), make("CASE@race.TEST")]);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await User.countDocuments({ email: "case@race.test" })).toBe(1);
  });
});

describe("chat and notification fan-out", () => {
  it("every concurrent message produces one message and one notification, and the chat preview ends on the newest", async () => {
    const a = await User.create({ name: "A", email: "a@race.test", password: "hashedpassword" });
    const chat = await Chat.create({ participants: [a._id, owner._id], venueId: venue._id });

    const N = 30;
    await Promise.all(Array.from({ length: N }, (_, i) => chatService.saveMessage(String(chat._id), String(a._id), `hello ${i}`)));

    expect(await Message.countDocuments({ chatId: chat._id })).toBe(N);
    expect(await Notification.countDocuments({ recipient: owner._id, type: "chat" })).toBe(N);
    const newest = await Message.findOne({ chatId: chat._id }).sort("-createdAt").lean();
    const stored = await Chat.findById(chat._id).lean();
    expect(stored.lastMessage.timestamp.getTime()).toBe(newest.createdAt.getTime());

    const list = await chatService.getUserChats(owner._id, null);
    expect(list[0].unreadCount).toBe(N);
    expect(list[0].lastMessage.timestamp.getTime()).toBe(newest.createdAt.getTime());
  });

  it("a message that starts with $ is stored verbatim in the preview", async () => {
    const b = await User.create({ name: "B", email: "b@race.test", password: "hashedpassword" });
    const chat = await Chat.create({ participants: [b._id, owner._id], venueId: venue._id });
    await chatService.saveMessage(String(chat._id), String(b._id), "$setUnion price?");
    expect((await Chat.findById(chat._id).lean()).lastMessage.text).toBe("$setUnion price?");
  });
});

describe("booking the same slot", () => {
  it("50 simultaneous accepted quotations for one slot produce at most one live booking", async () => {
    const start = new Date(Date.now() + 96 * HOUR);
    const end = new Date(start.getTime() + 3 * HOUR);
    const TOTAL = 100000;
    const DEPOSIT = 20000;

    const requests = [];
    for (let i = 0; i < 50; i++) {
      const customerId = new mongoose.Types.ObjectId();
      const inquiry = await Inquiry.create({
        customer: customerId, venue: venue._id, space: space._id, preferredDate: start, numberOfGuests: 50, eventType: "Wedding", contactName: "T", phoneNumber: "9800000000",
      });
      const quotation = await Quotation.create({
        inquiry: inquiry._id, venue: venue._id, space: space._id, owner: owner._id, eventDate: start, shift: "day", startTime: start, endTime: end, numberOfGuests: 50,
        lineItems: [{ label: "Hire", quantity: 1, unitPrice: TOTAL, perGuest: false, amount: TOTAL }], totalPrice: TOTAL, depositType: "fixed", depositValue: DEPOSIT,
        depositAmount: DEPOSIT, balanceAmount: TOTAL - DEPOSIT, validUntil: new Date(Date.now() + 7 * 24 * HOUR), status: "accepted",
      });
      await PaymentAttempt.create({ quotation: quotation._id, customer: customerId, transactionUuid: `race-${i}-uuid`, amountNPR: DEPOSIT, status: "completed", transactionCode: `race_${i}` });
      requests.push({ customerId, body: { quotationId: String(quotation._id), transactionId: `race_${i}`, amountNPR: DEPOSIT } });
    }

    const results = await Promise.allSettled(requests.map((r) => createBookingFromQuotation(r.body, r.customerId)));
    const won = results.filter((r) => r.status === "fulfilled");
    const live = await Booking.countDocuments({ space: space._id, startTime: start, status: { $in: ["pending_deposit", "confirmed", "completed"] } });

    expect(won.length).toBeLessThanOrEqual(1);
    expect(live).toBe(won.length);
    results.filter((r) => r.status === "rejected").forEach((r) => expect(r.reason.statusCode).toBe(409));
  });
});
