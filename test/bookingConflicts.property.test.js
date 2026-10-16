// Double-booking rules, checked three ways: a table of named cases, a randomised comparison against a
// brute-force reference (fixed seed, thousands of combinations) and the same comparison for the raw query.
const mongoose = require("mongoose");
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const PaymentAttempt = require("../model/paymentAttempt");
const { createBookingFromQuotation, cancelBooking } = require("../services/bookingService");
const { findConflict } = require("../services/slotService");
const { resolveShiftTimes } = require("../services/shiftService");
const { slotKeysFor } = require("../utils/slotKeys");
const { world, start, stop, reset, acceptedQuotation, nepalNoon, HOUR } = require("./helpers/bookingWorld");

// Small deterministic PRNG (mulberry32): the same "random" cases on every run and every machine
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// The reference: two half-open ranges in the same space overlap when each starts before the other ends
const overlaps = (a, b) => String(a.space) === String(b.space) && a.start < b.end && b.start < a.end;

beforeAll(() => start({ customers: 2 }), 120000);
afterAll(() => stop());
beforeEach(() => reset());

describe("slot keys agree with the reference on random minute ranges", () => {
  it("share a key exactly when the ranges overlap (20,000 random pairs)", () => {
    const rand = rng(20261015);
    const base = Date.parse("2026-11-01T00:00:00Z") / 60000;
    let overlapping = 0;
    for (let i = 0; i < 20000; i++) {
      const aStart = base + Math.floor(rand() * 600);
      const aEnd = aStart + 1 + Math.floor(rand() * 720);
      const bStart = base + Math.floor(rand() * 600);
      const bEnd = bStart + 1 + Math.floor(rand() * 720);
      const sameSpace = rand() < 0.8;
      const a = { space: "A", start: aStart, end: aEnd };
      const b = { space: sameSpace ? "A" : "B", start: bStart, end: bEnd };
      const ka = slotKeysFor(a.space, new Date(aStart * 60000), new Date(aEnd * 60000));
      const kb = slotKeysFor(b.space, new Date(bStart * 60000), new Date(bEnd * 60000));
      const shared = ka.some((k) => kb.includes(k));
      if (shared) overlapping++;
      expect(shared).toBe(overlaps(a, b));
    }
    expect(overlapping).toBeGreaterThan(2000); // the sample really contains both outcomes
    expect(overlapping).toBeLessThan(18000);
  });
});

describe("conflict rules (table)", () => {
  const book = async ({ space = world.space, shift = "day", daysFromNow = 40, slot = null, customer = world.customer, venue = world.venue }) => {
    const a = await acceptedQuotation({ space, shift, daysFromNow, slot, customer, venue });
    try {
      const booking = await createBookingFromQuotation(a.request, customer._id);
      return { ok: true, booking };
    } catch (error) {
      return { ok: false, status: error.statusCode, attempt: a.attempt };
    }
  };

  const shiftCases = [
    // [name, existing, new, conflict?]
    ["identical slot", { shift: "day" }, { shift: "day" }, true],
    ["identical night", { shift: "night" }, { shift: "night" }, true],
    ["identical full day", { shift: "full_day" }, { shift: "full_day" }, true],
    ["day and night on one date do not conflict (15:00 vs 17:00)", { shift: "day" }, { shift: "night" }, false],
    ["night then day on one date do not conflict", { shift: "night" }, { shift: "day" }, false],
    ["full day blocks the day shift", { shift: "full_day" }, { shift: "day" }, true],
    ["full day blocks the night shift", { shift: "full_day" }, { shift: "night" }, true],
    ["day blocks a later full day", { shift: "day" }, { shift: "full_day" }, true],
    ["night blocks a later full day", { shift: "night" }, { shift: "full_day" }, true],
    ["same shift on the next day is free", { shift: "day" }, { shift: "day", daysFromNow: 41 }, false],
    ["night on the previous day is free", { shift: "night", daysFromNow: 39 }, { shift: "day" }, false],
    ["full day next to a full day", { shift: "full_day" }, { shift: "full_day", daysFromNow: 41 }, false],
    ["different space, same slot", { shift: "day" }, { shift: "day", space: "space2" }, false],
    ["another venue, same slot", { shift: "day" }, { shift: "day", space: "otherSpace", venue: "otherVenue" }, false],
  ];

  it.each(shiftCases)("%s", async (_name, existing, next, conflict) => {
    const resolve = (spec) => ({ ...spec, ...(spec.space ? { space: world[spec.space] } : {}), ...(spec.venue ? { venue: world[spec.venue] } : {}) });
    expect((await book(resolve(existing))).ok).toBe(true);
    const second = await book(resolve(next));
    expect(second.ok).toBe(!conflict);
    if (conflict) {
      expect(second.status).toBe(409);
      expect((await PaymentAttempt.findById(second.attempt._id)).status).toBe("refund_due");
    }
    expect(await Booking.countDocuments({ status: "confirmed" })).toBe(conflict ? 1 : 2);
  });

  // Arbitrary instants: partial overlap on either side, containment both ways, exact touching
  const T0 = () => nepalNoon(45);
  const at = (minutes) => new Date(T0().getTime() + minutes * 60000);
  const slotCases = [
    ["partial overlap: the new one starts inside", [0, 120], [60, 180], true],
    ["partial overlap: the new one ends inside", [60, 180], [0, 120], true],
    ["the new one contains the old", [60, 120], [0, 180], true],
    ["the new one sits inside the old", [0, 180], [60, 120], true],
    ["identical range", [0, 120], [0, 120], true],
    ["touching: new starts exactly when old ends", [0, 120], [120, 240], false],
    ["touching: new ends exactly when old starts", [120, 240], [0, 120], false],
    ["one minute of overlap at the end", [0, 120], [119, 240], true],
    ["one minute of overlap at the start", [120, 240], [0, 121], true],
    ["one minute gap", [0, 120], [121, 240], false],
    ["far apart", [0, 120], [600, 720], false],
  ];
  it.each(slotCases)("%s", async (_name, first, second, conflict) => {
    expect((await book({ slot: { startTime: at(first[0]), endTime: at(first[1]) } })).ok).toBe(true);
    const next = await book({ slot: { startTime: at(second[0]), endTime: at(second[1]) } });
    expect(next.ok).toBe(!conflict);
  });

  it.each([
    ["one millisecond of overlap (not on a minute: query-only protection)", 1, true],
    ["touching to the millisecond", 0, false],
    ["one millisecond gap", -1, false],
  ])("off-the-minute instants: %s", async (_name, overlapMs, conflict) => {
    const start0 = new Date(T0().getTime() + 1234);
    const end0 = new Date(start0.getTime() + 2 * HOUR);
    expect((await book({ slot: { startTime: start0, endTime: end0 } })).ok).toBe(true);
    const next = await book({ slot: { startTime: new Date(end0.getTime() - overlapMs), endTime: new Date(end0.getTime() - overlapMs + 2 * HOUR) } });
    expect(next.ok).toBe(!conflict);
  });

  describe("overrides and odd ranges", () => {
    const override = (shift, startTime, endTime) => ({ shiftOverrides: [{ shift, startTime, endTime }] });
    const bookWith = async (space, shift, daysFromNow = 40) => book({ space, shift, daysFromNow });

    it("a day shift stretched to 17:30 overlaps the night shift by 30 minutes", async () => {
      Object.assign(world.space, override("day", "10:00", "17:30"));
      expect((await bookWith(world.space, "day")).ok).toBe(true);
      expect((await bookWith(world.space, "night")).ok).toBe(false);
    });

    it("a day shift ending at exactly 17:00 touches the night shift without conflicting", async () => {
      Object.assign(world.space, override("day", "10:00", "17:00"));
      expect((await bookWith(world.space, "day")).ok).toBe(true);
      expect((await bookWith(world.space, "night")).ok).toBe(true);
    });

    it("a night shift starting at 16:59 conflicts with a day shift ending at 17:00", async () => {
      Object.assign(world.space, { shiftOverrides: [{ shift: "day", startTime: "10:00", endTime: "17:00" }, { shift: "night", startTime: "16:59", endTime: "22:00" }] });
      expect((await bookWith(world.space, "day")).ok).toBe(true);
      expect((await bookWith(world.space, "night")).ok).toBe(false);
    });

    it("a tiny override inside a booked full day conflicts", async () => {
      Object.assign(world.space, override("day", "12:00", "12:01"));
      expect((await bookWith(world.space, "full_day")).ok).toBe(true);
      expect((await bookWith(world.space, "day")).ok).toBe(false);
    });

    it("an invalid override (end before start) cannot be booked at all", async () => {
      Object.assign(world.space, override("night", "20:00", "02:00"));
      await expect(acceptedQuotation({ space: world.space, shift: "night" })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("overrides are per space: the same shift on another space keeps the default hours", async () => {
      Object.assign(world.space, override("day", "10:00", "17:30"));
      expect((await bookWith(world.space, "day")).ok).toBe(true);
      expect((await bookWith(world.space2, "night")).ok).toBe(true);
    });
  });

  describe("statuses", () => {
    const rawBooking = async (fields) => {
      const { startTime, endTime } = resolveShiftTimes(nepalNoon(40), "day", world.space);
      return Booking.create({
        customer: world.customer._id,
        venue: world.venue._id,
        space: world.space._id,
        startTime,
        endTime,
        numberOfGuests: 10,
        eventType: "Party",
        contactName: "X",
        phoneNumber: "9800000000",
        totalPrice: 1000,
        depositAmount: 200,
        balanceAmount: 800,
        ...fields,
      });
    };

    it("a cancelled booking frees the slot", async () => {
      await rawBooking({ status: "cancelled" });
      expect((await book({})).ok).toBe(true);
    });

    it("a completed booking still blocks it", async () => {
      await rawBooking({ status: "completed" });
      const second = await book({});
      expect(second.ok).toBe(false);
      expect(second.status).toBe(409);
    });

    it("a pending claim blocks the slot while its hold is live", async () => {
      await rawBooking({ status: "pending_deposit", holdClaimExpiresAt: new Date(Date.now() + 60000) });
      expect((await book({})).ok).toBe(false);
    });

    it("a pending claim with no expiry set keeps blocking", async () => {
      await rawBooking({ status: "pending_deposit" });
      expect((await book({})).ok).toBe(false);
    });

    it("an expired claim does not block, even though the TTL monitor has not removed it yet", async () => {
      const stale = await rawBooking({ status: "pending_deposit", holdClaimExpiresAt: new Date(Date.now() - 1000) });
      expect(await Booking.exists({ _id: stale._id })).toBeTruthy(); // still in the collection
      const second = await book({});
      expect(second.ok).toBe(true);
      expect(await Booking.exists({ _id: stale._id })).toBeFalsy(); // cleared on the way past
      expect(await Booking.countDocuments({ status: "confirmed" })).toBe(1);
    });

    it("a claim blocks until the very instant its hold expires, and not at it", async () => {
      const expires = new Date(Date.now() + 100000);
      const claim = await rawBooking({ status: "pending_deposit", holdClaimExpiresAt: expires });
      const query = { space: world.space._id, startTime: claim.startTime, endTime: claim.endTime };
      expect(await findConflict({ ...query, now: new Date(expires.getTime() - 1) })).toBeTruthy();
      expect(await findConflict({ ...query, now: expires })).toBeFalsy();
      expect(await findConflict({ ...query, now: new Date(expires.getTime() + 1) })).toBeFalsy();
    });

    it("cancelling a booking through the service frees the slot at once", async () => {
      const first = await book({});
      await cancelBooking(first.booking._id, world.customer, null);
      expect((await book({})).ok).toBe(true);
    });
  });
});

describe("randomised comparison with a brute-force reference", () => {
  jest.setTimeout(240000);

  it("accepts and rejects exactly the bookings the reference does, over 1,500 random requests", async () => {
    const rand = rng(424242);
    const spaces = [world.space, world.space2, world.otherSpace];
    const venues = new Map([
      [String(world.space._id), world.venue],
      [String(world.space2._id), world.venue],
      [String(world.otherSpace._id), world.otherVenue],
    ]);
    const shifts = ["day", "night", "full_day"];
    const active = []; // reference state: { id, space, start, end }
    let accepted = 0;
    let rejected = 0;
    let cancelled = 0;

    for (let step = 0; step < 1500; step++) {
      // Occasionally change a space's hours, sometimes to something odd
      if (rand() < 0.05) {
        const space = spaces[Math.floor(rand() * 3)];
        const shift = shifts[Math.floor(rand() * 3)];
        const from = Math.floor(rand() * 20);
        const to = from + 1 + Math.floor(rand() * 4);
        const hh = (h) => `${String(h).padStart(2, "0")}:${rand() < 0.5 ? "00" : "30"}`;
        space.shiftOverrides = rand() < 0.4 ? [] : [{ shift, startTime: hh(from), endTime: hh(Math.min(to, 23)) }];
      }

      if (active.length && rand() < 0.15) {
        const victim = active.splice(Math.floor(rand() * active.length), 1)[0];
        await cancelBooking(victim.id, world.customer, null);
        cancelled++;
        continue;
      }

      const space = spaces[Math.floor(rand() * 3)];
      const shift = shifts[Math.floor(rand() * 3)];
      // Days around a month end and the Kathmandu midnight, at random instants of that day
      const day = 40 + Math.floor(rand() * 4);
      const instant = new Date(nepalNoon(day).getTime() + Math.floor((rand() - 0.5) * 20) * HOUR);
      let times;
      try {
        times = resolveShiftTimes(instant, shift, space);
      } catch {
        continue; // an invalid override: nothing can be quoted for it
      }
      const wanted = { space: space._id, start: times.startTime, end: times.endTime };
      const expectedFree = !active.some((b) => overlaps(b, wanted));

      const quote = await acceptedQuotation({ space, venue: venues.get(String(space._id)), shift, eventDate: instant });
      // acceptedQuotation resolved the same hours with the same space object; assert that, then book
      expect(quote.quotation.startTime.getTime()).toBe(times.startTime.getTime());
      let result = null;
      try {
        result = await createBookingFromQuotation(quote.request, world.customer._id);
      } catch (error) {
        expect(error.statusCode).toBe(409);
      }
      expect(Boolean(result)).toBe(expectedFree);
      if (result) {
        active.push({ id: result._id, ...wanted });
        accepted++;
      } else {
        rejected++;
      }
    }

    expect(accepted).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(100);
    expect(cancelled).toBeGreaterThan(30);

    // The database agrees with the reference, and no two active bookings in a space ever overlap
    const stored = await Booking.find({ status: { $in: ["pending_deposit", "confirmed", "completed"] } }).lean();
    expect(stored).toHaveLength(active.length);
    expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    for (let i = 0; i < stored.length; i++) {
      for (let j = i + 1; j < stored.length; j++) {
        expect(overlaps({ space: stored[i].space, start: stored[i].startTime, end: stored[i].endTime }, { space: stored[j].space, start: stored[j].startTime, end: stored[j].endTime })).toBe(false);
      }
    }
    // One deposit payment per live booking, one refund per cancellation, nothing orphaned
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(active.length + cancelled);
    expect(await Payment.countDocuments({ type: "refund" })).toBe(cancelled);
  });
});

describe("findConflict against a brute-force reference (raw documents)", () => {
  it("agrees on 3,000 random queries over a mixed set of stored bookings, including expired claims", async () => {
    const rand = rng(777);
    const base = Date.parse("2026-12-01T00:00:00Z");
    const statuses = ["confirmed", "completed", "cancelled", "pending_deposit"];
    const docs = [];
    for (let i = 0; i < 80; i++) {
      const status = statuses[Math.floor(rand() * 4)];
      const startMs = base + Math.floor(rand() * 5 * 24 * 60) * 60000 + (rand() < 0.2 ? Math.floor(rand() * 60000) : 0);
      const endMs = startMs + (1 + Math.floor(rand() * 600)) * 60000;
      const live = status === "pending_deposit" ? rand() < 0.5 : null;
      docs.push({
        customer: world.customer._id,
        venue: world.venue._id,
        space: rand() < 0.5 ? world.space._id : world.space2._id,
        startTime: new Date(startMs),
        endTime: new Date(endMs),
        numberOfGuests: 1,
        eventType: "x",
        contactName: "x",
        phoneNumber: "9800000000",
        totalPrice: 1,
        depositAmount: 1,
        balanceAmount: 0,
        status,
        ...(status === "pending_deposit" ? { holdClaimExpiresAt: new Date(Date.now() + (live ? 1 : -1) * 60000) } : {}),
      });
    }
    // Raw insert: no slot keys, so overlapping documents are allowed here and only the query is under test
    await Booking.collection.insertMany(docs.map((d) => ({ ...d, _id: new mongoose.Types.ObjectId() })));

    const now = new Date();
    const blocks = (d) => d.status === "confirmed" || d.status === "completed" || (d.status === "pending_deposit" && d.holdClaimExpiresAt > now);
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const space = rand() < 0.5 ? world.space._id : world.space2._id;
      const startMs = base + Math.floor(rand() * 5 * 24 * 60) * 60000 + (rand() < 0.2 ? Math.floor(rand() * 60000) : 0);
      const endMs = startMs + (1 + Math.floor(rand() * 600)) * 60000;
      const expected = docs.some((d) => String(d.space) === String(space) && blocks(d) && d.startTime.getTime() < endMs && startMs < d.endTime.getTime());
      const got = Boolean(await findConflict({ space, startTime: new Date(startMs), endTime: new Date(endMs), now }));
      if (expected) hits++;
      expect(got).toBe(expected);
    }
    expect(hits).toBeGreaterThan(300);
    expect(hits).toBeLessThan(2900);
  });
});

describe("the database itself refuses an overlapping active booking", () => {
  it("rejects a second document that shares a minute, even when written around the service", async () => {
    const { startTime, endTime } = resolveShiftTimes(nepalNoon(60), "day", world.space);
    const make = (start, end, status = "confirmed") => ({
      customer: world.customer._id,
      venue: world.venue._id,
      space: world.space._id,
      startTime: start,
      endTime: end,
      numberOfGuests: 1,
      eventType: "x",
      contactName: "x",
      phoneNumber: "9800000000",
      totalPrice: 1,
      depositAmount: 1,
      balanceAmount: 0,
      status,
    });
    await Booking.create(make(startTime, endTime));
    await expect(Booking.create(make(new Date(startTime.getTime() + HOUR), new Date(endTime.getTime() + HOUR)))).rejects.toMatchObject({ code: 11000 });
    // touching is fine; a cancelled one never holds keys against anyone
    await expect(Booking.create(make(endTime, new Date(endTime.getTime() + HOUR)))).resolves.toBeTruthy();
    await expect(Booking.create(make(startTime, endTime, "cancelled"))).resolves.toBeTruthy();
    // and a cancelled booking that is later restored cannot collide silently
    const old = await Booking.findOne({ status: "cancelled" });
    await expect(Booking.updateOne({ _id: old._id }, { status: "confirmed" })).rejects.toMatchObject({ code: 11000 });
    const keyed = await Booking.findOne({ status: "confirmed", startTime }).select("+slotKeys");
    expect(keyed.slotKeys).toHaveLength(300);
  });
});

describe("backfillSlotKeys (for bookings stored before the keys existed)", () => {
  it("protects old bookings, skips off-the-minute ones and reports existing double bookings", async () => {
    const { backfillSlotKeys } = require("../services/slotService");
    const { startTime, endTime } = resolveShiftTimes(nepalNoon(70), "day", world.space);
    const old = (extra) => ({
      _id: new mongoose.Types.ObjectId(), customer: world.customer._id, venue: world.venue._id, space: world.space._id, numberOfGuests: 1,
      eventType: "x", contactName: "x", phoneNumber: "9800000000", totalPrice: 1, depositAmount: 1, balanceAmount: 0, status: "confirmed", ...extra,
    });
    const first = old({ startTime, endTime });
    const doubleBooked = old({ startTime: new Date(startTime.getTime() + HOUR), endTime: new Date(endTime.getTime() + HOUR) });
    const offMinute = old({ startTime: new Date(endTime.getTime() + 5 * HOUR + 7), endTime: new Date(endTime.getTime() + 8 * HOUR + 7) });
    const cancelled = old({ startTime, endTime, status: "cancelled" });
    await Booking.collection.insertMany([first, doubleBooked, offMinute, cancelled]);

    const report = await backfillSlotKeys();
    expect(report).toEqual({ updated: 1, skipped: 1, conflicts: [String(doubleBooked._id)] });
    expect(await Booking.findById(first._id).select("+slotKeys").then((b) => b.slotKeys.length)).toBe(300);
    // a new booking for the same hours is now refused by the database itself
    await expect(Booking.create({ ...first, _id: undefined, startTime, endTime })).rejects.toMatchObject({ code: 11000 });
    expect(await backfillSlotKeys()).toEqual({ updated: 0, skipped: 1, conflicts: [String(doubleBooked._id)] });
  });
});
