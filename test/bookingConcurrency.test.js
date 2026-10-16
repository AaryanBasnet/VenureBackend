// Many requests at once: the slot must never be double-booked, and every state change (cancel, complete,
// settle) must happen exactly once however the requests interleave.
const mongoose = require("mongoose");
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const PaymentAttempt = require("../model/paymentAttempt");
const bookingService = require("../services/bookingService");
const { resolveShiftTimes } = require("../services/shiftService");
const { world, start, stop, reset, acceptedQuotation, nepalNoon, HOUR } = require("./helpers/bookingWorld");

jest.setTimeout(300000);

beforeAll(() => start({ customers: 4 }), 120000);
afterAll(() => stop());
beforeEach(() => reset());

const overlaps = (a, b) => String(a.space) === String(b.space) && a.startTime < b.endTime && b.startTime < a.endTime;
const active = () => Booking.find({ status: { $in: ["pending_deposit", "confirmed", "completed"] } }).lean();
const assertNoOverlaps = async () => {
  const live = await active();
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) expect(overlaps(live[i], live[j])).toBe(false);
  return live;
};
const settle = (promises) => Promise.allSettled(promises);
const book = (q) => bookingService.createBookingFromQuotation(q.request, q.customer._id);
const customerAt = (i) => world.customers[i % world.customers.length];

describe("simultaneous bookings of the same slot", () => {
  const race = async ({ n, round, shift = "day", space = world.space }) => {
    const quotes = [];
    for (let i = 0; i < n; i++) quotes.push(await acceptedQuotation({ customer: customerAt(i), daysFromNow: 30 + round, shift, space }));
    const results = await settle(quotes.map((q) => book(q)));
    return { quotes, results };
  };

  it.each([
    [20, 20],
    [50, 5],
  ])("with %i requests at once, repeated %i times: exactly one wins and the rest are refunded", async (n, rounds) => {
    for (let round = 0; round < rounds; round++) {
      const { quotes, results } = await race({ n, round });
      const winners = results.filter((r) => r.status === "fulfilled");
      const losers = results.filter((r) => r.status === "rejected");
      expect(winners).toHaveLength(1);
      losers.forEach((r) => expect(r.reason.statusCode).toBe(409));

      const slot = { space: world.space._id, startTime: quotes[0].quotation.startTime, endTime: quotes[0].quotation.endTime };
      expect(await Booking.countDocuments({ space: slot.space, startTime: slot.startTime, status: { $in: ["confirmed", "completed", "pending_deposit"] } })).toBe(1);
      expect(await Booking.countDocuments({ space: slot.space, startTime: slot.startTime, status: "confirmed" })).toBe(1);
      expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
      // every loser is on record as owed a refund; the winner is not
      const winnerBooking = winners[0].value;
      const refundDue = await PaymentAttempt.find({ status: "refund_due", quotation: { $in: quotes.map((q) => q.quotation._id) } });
      expect(refundDue).toHaveLength(n - 1);
      expect(await Payment.countDocuments({ booking: winnerBooking._id, type: "deposit" })).toBe(1);
    }
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(rounds);
  });

  it("different shifts of one date, all at once: no two overlapping bookings, and every refusal overlaps a winner", async () => {
    for (let round = 0; round < 10; round++) {
      await reset();
      const shifts = ["day", "night", "full_day", "day", "night", "full_day", "day", "night", "full_day", "full_day", "day", "night"];
      const quotes = [];
      for (let i = 0; i < shifts.length; i++) quotes.push(await acceptedQuotation({ customer: customerAt(i), daysFromNow: 30 + round, shift: shifts[i] }));
      const results = await settle(quotes.map((q) => book(q)));
      const live = await assertNoOverlaps();
      expect(live.length).toBeGreaterThanOrEqual(1);
      expect(live.length).toBeLessThanOrEqual(2); // day + night, or one full day
      results.forEach((r, i) => {
        if (r.status === "fulfilled") return;
        expect(r.reason.statusCode).toBe(409);
        const wanted = { space: world.space._id, startTime: quotes[i].quotation.startTime, endTime: quotes[i].quotation.endTime };
        expect(live.some((b) => overlaps(b, wanted))).toBe(true); // nobody is turned away while the slot is actually free
      });
      expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    }
  });

  it("the same slot in two different halls books in both", async () => {
    const quotes = [];
    for (let i = 0; i < 10; i++) quotes.push(await acceptedQuotation({ customer: customerAt(i), daysFromNow: 33, shift: "night", space: i % 2 ? world.space : world.space2 }));
    const results = await settle(quotes.map((q) => book(q)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await Booking.countDocuments({ status: "confirmed" })).toBe(2);
  });

  it("requests that are not on whole minutes cannot double book either (checked by query, so they may all lose, never two win)", async () => {
    for (let round = 0; round < 10; round++) {
      const startTime = new Date(nepalNoon(40 + round).getTime() + 1234);
      const quotes = [];
      for (let i = 0; i < 10; i++) quotes.push(await acceptedQuotation({ customer: customerAt(i), slot: { startTime, endTime: new Date(startTime.getTime() + 3 * HOUR) } }));
      const results = await settle(quotes.map((q) => book(q)));
      expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
      await assertNoOverlaps();
      expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    }
  });

  it("two customers paying for the same slot through the full callback chain: one booking", async () => {
    const a = await acceptedQuotation({ customer: world.customers[0], daysFromNow: 50, shift: "night" });
    const b = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 50, shift: "night" });
    const results = await settle([book(a), book(b), book(a), book(b)]);
    expect(await Booking.countDocuments({ status: "confirmed" })).toBe(1);
    const winners = new Set(results.filter((r) => r.status === "fulfilled").map((r) => String(r.value._id)));
    expect(winners.size).toBe(1);
  });
});

describe("cancel and rebook racing", () => {
  it("never leaves two active bookings, whichever finishes first (20 rounds)", async () => {
    let rebooked = 0;
    let refused = 0;
    for (let round = 0; round < 20; round++) {
      const first = await acceptedQuotation({ customer: world.customers[0], daysFromNow: 30 + round, shift: "day" });
      const booking = await book(first);
      const second = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30 + round, shift: "day" });
      const [cancelled, rebook] = await settle([bookingService.cancelBooking(booking._id, world.customers[0], null), book(second)]);
      expect(cancelled.status).toBe("fulfilled");
      await assertNoOverlaps();
      if (rebook.status === "fulfilled") {
        rebooked++;
        expect((await Booking.findById(booking._id)).status).toBe("cancelled");
      } else {
        refused++;
        expect(rebook.reason.statusCode).toBe(409);
      }
      expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    }
    expect(rebooked + refused).toBe(20);
  });

  it("a refused rebooking succeeds when retried after the cancellation", async () => {
    const first = await acceptedQuotation({ customer: world.customers[0], daysFromNow: 60, shift: "full_day" });
    const booking = await book(first);
    const second = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 60, shift: "full_day" });
    await expect(book(second)).rejects.toMatchObject({ statusCode: 409 });
    await bookingService.cancelBooking(booking._id, world.customers[0], null);
    const retry = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 60, shift: "full_day" });
    await expect(book(retry)).resolves.toMatchObject({ status: "confirmed" });
  });
});

describe("one-time state changes", () => {
  const confirmed = async (days = 60, customer = world.customers[0]) => book(await acceptedQuotation({ customer, daysFromNow: days, shift: "night" }));

  it("cancelling the same booking 15 times at once cancels it once and records one refund", async () => {
    for (let round = 0; round < 5; round++) {
      const booking = await confirmed(60 + round);
      const results = await settle(Array.from({ length: 15 }, () => bookingService.cancelBooking(booking._id, world.customers[0], null)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      results.filter((r) => r.status === "rejected").forEach((r) => expect(r.reason.statusCode).toBe(400));
      expect((await Booking.findById(booking._id)).status).toBe("cancelled");
      const refunds = await Payment.find({ booking: booking._id, type: "refund" });
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amountNPR).toBe(-20000);
    }
  });

  it("customer, owner and admin cancelling at once: one cancellation, one refund of the full amount if the venue won", async () => {
    for (let round = 0; round < 5; round++) {
      const booking = await confirmed(70 + round);
      const results = await settle([
        bookingService.cancelBooking(booking._id, world.customers[0], null),
        bookingService.cancelBooking(booking._id, world.owner, null),
        bookingService.cancelBooking(booking._id, world.admin, null),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await Payment.countDocuments({ booking: booking._id, type: "refund" })).toBe(1);
    }
  });

  it("settling the balance 12 times at once records it once", async () => {
    const booking = await confirmed();
    const results = await settle(Array.from({ length: 12 }, () => bookingService.settleBalance(booking._id, world.owner._id, { method: "cash", note: "paid in full" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    results.filter((r) => r.status === "rejected").forEach((r) => expect(r.reason.statusCode).toBe(400));
    const stored = await Booking.findById(booking._id);
    expect(stored).toMatchObject({ balanceSettled: true, balanceSettledMethod: "cash - paid in full" });
    expect(String(stored.balanceSettledBy)).toBe(String(world.owner._id));
  });

  it("completing 12 times at once completes once", async () => {
    const booking = await confirmed();
    const results = await settle(Array.from({ length: 12 }, () => bookingService.completeBooking(booking._id, world.owner)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await Booking.findById(booking._id)).status).toBe("completed");
  });

  it("complete racing cancel ends in one consistent state, with a refund exactly when it was cancelled (20 rounds)", async () => {
    for (let round = 0; round < 20; round++) {
      const booking = await confirmed(80 + round);
      const [complete, cancel] = await settle([bookingService.completeBooking(booking._id, world.owner), bookingService.cancelBooking(booking._id, world.customers[0], null)]);
      const status = (await Booking.findById(booking._id)).status;
      expect(["completed", "cancelled"]).toContain(status);
      expect(complete.status === "fulfilled").toBe(status === "completed");
      expect(cancel.status === "fulfilled").toBe(status === "cancelled");
      expect(await Payment.countDocuments({ booking: booking._id, type: "refund" })).toBe(status === "cancelled" ? 1 : 0);
    }
  });
});

describe("what is refused afterwards", () => {
  const confirmed = async () => book(await acceptedQuotation({ customer: world.customers[0], daysFromNow: 60, shift: "day" }));

  it("cancelling a completed booking is refused and refunds nothing", async () => {
    const booking = await confirmed();
    await bookingService.completeBooking(booking._id, world.owner);
    await expect(bookingService.cancelBooking(booking._id, world.customers[0], null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(bookingService.cancelBooking(booking._id, world.owner, null)).rejects.toMatchObject({ statusCode: 400 });
    expect(await Payment.countDocuments({ type: "refund" })).toBe(0);
    expect((await Booking.findById(booking._id)).status).toBe("completed");
  });

  it("completing a cancelled booking is refused", async () => {
    const booking = await confirmed();
    await bookingService.cancelBooking(booking._id, world.customers[0], null);
    await expect(bookingService.completeBooking(booking._id, world.owner)).rejects.toMatchObject({ statusCode: 400 });
    expect((await Booking.findById(booking._id)).status).toBe("cancelled");
  });

  it("the balance of a cancelled booking cannot be settled; a completed one can, once", async () => {
    const cancelled = await confirmed();
    await bookingService.cancelBooking(cancelled._id, world.customers[0], null);
    await expect(bookingService.settleBalance(cancelled._id, world.owner._id, { method: "cash" })).rejects.toMatchObject({ statusCode: 400 });

    const done = await book(await acceptedQuotation({ customer: world.customers[0], daysFromNow: 61, shift: "day" }));
    await bookingService.completeBooking(done._id, world.owner);
    await expect(bookingService.settleBalance(done._id, world.owner._id, { method: "bank transfer" })).resolves.toMatchObject({ balanceSettled: true });
    await expect(bookingService.settleBalance(done._id, world.owner._id, { method: "bank transfer" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("only the right people may act", async () => {
    const booking = await confirmed();
    await expect(bookingService.cancelBooking(booking._id, world.customers[1], null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.cancelBooking(booking._id, world.otherOwner, null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.completeBooking(booking._id, world.customers[0])).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.completeBooking(booking._id, world.otherOwner)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.settleBalance(booking._id, world.otherOwner._id, { method: "cash" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.settleBalance(booking._id, world.customers[0]._id, { method: "cash" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(bookingService.cancelBooking(new mongoose.Types.ObjectId(), world.admin, null)).rejects.toMatchObject({ statusCode: 404 });
    expect((await Booking.findById(booking._id)).status).toBe("confirmed");
  });
});

describe("a storm of mixed requests", () => {
  it("keeps every invariant when bookings, cancellations and completions all run together", async () => {
    const shifts = ["day", "night", "full_day"];
    const quotes = [];
    for (let i = 0; i < 36; i++) quotes.push(await acceptedQuotation({ customer: customerAt(i), daysFromNow: 90 + (i % 3), shift: shifts[i % 3], space: i % 5 === 0 ? world.space2 : world.space }));
    // some bookings exist first, so there is something to cancel and complete during the storm
    const existing = [];
    for (let i = 0; i < 4; i++) existing.push(await book(await acceptedQuotation({ customer: customerAt(i), daysFromNow: 100 + i, shift: "day" })));

    const ops = [
      ...quotes.map((q) => book(q)),
      ...existing.slice(0, 2).map((b) => bookingService.cancelBooking(b._id, world.customers[0], null)),
      ...existing.slice(2).map((b) => bookingService.completeBooking(b._id, world.owner)),
      ...existing.map((b) => bookingService.cancelBooking(b._id, world.owner, null)),
    ];
    await settle(ops);

    await assertNoOverlaps();
    expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    // one deposit per live-or-cancelled booking, one refund per cancelled one, and nothing paid without a booking
    const bookings = await Booking.find({}).lean();
    const deposits = await Payment.find({ type: "deposit" }).lean();
    expect(deposits).toHaveLength(bookings.length);
    expect(new Set(deposits.map((d) => String(d.booking)))).toEqual(new Set(bookings.map((b) => String(b._id))));
    const cancelled = bookings.filter((b) => b.status === "cancelled");
    expect(await Payment.countDocuments({ type: "refund" })).toBe(cancelled.length);
    for (const b of bookings) expect(b.totalPrice - b.depositAmount).toBe(b.balanceAmount);
    expect(resolveShiftTimes(nepalNoon(90), "day").startTime).toBeTruthy();
  });
});
