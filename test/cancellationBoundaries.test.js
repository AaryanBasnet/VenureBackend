// Cancellation and refunds, to the millisecond: the 30 / 15 / 7 day tiers, odd deposits, who gets what,
// and what the calendar looks like afterwards. The clock is frozen so every boundary is exact.
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Notification = require("../model/notification");
const bookingService = require("../services/bookingService");
const venueService = require("../services/venueService");
const { world, start, stop, reset, freezeTime, unfreezeTime, acceptedQuotation, nextId, DAY, HOUR } = require("./helpers/bookingWorld");

const NOW = new Date("2026-10-06T06:00:00.000Z");
const TIERS = bookingService.CANCELLATION_REFUND_TIERS;

beforeAll(() => start({ customers: 2 }), 120000);
afterAll(() => stop());
beforeEach(async () => {
  unfreezeTime();
  await reset();
});
afterEach(() => unfreezeTime());

// A confirmed booking whose event starts `startsInMs` after NOW, with its paid deposit
const bookingStarting = async (startsInMs, { deposit = 20000, policy = TIERS, status = "confirmed", payment = true, shift = "day" } = {}) => {
  const startTime = new Date(NOW.getTime() + startsInMs);
  const booking = await Booking.create({
    customer: world.customer._id,
    venue: world.venue._id,
    space: world.space._id,
    eventDate: startTime,
    shift,
    startTime,
    endTime: new Date(startTime.getTime() + 5 * HOUR),
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
    totalPrice: deposit * 5,
    depositAmount: deposit,
    balanceAmount: deposit * 4,
    cancellationPolicy: policy,
    status,
  });
  if (payment) {
    await Payment.create({ booking: booking._id, type: "deposit", provider: "esewa", transactionId: nextId("TC"), amountReceived: deposit, currency: "npr", amountNPR: deposit, status: "succeeded" });
  }
  return booking;
};
const refundOf = async (booking) => {
  const refunds = await Payment.find({ booking: booking._id, type: "refund" });
  expect(refunds.length).toBeLessThanOrEqual(1);
  return refunds[0] || null;
};
const cancelAt = async (booking, user = world.customer, when = NOW) => {
  freezeTime(when);
  try {
    return await bookingService.cancelBooking(booking._id, user, null);
  } finally {
    unfreezeTime();
  }
};

describe("customer refund tiers at the exact boundaries", () => {
  // [how long before the event, expected refund percentage]
  const cases = [
    ["30 days exactly", 30 * DAY, 100],
    ["30 days and 1 second", 30 * DAY + 1000, 100],
    ["30 days minus 1 millisecond", 30 * DAY - 1, 75],
    ["30 days minus 1 second", 30 * DAY - 1000, 75],
    ["29 days", 29 * DAY, 75],
    ["15 days exactly", 15 * DAY, 75],
    ["15 days minus 1 millisecond", 15 * DAY - 1, 50],
    ["15 days minus 1 second", 15 * DAY - 1000, 50],
    ["14 days", 14 * DAY, 50],
    ["7 days exactly", 7 * DAY, 50],
    ["7 days minus 1 millisecond", 7 * DAY - 1, 0],
    ["7 days minus 1 second", 7 * DAY - 1000, 0],
    ["3 days", 3 * DAY, 0],
    ["one hour", HOUR, 0],
    ["one millisecond", 1, 0],
    ["a year", 365 * DAY, 100],
  ];

  it.each(cases)("%s before the event refunds %i%%", async (_name, startsIn, percent) => {
    const booking = await bookingStarting(startsIn);
    await cancelAt(booking);
    const refund = await refundOf(booking);
    if (percent === 0) {
      expect(refund).toBeNull();
    } else {
      expect(refund.amountNPR).toBe(-(20000 * percent) / 100);
    }
    expect((await Booking.findById(booking._id)).status).toBe("cancelled");
  });

  it("an event that has started (or starts this very millisecond) can no longer be cancelled by the customer", async () => {
    for (const startsIn of [0, -1, -HOUR, -3 * DAY]) {
      await reset();
      const booking = await bookingStarting(startsIn);
      await expect(cancelAt(booking)).rejects.toMatchObject({ statusCode: 400, message: /Past or ongoing/ });
      expect((await Booking.findById(booking._id)).status).toBe("confirmed");
      expect(await refundOf(booking)).toBeNull();
    }
  });

  it("counts real elapsed time, not calendar days: a daylight saving change on the host changes nothing", async () => {
    // 30 days before 5 Nov 2026 is 6 Oct; US clocks went back on 1 Nov in between
    const booking = await Booking.create({
      customer: world.customer._id, venue: world.venue._id, space: world.space._id,
      startTime: new Date("2026-11-05T04:15:00Z"), endTime: new Date("2026-11-05T09:15:00Z"),
      numberOfGuests: 1, eventType: "x", contactName: "x", phoneNumber: "9800000000",
      totalPrice: 100000, depositAmount: 20000, balanceAmount: 80000, cancellationPolicy: TIERS, status: "confirmed",
    });
    await Payment.create({ booking: booking._id, type: "deposit", transactionId: nextId("TC"), amountReceived: 20000, amountNPR: 20000, status: "succeeded" });
    await cancelAt(booking, world.customer, new Date("2026-10-06T04:15:00Z")); // exactly 30 days
    expect((await refundOf(booking)).amountNPR).toBe(-20000);
  });
});

describe("refund amounts and records", () => {
  it.each([
    [33333, 45 * DAY, 33333],
    [33333, 20 * DAY, 25000], // 24999.75
    [33333, 10 * DAY, 16667], // 16666.5 rounds half up
    [1, 10 * DAY, 1], // 0.5 rounds up, never to nothing
    [1, 20 * DAY, 1], // 0.75
    [3, 10 * DAY, 2], // 1.5
    [99999, 20 * DAY, 74999], // 74999.25
    [10, 20 * DAY, 8], // 7.5
  ])("a deposit of %i cancelled %i ms ahead is refunded %i", async (deposit, startsIn, expected) => {
    const booking = await bookingStarting(startsIn, { deposit });
    await cancelAt(booking);
    expect((await refundOf(booking)).amountNPR).toBe(-expected);
  });

  it("records the refund as a pending, negative payment tied to the deposit", async () => {
    const booking = await bookingStarting(40 * DAY);
    const deposit = await Payment.findOne({ booking: booking._id, type: "deposit" });
    await cancelAt(booking);
    const refund = await refundOf(booking);
    expect(refund).toMatchObject({
      type: "refund",
      status: "pending",
      provider: "esewa",
      currency: "npr",
      amountNPR: -20000,
      amountReceived: -20000,
      transactionId: `refund-${deposit.transactionId}`,
    });
    expect(refund.verifiedAt).toBeTruthy();
    // the deposit itself is untouched
    expect((await Payment.findById(deposit._id)).amountNPR).toBe(20000);
  });

  it("never refunds more than was paid, whatever the stored tiers say", async () => {
    const booking = await bookingStarting(40 * DAY, { policy: [{ minDaysBefore: 0, refundPercentage: 400 }] });
    await cancelAt(booking);
    expect((await refundOf(booking)).amountNPR).toBe(-20000);
  });

  it("uses the policy stored on the booking, in any order, and falls back to the platform tiers when none is stored", async () => {
    const custom = [{ minDaysBefore: 0, refundPercentage: 20 }, { minDaysBefore: 10, refundPercentage: 90 }];
    const a = await bookingStarting(12 * DAY, { policy: custom });
    await cancelAt(a);
    expect((await refundOf(a)).amountNPR).toBe(-18000);
    const b = await bookingStarting(9 * DAY, { policy: custom });
    await cancelAt(b);
    expect((await refundOf(b)).amountNPR).toBe(-4000);
    const c = await bookingStarting(16 * DAY, { policy: [] });
    await cancelAt(c);
    expect((await refundOf(c)).amountNPR).toBe(-15000);
  });

  it.each([
    [[], 30, 100],
    [[], 29.9, 75],
    [[], 15, 75],
    [[], 14.99, 50],
    [[], 7, 50],
    [[], 6.99, 0],
    [[], 0, 0],
    [[], -3, 0],
    [[{ minDaysBefore: 5, refundPercentage: 60 }], 4, 0], // below every tier: nothing
    [[{ minDaysBefore: 5, refundPercentage: 60 }], 5, 60],
  ])("getRefundPercentage(%j, %f days) = %i", (policy, days, expected) => {
    expect(bookingService.getRefundPercentage(policy, days)).toBe(expected);
  });
});

describe("the venue or an admin cancels", () => {
  it.each([
    ["the owner, 3 days before", () => world.owner, 3 * DAY],
    ["the owner, the day before", () => world.owner, DAY],
    ["an admin, 3 days before", () => world.admin, 3 * DAY],
    ["the owner, 60 days before", () => world.owner, 60 * DAY],
  ])("%s refunds the whole deposit", async (_name, who, startsIn) => {
    const booking = await bookingStarting(startsIn, { deposit: 33333 });
    const cancelled = await cancelAt(booking, who());
    expect(cancelled.status).toBe("cancelled");
    expect((await refundOf(booking)).amountNPR).toBe(-33333);
  });

  it("tells the customer, and tells the owner when the customer cancels", async () => {
    const booking = await bookingStarting(3 * DAY);
    await cancelAt(booking, world.owner);
    const toCustomer = await Notification.find({ recipient: world.customer._id });
    expect(toCustomer.map((n) => n.message).join(" ")).toMatch(/cancelled by the venue.*full deposit will be refunded/);

    const mine = await bookingStarting(40 * DAY);
    await cancelAt(mine, world.customer);
    const toOwner = await Notification.find({ recipient: world.owner._id });
    expect(toOwner.map((n) => n.message).join(" ")).toMatch(/cancelled by the customer/);
  });

  it("a failed notification never undoes the cancellation", async () => {
    const booking = await bookingStarting(40 * DAY);
    const spy = jest.spyOn(Notification, "create").mockRejectedValue(new Error("mail down"));
    const cancelled = await cancelAt(booking);
    spy.mockRestore();
    expect(cancelled.status).toBe("cancelled");
    expect((await refundOf(booking)).amountNPR).toBe(-20000);
  });
});

describe("states and edge cases", () => {
  it("a booking still waiting for its deposit can be cancelled", async () => {
    const booking = await bookingStarting(40 * DAY, { status: "pending_deposit" });
    await cancelAt(booking);
    expect((await Booking.findById(booking._id)).status).toBe("cancelled");
  });

  it("a booking with no payment on record cancels without inventing a refund", async () => {
    const booking = await bookingStarting(40 * DAY, { payment: false });
    await cancelAt(booking);
    expect((await Booking.findById(booking._id)).status).toBe("cancelled");
    expect(await Payment.countDocuments({ type: "refund" })).toBe(0);
  });

  it.each(["cancelled", "completed"])("a %s booking cannot be cancelled again", async (status) => {
    const booking = await bookingStarting(40 * DAY, { status });
    await expect(cancelAt(booking)).rejects.toMatchObject({ statusCode: 400 });
    await expect(cancelAt(booking, world.owner)).rejects.toMatchObject({ statusCode: 400 });
    expect(await Payment.countDocuments({ type: "refund" })).toBe(0);
  });

  it("a refund that is already on record is not recorded twice and does not block the cancellation", async () => {
    const booking = await bookingStarting(40 * DAY);
    const deposit = await Payment.findOne({ booking: booking._id, type: "deposit" });
    await Payment.create({ booking: booking._id, type: "refund", transactionId: `refund-${deposit.transactionId}`, amountReceived: -20000, amountNPR: -20000, status: "pending" });
    const cancelled = await cancelAt(booking);
    expect(cancelled.status).toBe("cancelled");
    expect(await Payment.countDocuments({ type: "refund" })).toBe(1);
  });

  it("if the refund cannot be recorded, the booking stays confirmed (nobody is left owed money with no record)", async () => {
    const booking = await bookingStarting(40 * DAY);
    const spy = jest.spyOn(Payment, "create").mockRejectedValueOnce(new Error("disk full"));
    await expect(cancelAt(booking)).rejects.toThrow("disk full");
    spy.mockRestore();
    expect((await Booking.findById(booking._id)).status).toBe("confirmed");
    expect(await Payment.countDocuments({ type: "refund" })).toBe(0);
    await expect(cancelAt(booking)).resolves.toMatchObject({ status: "cancelled" }); // and a retry works
    expect((await refundOf(booking)).amountNPR).toBe(-20000);
  });
});

describe("the calendar after a cancellation", () => {
  it("the slot is free in the availability list and bookable again straight away", async () => {
    const first = await acceptedQuotation({ customer: world.customers[0], daysFromNow: 40, shift: "night" });
    const booking = await bookingService.createBookingFromQuotation(first.request, world.customers[0]._id);
    const window = { from: new Date(Date.now()).toISOString(), to: new Date(Date.now() + 60 * DAY).toISOString() };
    expect(await venueService.getVenueAvailability(String(world.venue._id), window)).toHaveLength(1);

    await bookingService.cancelBooking(booking._id, world.customers[0], null);
    expect(await venueService.getVenueAvailability(String(world.venue._id), window)).toHaveLength(0);

    const second = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 40, shift: "night" });
    await expect(bookingService.createBookingFromQuotation(second.request, world.customers[1]._id)).resolves.toMatchObject({ status: "confirmed" });
    expect(await venueService.getVenueAvailability(String(world.venue._id), window)).toHaveLength(1);
  });

  it("a completed booking keeps its slot in the availability list", async () => {
    const first = await acceptedQuotation({ customer: world.customers[0], daysFromNow: 40, shift: "day" });
    const booking = await bookingService.createBookingFromQuotation(first.request, world.customers[0]._id);
    await bookingService.completeBooking(booking._id, world.owner);
    const window = { from: new Date(Date.now()).toISOString(), to: new Date(Date.now() + 60 * DAY).toISOString() };
    expect(await venueService.getVenueAvailability(String(world.venue._id), window)).toHaveLength(1);
  });
});

describe("owner earnings use Kathmandu months", () => {
  it("counts an event at 03:00 on 1 January in Kathmandu in January, not December", async () => {
    const year = new Date().getUTCFullYear();
    const startTime = new Date(Date.UTC(year, 0, 1, 3, 0) - (5 * 60 + 45) * 60000); // 03:00 Kathmandu on 1 Jan
    await Booking.collection.insertOne({
      customer: world.customer._id, venue: world.venue._id, space: world.space._id,
      startTime, endTime: new Date(startTime.getTime() + HOUR), numberOfGuests: 1, eventType: "x", contactName: "x", phoneNumber: "9800000000",
      totalPrice: 5000, depositAmount: 1000, balanceAmount: 4000, status: "confirmed",
    });
    const months = await bookingService.getMonthlyEarningsForOwner(world.owner._id);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ month: "Jan", totalEarnings: 5000, bookingCount: 1 });
    expect(months[11].bookingCount).toBe(0);
  });
});
