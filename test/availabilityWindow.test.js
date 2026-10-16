// GET /api/venues/:venueId/availability: the public list of taken time ranges behind the date picker.
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const Booking = require("../model/booking");
const Venue = require("../model/venue");
const Space = require("../model/space");
const { createBookingFromQuotation } = require("../services/bookingService");
const { cancelBooking } = require("../services/bookingService");
const { resolveShiftTimes } = require("../services/shiftService");
const { world, start, stop, reset, acceptedQuotation, nepalNoon, HOUR, DAY } = require("./helpers/bookingWorld");

beforeAll(() => start({ customers: 2 }), 120000);
afterAll(() => stop());
beforeEach(() => reset());

const get = (venue, query) => request(app).get(`/api/venues/${venue._id || venue}/availability`).query(query);
const window = (fromMs, toMs) => ({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });

const rawBooking = (fields = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  customer: world.customer._id,
  venue: world.venue._id,
  space: world.space._id,
  numberOfGuests: 80,
  eventType: "Wedding",
  contactName: "Private Person",
  phoneNumber: "9812345678",
  specialRequirements: "secret request",
  totalPrice: 987654,
  depositAmount: 12345,
  balanceAmount: 975309,
  status: "confirmed",
  ...fields,
});

describe("what the endpoint returns", () => {
  it("returns {success, data} with only space, startTime and endTime", async () => {
    const { startTime, endTime } = resolveShiftTimes(nepalNoon(20), "night", world.space);
    await Booking.collection.insertOne(rawBooking({ startTime, endTime }));

    const res = await get(world.venue, window(Date.now(), Date.now() + 30 * DAY)).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(["endTime", "space", "startTime"]);
    expect(res.body.data[0]).toEqual({ space: String(world.space._id), startTime: startTime.toISOString(), endTime: endTime.toISOString() });
    // No personal or financial detail anywhere in the payload
    const text = JSON.stringify(res.body);
    for (const secret of ["Private Person", "9812345678", "secret request", "987654", "12345", String(world.customer._id), world.customer.email]) {
      expect(text).not.toContain(secret);
    }
  });

  it("is public: it needs no login", async () => {
    await get(world.venue, window(Date.now(), Date.now() + DAY)).expect(200);
  });

  it("lists confirmed, completed and live pending bookings only", async () => {
    const day = (n, shift) => resolveShiftTimes(nepalNoon(n), shift, world.space);
    const docs = [
      rawBooking({ ...day(10, "day"), status: "confirmed" }),
      rawBooking({ ...day(11, "day"), status: "completed" }),
      rawBooking({ ...day(12, "day"), status: "pending_deposit", holdClaimExpiresAt: new Date(Date.now() + 60000) }),
      rawBooking({ ...day(13, "day"), status: "pending_deposit" }), // no expiry recorded: still holds
      rawBooking({ ...day(14, "day"), status: "pending_deposit", holdClaimExpiresAt: new Date(Date.now() - 1000) }), // expired, TTL monitor has not run
      rawBooking({ ...day(15, "day"), status: "cancelled" }),
    ];
    await Booking.collection.insertMany(docs);
    const res = await get(world.venue, window(Date.now(), Date.now() + 30 * DAY)).expect(200);
    const starts = res.body.data.map((b) => b.startTime);
    expect(starts).toEqual([0, 1, 2, 3].map((i) => docs[i].startTime.toISOString()));
  });

  it("shows a slot as taken the moment it is booked and free again the moment it is cancelled", async () => {
    const a = await acceptedQuotation({ daysFromNow: 25, shift: "night" });
    const booking = await createBookingFromQuotation(a.request, a.customer._id);
    const win = window(Date.now(), Date.now() + 40 * DAY);
    expect((await get(world.venue, win)).body.data).toHaveLength(1);

    await cancelBooking(booking._id, world.customer, null);
    expect((await get(world.venue, win)).body.data).toHaveLength(0);
  });

  it("reports every space of the venue and never another venue's", async () => {
    const mine = resolveShiftTimes(nepalNoon(10), "day", world.space);
    const lawn = resolveShiftTimes(nepalNoon(10), "night", world.space2);
    const theirs = resolveShiftTimes(nepalNoon(10), "day", world.otherSpace);
    await Booking.collection.insertMany([
      rawBooking({ ...mine }),
      rawBooking({ ...lawn, space: world.space2._id }),
      rawBooking({ ...theirs, venue: world.otherVenue._id, space: world.otherSpace._id }),
    ]);
    const res = await get(world.venue, window(Date.now(), Date.now() + 30 * DAY)).expect(200);
    expect(res.body.data.map((b) => b.space).sort()).toEqual([String(world.space._id), String(world.space2._id)].sort());
    const other = await get(world.otherVenue, window(Date.now(), Date.now() + 30 * DAY)).expect(200);
    expect(other.body.data.map((b) => b.space)).toEqual([String(world.otherSpace._id)]);
  });

  it("does not report the bookings of a space that was removed from the venue", async () => {
    const gone = await Space.create({ venue: world.venue._id, name: "Closed Wing", capacity: 10, isActive: false });
    const t = resolveShiftTimes(nepalNoon(10), "day", gone);
    await Booking.collection.insertOne(rawBooking({ ...t, space: gone._id }));
    const res = await get(world.venue, window(Date.now(), Date.now() + 30 * DAY)).expect(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("window edges", () => {
  const from = Date.parse("2027-03-01T00:00:00Z");
  const to = Date.parse("2027-03-31T00:00:00Z");
  const book = (startMs, endMs) => Booking.collection.insertOne(rawBooking({ startTime: new Date(startMs), endTime: new Date(endMs) }));

  it.each([
    ["ends exactly when the window starts", from - 2 * HOUR, from, false],
    ["ends one millisecond into the window", from - 2 * HOUR, from + 1, true],
    ["starts exactly when the window ends", to, to + 2 * HOUR, false],
    ["starts one millisecond before the window ends", to - 1, to + 2 * HOUR, true],
    ["spans the whole window", from - DAY, to + DAY, true],
    ["sits inside the window", from + DAY, from + DAY + 5 * HOUR, true],
    ["is entirely before", from - 3 * DAY, from - 2 * DAY, false],
    ["is entirely after", to + 2 * DAY, to + 3 * DAY, false],
  ])("a booking that %s", async (_name, s, e, listed) => {
    await book(s, e);
    const res = await get(world.venue, window(from, to)).expect(200);
    expect(res.body.data).toHaveLength(listed ? 1 : 0);
  });

  it("understands offsets: 00:00 on 1 March in Kathmandu is the previous UTC evening", async () => {
    // a booking that ends at 18:00 UTC on 28 Feb is inside a window that opens at 00:00 Kathmandu on 1 March only if it ends after 18:15 UTC
    await book(Date.parse("2027-02-28T12:00:00Z"), Date.parse("2027-02-28T18:00:00Z"));
    const kathmandu = await get(world.venue, { from: "2027-03-01T00:00:00+05:45", to: "2027-03-02T00:00:00+05:45" }).expect(200);
    expect(kathmandu.body.data).toHaveLength(0);
    const utc = await get(world.venue, { from: "2027-02-28T17:00:00Z", to: "2027-03-02T00:00:00Z" }).expect(200);
    expect(utc.body.data).toHaveLength(1);
  });

  it("sorts bookings by start time", async () => {
    await book(from + 5 * DAY, from + 5 * DAY + HOUR);
    await book(from + DAY, from + DAY + HOUR);
    await book(from + 3 * DAY, from + 3 * DAY + HOUR);
    const res = await get(world.venue, window(from, to)).expect(200);
    const starts = res.body.data.map((b) => Date.parse(b.startTime));
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });
});

describe("window validation", () => {
  const f = Date.parse("2027-03-01T00:00:00Z");

  it.each([
    ["no parameters", {}],
    ["no from", { to: "2027-03-05T00:00:00Z" }],
    ["no to", { from: "2027-03-01T00:00:00Z" }],
    ["empty strings", { from: "", to: "" }],
    ["text", { from: "nope", to: "also nope" }],
    ["a millisecond count (not a date string)", { from: "1700000000000", to: "1700086400000" }],
    ["to equal to from", { from: "2027-03-01T00:00:00Z", to: "2027-03-01T00:00:00Z" }],
    ["to before from", { from: "2027-03-05T00:00:00Z", to: "2027-03-01T00:00:00Z" }],
    ["one millisecond over 93 days", { from: new Date(f).toISOString(), to: new Date(f + 93 * DAY + 1).toISOString() }],
    ["a year", { from: "2027-01-01T00:00:00Z", to: "2028-01-01T00:00:00Z" }],
    ["from given twice", "from=2027-03-01&from=2027-03-02&to=2027-03-10"],
    ["a nested object", "from[$gt]=2027-03-01&to=2027-03-10"],
  ])("rejects %s with a 400 and a message", async (_name, query) => {
    const res = await get(world.venue, query).expect(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe("string");
  });

  it("accepts exactly 93 days, a single millisecond and date-only values", async () => {
    await get(world.venue, window(f, f + 93 * DAY)).expect(200);
    await get(world.venue, window(f, f + 1)).expect(200);
    await get(world.venue, { from: "2027-03-01", to: "2027-03-08" }).expect(200);
  });

  it("answers 404 for an unknown, unapproved or deleted venue and 400 for a malformed id", async () => {
    const win = window(f, f + DAY);
    await get(new mongoose.Types.ObjectId(), win).expect(404);
    const draft = await Venue.create({ owner: world.owner._id, venueName: "Draft", location: world.venue.location, status: "pending" });
    await get(draft, win).expect(404);
    const deleted = await Venue.create({ owner: world.owner._id, venueName: "Deleted", location: world.venue.location, status: "approved", isDeleted: true });
    await get(deleted, win).expect(404);
    await get("not-an-id", win).expect(400);
  });
});

describe("large windows", () => {
  it("returns every booking of a 93 day window for a busy venue in order, up to the safety cap", async () => {
    const from = Date.parse("2027-04-01T00:00:00Z");
    const spaces = [world.space._id, world.space2._id];
    const docs = [];
    // 2 spaces x 93 days x 3 shifts: far more than the date picker ever needs
    for (let d = 0; d < 93; d++) {
      for (const space of spaces) {
        for (const [h0, h1] of [[4, 9], [11, 16], [4, 16]]) {
          docs.push(rawBooking({ space, startTime: new Date(from + d * DAY + h0 * HOUR), endTime: new Date(from + d * DAY + h1 * HOUR) }));
        }
      }
    }
    await Booking.collection.insertMany(docs);
    const res = await get(world.venue, window(from, from + 93 * DAY)).expect(200);
    expect(res.body.data).toHaveLength(docs.length);
    const starts = res.body.data.map((b) => Date.parse(b.startTime));
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });

  it("never returns more than 20,000 rows, however many bookings exist", async () => {
    const from = Date.parse("2027-08-01T00:00:00Z");
    const docs = Array.from({ length: 20050 }, (_, i) => rawBooking({ startTime: new Date(from + i * 60000), endTime: new Date(from + i * 60000 + 30000) }));
    await Booking.collection.insertMany(docs, { ordered: false });
    const res = await get(world.venue, window(from, from + 30 * DAY)).expect(200);
    expect(res.body.data.length).toBe(20000);
  });
});
