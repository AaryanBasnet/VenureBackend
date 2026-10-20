// Totals, deposits and balances. All money is derived on the server; these tests pin the arithmetic.
const { computeDepositAmount, resolveLineItems, createQuotation, MAX_TOTAL_NPR } = require("../services/quotationService");
const { createQuotationSchema } = require("../validators/quotationValidators");
const { createBookingFromQuotation, getRefundPercentage, refundAmountFor, CANCELLATION_REFUND_TIERS } = require("../services/bookingService");
const Quotation = require("../model/quotation");
const Booking = require("../model/booking");
const { world, start, stop, reset, nepalNoon } = require("./helpers/bookingWorld");
const Inquiry = require("../model/inquiry");
const PaymentAttempt = require("../model/paymentAttempt");

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.statusCode;
  }
  return null;
};

describe("computeDepositAmount: percentage", () => {
  // Reference in integers: round half up of total * pct / 100, with no floating point
  const reference = (total, pct) => Math.floor((2 * total * pct + 100) / 200);
  const totals = [1000, 1005, 9999, 33333, 99999, 100000, 123457, 999999, 1234567, 50000001, 1000000000];

  it("matches the integer reference for every whole percentage from 10 to 50 and many totals", () => {
    let checked = 0;
    for (const total of totals) {
      for (let pct = 10; pct <= 50; pct++) {
        const deposit = computeDepositAmount({ depositType: "percentage", depositValue: pct, totalPrice: total });
        expect(deposit).toBe(reference(total, pct));
        expect(Number.isInteger(deposit)).toBe(true);
        expect(deposit).toBeGreaterThan(0);
        expect(deposit).toBeLessThan(total); // never more than the total...
        expect(total - deposit).toBeGreaterThan(0); // ...so the balance is never negative
        checked++;
      }
    }
    expect(checked).toBe(totals.length * 41);
  });

  it.each([
    [100000, 20, 20000],
    [33333, 20, 6667], // 6666.6 rounds to 6667
    [33333, 50, 16667], // 16666.5 rounds half up
    [33333, 10, 3333],
    [1005, 10, 101], // 100.5 rounds half up
    [100001, 10, 10000], // 10000.1
    [99999, 15, 15000], // 14999.85
    [100000, 12.5, 12500], // a fractional percentage is allowed
    [33333, 12.5, 4167], // 4166.625
  ])("%i at %f%% -> %i", (total, pct, expected) => {
    expect(computeDepositAmount({ depositType: "percentage", depositValue: pct, totalPrice: total })).toBe(expected);
  });

  it.each([[9.99], [9], [0], [-20], [50.01], [51], [100], [1000], [NaN], [Infinity], [-Infinity], ["20"], [null], [undefined], [true], [[20]]])(
    "rejects a percentage of %p",
    (pct) => {
      expect(code(() => computeDepositAmount({ depositType: "percentage", depositValue: pct, totalPrice: 100000 }))).toBe(400);
    }
  );

  it("accepts exactly 10 and exactly 50", () => {
    expect(computeDepositAmount({ depositType: "percentage", depositValue: 10, totalPrice: 100000 })).toBe(10000);
    expect(computeDepositAmount({ depositType: "percentage", depositValue: 50, totalPrice: 100000 })).toBe(50000);
  });

  it.each([[0], [-1], [-100000], [NaN], [Infinity], ["100000"], [null], [undefined]])("rejects a total of %p", (total) => {
    expect(code(() => computeDepositAmount({ depositType: "percentage", depositValue: 20, totalPrice: total }))).toBe(400);
  });

  it.each([
    [1, 10],
    [3, 10],
    [4, 10], // 0.4 rounds to 0: no zero deposits
  ])("refuses a deposit that would round to nothing (total %i at %i%%)", (total, pct) => {
    expect(code(() => computeDepositAmount({ depositType: "percentage", depositValue: pct, totalPrice: total }))).toBe(400);
  });

  it("refuses a deposit that would equal the whole total (total 1 at 50%)", () => {
    expect(code(() => computeDepositAmount({ depositType: "percentage", depositValue: 50, totalPrice: 1 }))).toBe(400);
  });

  it("rejects an unknown deposit type", () => {
    for (const depositType of ["flat", "", undefined, null, "Percentage"]) {
      expect(code(() => computeDepositAmount({ depositType, depositValue: 20, totalPrice: 100000 }))).toBe(400);
    }
  });
});

describe("computeDepositAmount: fixed", () => {
  const fixed = (depositValue, totalPrice = 100000) => computeDepositAmount({ depositType: "fixed", depositValue, totalPrice });

  it("takes the amount as given, up to the paisa", () => {
    expect(fixed(25000)).toBe(25000);
    expect(fixed(0.01)).toBe(0.01);
    expect(fixed(99999.99)).toBe(99999.99);
    expect(fixed(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004 never reaches a payment
    expect(fixed(1234.5678)).toBe(1234.57);
  });

  it.each([[0], [-5], [100000], [100000.01], [250000], [NaN], [Infinity], ["5000"], [null], [undefined]])("rejects %p against a total of 100,000", (value) => {
    expect(code(() => fixed(value))).toBe(400);
  });

  it("rejects an amount that rounds up to the total", () => {
    expect(code(() => fixed(99999.999))).toBe(400);
  });
});

describe("resolveLineItems", () => {
  const items = (...list) => resolveLineItems(list, 100);

  it("multiplies quantity, unit price and (for per-guest lines) the number of guests", () => {
    const { lineItems, totalPrice } = resolveLineItems(
      [
        { label: "Hall", unitPrice: 50000, quantity: 1 },
        { label: "Catering", unitPrice: 1500, quantity: 1, perGuest: true },
        { label: "Decor", unitPrice: 2500, quantity: 3 },
        { label: "Drinks", unitPrice: 200, quantity: 2, perGuest: true },
      ],
      120
    );
    expect(lineItems.map((l) => l.amount)).toEqual([50000, 180000, 7500, 48000]);
    expect(totalPrice).toBe(285500);
  });

  it("defaults the quantity to 1 and perGuest to false", () => {
    const { lineItems } = items({ label: "Hall", unitPrice: 1000 });
    expect(lineItems[0]).toMatchObject({ quantity: 1, perGuest: false, amount: 1000 });
  });

  it("is exact where plain floating point is not", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the trap
    expect(items({ label: "a", unitPrice: 0.1 }, { label: "b", unitPrice: 0.2 }).totalPrice).toBe(0.3);
    expect(items({ label: "a", unitPrice: 0.1, quantity: 3 }).totalPrice).toBe(0.3);
    expect(items({ label: "a", unitPrice: 1.1, quantity: 3 }).totalPrice).toBe(3.3);
    const thousand = Array.from({ length: 100 }, (_, i) => ({ label: `x${i}`, unitPrice: 0.1, quantity: 10 }));
    expect(resolveLineItems(thousand, 10).totalPrice).toBe(100);
    expect(items({ label: "a", unitPrice: 19.99, perGuest: true }).totalPrice).toBe(1999);
    expect(items({ label: "a", unitPrice: 0.015 }).totalPrice).toBe(0.02); // half a paisa rounds up
  });

  it("ignores amounts and extra fields sent by the client", () => {
    const { lineItems, totalPrice } = items({ label: "Hall", unitPrice: 1000, amount: 1, totalPrice: 1, isAdmin: true });
    expect(totalPrice).toBe(1000);
    expect(lineItems[0]).not.toHaveProperty("isAdmin");
    expect(lineItems[0].amount).toBe(1000);
  });

  it("allows free line items next to paid ones", () => {
    expect(items({ label: "Hall", unitPrice: 5000 }, { label: "Welcome drink", unitPrice: 0 }).totalPrice).toBe(5000);
  });

  it.each([
    ["no items", []],
    ["not a list", "Hall"],
    ["a negative price", [{ label: "a", unitPrice: -1 }]],
    ["a NaN price", [{ label: "a", unitPrice: NaN }]],
    ["an infinite price", [{ label: "a", unitPrice: Infinity }]],
    ["a text price", [{ label: "a", unitPrice: "100" }]],
    ["no price", [{ label: "a" }]],
    ["a zero quantity", [{ label: "a", unitPrice: 10, quantity: 0 }]],
    ["a negative quantity", [{ label: "a", unitPrice: 10, quantity: -2 }]],
    ["a fractional quantity", [{ label: "a", unitPrice: 10, quantity: 1.5 }]],
    ["a NaN quantity", [{ label: "a", unitPrice: 10, quantity: NaN }]],
    ["an absurd quantity", [{ label: "a", unitPrice: 10, quantity: 1e9 }]],
    ["a total of zero", [{ label: "a", unitPrice: 0 }]],
    ["a single line above the limit", [{ label: "a", unitPrice: MAX_TOTAL_NPR + 1 }]],
    ["lines that together pass the limit", [{ label: "a", unitPrice: MAX_TOTAL_NPR }, { label: "b", unitPrice: 1 }]],
    ["an overflow to infinity", [{ label: "a", unitPrice: 1e308, quantity: 100000, perGuest: true }]],
  ])("rejects %s", (_name, list) => {
    expect(code(() => resolveLineItems(list, 50))).toBe(400);
  });

  it.each([[0], [-1], [NaN], [Infinity], [undefined]])("rejects %p guests", (guests) => {
    expect(code(() => resolveLineItems([{ label: "a", unitPrice: 10 }], guests))).toBe(400);
  });

  it("accepts a total of exactly the limit", () => {
    expect(resolveLineItems([{ label: "a", unitPrice: MAX_TOTAL_NPR }], 10).totalPrice).toBe(MAX_TOTAL_NPR);
  });

  it("keeps large totals exact", () => {
    const { totalPrice } = resolveLineItems([{ label: "Big", unitPrice: 123456789.12 }], 1);
    expect(totalPrice).toBe(123456789.12);
  });
});

describe("the request validator", () => {
  const valid = {
    space: "507f1f77bcf86cd799439011",
    eventDate: "2027-05-01T06:15:00.000Z",
    shift: "day",
    numberOfGuests: 50,
    lineItems: [{ label: "Hall", unitPrice: 1000 }],
    depositType: "percentage",
    depositValue: 20,
  };
  const parse = (overrides) => createQuotationSchema.safeParse({ ...valid, ...overrides });

  it("accepts a normal request", () => {
    expect(parse({}).success).toBe(true);
  });

  it.each([
    ["an infinite price (1e999 in JSON)", { lineItems: [{ label: "a", unitPrice: JSON.parse("1e999") }] }],
    ["a price over the limit", { lineItems: [{ label: "a", unitPrice: 2e9 }] }],
    ["an infinite deposit", { depositValue: JSON.parse("1e999") }],
    ["a quantity of zero", { lineItems: [{ label: "a", unitPrice: 5, quantity: 0 }] }],
    ["a fractional quantity", { lineItems: [{ label: "a", unitPrice: 5, quantity: 2.5 }] }],
    ["a fractional guest count", { numberOfGuests: 10.5 }],
    ["zero guests", { numberOfGuests: 0 }],
    ["a million guests", { numberOfGuests: 1_000_000 }],
    ["a date without a time zone", { eventDate: "2027-05-01" }],
    ["an unknown shift", { shift: "morning" }],
    ["a text price", { lineItems: [{ label: "a", unitPrice: "5" }] }],
  ])("rejects %s", (_name, overrides) => {
    expect(parse(overrides).success).toBe(false);
  });
});

describe("refund maths", () => {
  it.each([
    [20000, 100, 20000],
    [20000, 75, 15000],
    [20000, 50, 10000],
    [20000, 0, 0],
    [33333, 100, 33333],
    [33333, 75, 24999.75],
    [33333, 50, 16666.5],
    [1, 50, 0.5],
  ])("refundAmountFor(%f, %i%%) rounds %f to whole rupees", (deposit, pct, exact) => {
    const got = refundAmountFor(deposit, pct);
    expect(got).toBe(Math.round(exact));
    expect(Number.isInteger(got)).toBe(true);
    expect(got).toBeLessThanOrEqual(deposit + 0.5);
  });

  it("never refunds more than the deposit or less than nothing, whatever a stored policy says", () => {
    expect(getRefundPercentage([{ minDaysBefore: 0, refundPercentage: 250 }], 5)).toBe(100);
    expect(getRefundPercentage([{ minDaysBefore: 0, refundPercentage: -30 }], 5)).toBe(0);
    for (let days = 0; days < 60; days++) {
      const pct = getRefundPercentage(CANCELLATION_REFUND_TIERS, days);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("quotation totals reach the booking unchanged", () => {
  beforeAll(() => start({ customers: 1 }), 120000);
  afterAll(() => stop());
  beforeEach(() => reset());

  const payload = (overrides = {}) => ({
    space: world.space._id,
    eventDate: nepalNoon(40).toISOString(),
    shift: "night",
    numberOfGuests: 80,
    lineItems: [
      { label: "Hall", unitPrice: 45000.5, quantity: 1 },
      { label: "Plates", unitPrice: 1299.99, perGuest: true },
      { label: "Lights", unitPrice: 333.33, quantity: 3 },
    ],
    depositType: "percentage",
    depositValue: 33,
    ...overrides,
  });

  it("computes total, deposit and balance exactly once, on the server", async () => {
    const inquiry = await Inquiry.create({
      customer: world.customer._id,
      venue: world.venue._id,
      space: world.space._id,
      preferredDate: nepalNoon(40),
      numberOfGuests: 80,
      eventType: "Wedding",
      contactName: "A B",
      phoneNumber: "9800000000",
    });
    const quotation = await createQuotation(inquiry._id, world.owner._id, { ...payload(), totalPrice: 1, depositAmount: 1, balanceAmount: 1 }, null);

    const expectedTotal = 45000.5 + 1299.99 * 80 + 333.33 * 3; // 45000.5 + 103999.2 + 999.99
    expect(quotation.totalPrice).toBeCloseTo(expectedTotal, 2);
    expect(quotation.totalPrice).toBe(Math.round(quotation.totalPrice * 100) / 100);
    expect(quotation.depositAmount).toBe(Math.round((quotation.totalPrice * 33) / 100));
    expect(quotation.depositAmount + quotation.balanceAmount).toBeCloseTo(quotation.totalPrice, 2);
    expect(quotation.balanceAmount).toBeGreaterThan(0);
    expect(quotation.lineItems.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(quotation.totalPrice, 2);

    // Accept, pay and book: the booking carries the very same numbers
    await Quotation.updateOne({ _id: quotation._id }, { status: "accepted" });
    await PaymentAttempt.create({ quotation: quotation._id, customer: world.customer._id, transactionUuid: "u-1", amountNPR: quotation.depositAmount, status: "completed", transactionCode: "TC-MONEY-1" });
    const booking = await createBookingFromQuotation({ quotationId: String(quotation._id), transactionId: "TC-MONEY-1", amountNPR: quotation.depositAmount }, world.customer._id);
    expect(booking.totalPrice).toBe(quotation.totalPrice);
    expect(booking.depositAmount).toBe(quotation.depositAmount);
    expect(booking.balanceAmount).toBe(quotation.balanceAmount);
    expect(await Booking.countDocuments()).toBe(1);
  });

  it("refuses to quote more guests than the space holds, but takes exactly its capacity", async () => {
    const ask = (guests) => Inquiry.create({ customer: world.customer._id, venue: world.venue._id, preferredDate: nepalNoon(40), numberOfGuests: guests, eventType: "Party", contactName: "A B", phoneNumber: "9800000000" });
    const tooMany = await ask(101);
    await expect(createQuotation(tooMany._id, world.owner._id, payload({ numberOfGuests: 101 }), null)).rejects.toMatchObject({ statusCode: 400 });
    const exact = await ask(100);
    const q = await createQuotation(exact._id, world.owner._id, payload({ numberOfGuests: 100 }), null);
    expect(q.numberOfGuests).toBe(100);
  });

  it("is for exactly the guests the customer asked for: the venue cannot change the number", async () => {
    const inquiry = await Inquiry.create({ customer: world.customer._id, venue: world.venue._id, preferredDate: nepalNoon(40), numberOfGuests: 60, eventType: "Party", contactName: "A B", phoneNumber: "9800000000" });
    for (const guests of [59, 61, 1, 100]) {
      await expect(createQuotation(inquiry._id, world.owner._id, payload({ numberOfGuests: guests }), null)).rejects.toMatchObject({ statusCode: 400, message: "The customer asked for 60 guests. A quotation has to be for that number." });
    }
    const q = await createQuotation(inquiry._id, world.owner._id, payload({ numberOfGuests: 60 }), null);
    expect(q.numberOfGuests).toBe(60);
  });

  it.each([
    ["zero total", { lineItems: [{ label: "Free", unitPrice: 0 }] }],
    ["a deposit of 5%", { depositValue: 5 }],
    ["a deposit of 51%", { depositValue: 51 }],
    ["a NaN guest count", { numberOfGuests: NaN }],
    ["a fixed deposit above the total", { depositType: "fixed", depositValue: 10000000 }],
  ])("stores nothing for %s", async (_name, overrides) => {
    const inquiry = await Inquiry.create({ customer: world.customer._id, venue: world.venue._id, preferredDate: nepalNoon(40), numberOfGuests: 5, eventType: "Party", contactName: "A B", phoneNumber: "9800000000" });
    await expect(createQuotation(inquiry._id, world.owner._id, payload(overrides), null)).rejects.toMatchObject({ statusCode: 400 });
    expect(await Quotation.countDocuments({ inquiry: inquiry._id })).toBe(0);
    expect((await Inquiry.findById(inquiry._id)).status).toBe("pending");
  });
});
