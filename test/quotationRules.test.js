// Inquiry and quotation rules: which dates are allowed, who may do what, and what happens at the edges
// (expiry to the millisecond, taken slots, capacity, superseding, simultaneous accepts).
const mongoose = require("mongoose");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const Booking = require("../model/booking");
const Space = require("../model/space");
const inquiryService = require("../services/inquiryService");
const quotationService = require("../services/quotationService");
const paymentService = require("../services/paymentService");
const bookingService = require("../services/bookingService");
const { world, start, stop, reset, acceptedQuotation, nepalNoon, freezeTime, unfreezeTime, DAY, HOUR } = require("./helpers/bookingWorld");

beforeAll(() => start({ customers: 3 }), 120000);
afterAll(() => stop());
beforeEach(() => reset());
afterEach(() => unfreezeTime());

const inquiryPayload = (overrides = {}) => ({
  venue: world.venue._id,
  space: world.space._id,
  numberOfGuests: 50,
  eventType: "Wedding",
  preferredDate: nepalNoon(30),
  contactName: "Jane Customer",
  phoneNumber: "9800000000",
  ...overrides,
});
const quotationPayload = (overrides = {}) => ({
  space: world.space._id,
  eventDate: nepalNoon(30),
  shift: "day",
  numberOfGuests: 50,
  lineItems: [{ label: "Venue hire", unitPrice: 100000, quantity: 1 }],
  depositType: "percentage",
  depositValue: 20,
  ...overrides,
});
const newInquiry = (overrides = {}, customer = world.customer) => inquiryService.createInquiry(inquiryPayload(overrides), customer._id, null);
const quote = async (inquiry, overrides = {}) => quotationService.createQuotation(inquiry._id, world.owner._id, quotationPayload(overrides), null);
const status = (fn) => fn().then(() => 200, (e) => e.statusCode);

describe("inquiry dates", () => {
  it.each([
    ["last year", () => nepalNoon(-365), 400],
    ["yesterday", () => nepalNoon(-1), 400],
    ["today at noon", () => nepalNoon(0), 400],
    ["tomorrow", () => nepalNoon(1), 201],
    ["next week", () => nepalNoon(7), 201],
    ["a year ahead", () => nepalNoon(365), 201],
    ["far beyond 24 months", () => nepalNoon(900), 400],
  ])("%s", async (_name, date, expected) => {
    const got = await status(async () => {
      await newInquiry({ preferredDate: date() });
    });
    expect(got === 200 ? 201 : got).toBe(expected);
  });

  it("turns 'tomorrow' over at midnight in Kathmandu (18:15 UTC), not at the server's midnight", async () => {
    const preferred = new Date("2026-10-16T06:15:00Z");
    freezeTime("2026-10-15T18:14:59Z"); // 23:59:59 on the 15th in Kathmandu: the 16th is tomorrow
    await expect(newInquiry({ preferredDate: preferred })).resolves.toBeTruthy();
    freezeTime("2026-10-15T18:15:00Z"); // 00:00 on the 16th: it is now today
    await expect(newInquiry({ preferredDate: preferred })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("takes exactly the guest capacity of the chosen space, and one more is refused", async () => {
    await expect(newInquiry({ numberOfGuests: 100 })).resolves.toBeTruthy();
    await expect(newInquiry({ numberOfGuests: 101 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a space of another venue, an unknown venue and an unapproved venue", async () => {
    await expect(newInquiry({ space: world.otherSpace._id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(newInquiry({ venue: new mongoose.Types.ObjectId() })).rejects.toMatchObject({ statusCode: 404 });
    await world.venue.constructor.updateOne({ _id: world.venue._id }, { status: "pending" });
    await expect(newInquiry()).rejects.toMatchObject({ statusCode: 404 });
    await world.venue.constructor.updateOne({ _id: world.venue._id }, { status: "approved" });
  });
});

describe("quotation dates and slots", () => {
  it("quotes tomorrow and refuses the past", async () => {
    const inquiry = await newInquiry();
    await expect(quote(inquiry, { eventDate: nepalNoon(1) })).resolves.toMatchObject({ status: "sent" });
    await expect(quote(inquiry, { eventDate: nepalNoon(-1) })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a shift that has already started today but allows one that has not", async () => {
    const inquiry = await newInquiry();
    freezeTime("2026-10-15T05:00:00Z"); // 10:45 in Kathmandu: the day shift began at 10:00, the night shift has not
    await expect(quote(inquiry, { eventDate: new Date("2026-10-15T06:15:00Z"), shift: "day" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(quote(inquiry, { eventDate: new Date("2026-10-15T06:15:00Z"), shift: "night" })).resolves.toBeTruthy();
  });

  it("refuses a shift that starts at exactly this instant", async () => {
    const inquiry = await newInquiry();
    freezeTime("2026-10-15T04:15:00Z"); // 10:00 in Kathmandu
    await expect(quote(inquiry, { eventDate: new Date("2026-10-15T06:15:00Z"), shift: "day" })).rejects.toMatchObject({ statusCode: 400 });
    freezeTime("2026-10-15T04:14:59Z");
    await expect(quote(inquiry, { eventDate: new Date("2026-10-15T06:15:00Z"), shift: "day" })).resolves.toBeTruthy();
  });

  it("refuses dates beyond the 24 month horizon and invalid ones", async () => {
    const inquiry = await newInquiry();
    await expect(quote(inquiry, { eventDate: nepalNoon(1000) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(quote(inquiry, { eventDate: "nonsense" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("answers 409 for a slot that is already booked, and for any shift that overlaps it", async () => {
    const taken = await acceptedQuotation({ daysFromNow: 30, shift: "day" });
    await bookingService.createBookingFromQuotation(taken.request, taken.customer._id);
    const inquiry = await newInquiry({}, world.customers[1]);
    await expect(quote(inquiry, { shift: "day" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(quote(inquiry, { shift: "full_day" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(quote(inquiry, { shift: "night" })).resolves.toBeTruthy(); // 17:00 starts after 15:00 ends
    await expect(quote(inquiry, { shift: "day", space: world.space2._id })).resolves.toBeTruthy(); // another hall
  });

  it("does not let an expired claim block a quotation", async () => {
    const t = await acceptedQuotation({ daysFromNow: 30, shift: "day" });
    await Booking.collection.insertOne({
      _id: new mongoose.Types.ObjectId(),
      customer: world.customer._id,
      venue: world.venue._id,
      space: world.space._id,
      startTime: t.quotation.startTime,
      endTime: t.quotation.endTime,
      numberOfGuests: 1,
      eventType: "x",
      contactName: "x",
      phoneNumber: "9800000000",
      totalPrice: 1,
      depositAmount: 1,
      balanceAmount: 0,
      status: "pending_deposit",
      holdClaimExpiresAt: new Date(Date.now() - 5000),
    });
    const inquiry = await newInquiry({}, world.customers[1]);
    await expect(quote(inquiry, { shift: "day" })).resolves.toBeTruthy();
  });

  it("refuses spaces of another venue, inactive spaces and too many guests, and takes exactly the capacity", async () => {
    const inquiry = await newInquiry();
    await expect(quote(inquiry, { space: world.otherSpace._id })).rejects.toMatchObject({ statusCode: 404 });
    const closed = await Space.create({ venue: world.venue._id, name: "Closed", capacity: 50, isActive: false });
    await expect(quote(inquiry, { space: closed._id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(quote(inquiry, { numberOfGuests: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(quote(inquiry, { numberOfGuests: 1.5 })).rejects.toMatchObject({ statusCode: 400 });
    // the number is the customer's (see moneyMath.test.js): a request for more than the hall holds, and one for exactly its capacity
    // (asked for without choosing a hall, since choosing one already refuses more guests than it holds)
    await expect(quote(await newInquiry({ numberOfGuests: 101, space: undefined }), { numberOfGuests: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(quote(await newInquiry({ numberOfGuests: 100 }), { numberOfGuests: 100 })).resolves.toBeTruthy();
  });

  it("only the venue's own owner can quote", async () => {
    const inquiry = await newInquiry();
    await expect(quotationService.createQuotation(inquiry._id, world.otherOwner._id, quotationPayload(), null)).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotationService.createQuotation(inquiry._id, world.customer._id, quotationPayload(), null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("a declined or cancelled inquiry cannot be quoted", async () => {
    const inquiry = await newInquiry();
    await inquiryService.declineInquiry(inquiry._id, world.owner._id, null);
    await expect(quote(inquiry)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("superseding", () => {
  it("a new quotation supersedes the open one and the inquiry points at the new one", async () => {
    const inquiry = await newInquiry();
    const first = await quote(inquiry);
    const second = await quote(inquiry, { depositValue: 30 });
    expect((await Quotation.findById(first._id)).status).toBe("superseded");
    expect((await Quotation.findById(second._id)).status).toBe("sent");
    expect(String((await Inquiry.findById(inquiry._id)).currentQuotation)).toBe(String(second._id));
    await expect(quotationService.acceptQuotation(first._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("leaves exactly one open quotation when the owner sends several at once", async () => {
    const inquiry = await newInquiry();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => quote(inquiry, { depositValue: 20 + i })));
    const open = await Quotation.find({ inquiry: inquiry._id, status: "sent" });
    expect(open).toHaveLength(1);
    const fresh = await Inquiry.findById(inquiry._id);
    expect(String(fresh.currentQuotation)).toBe(String(open[0]._id));
    expect(fresh.status).toBe("quoted");
    // the newest (highest id) is the survivor; every loser was told so
    const ids = (await Quotation.find({ inquiry: inquiry._id })).map((q) => String(q._id)).sort();
    expect(String(open[0]._id)).toBe(ids[ids.length - 1]);
    results.filter((r) => r.status === "rejected").forEach((r) => expect(r.reason.statusCode).toBe(409));
  });

  it("does not drag an inquiry back to 'quoted' after the customer accepted", async () => {
    const inquiry = await newInquiry();
    const first = await quote(inquiry);
    await quotationService.acceptQuotation(first._id, world.customer._id);
    await expect(quote(inquiry)).rejects.toMatchObject({ statusCode: 400 });
    expect((await Inquiry.findById(inquiry._id)).status).toBe("accepted");
  });
});

describe("expiry", () => {
  const sentQuotation = async () => {
    const inquiry = await newInquiry();
    return { inquiry, quotation: await quote(inquiry) };
  };

  it("is valid for exactly seven days", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { quotation } = await sentQuotation();
    expect(quotation.validUntil.toISOString()).toBe("2026-10-22T06:00:00.000Z");
    expect(quotationService.QUOTATION_VALIDITY_DAYS).toBe(7);
  });

  it("can be accepted one millisecond before validUntil", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { quotation } = await sentQuotation();
    freezeTime(quotation.validUntil.getTime() - 1);
    await expect(quotationService.acceptQuotation(quotation._id, world.customer._id)).resolves.toMatchObject({ status: "accepted" });
  });

  it("is expired when validUntil is reached (not one tick later)", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { inquiry, quotation } = await sentQuotation();
    freezeTime(quotation.validUntil.getTime());
    await expect(quotationService.acceptQuotation(quotation._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400, message: /expired/ });
    expect((await Quotation.findById(quotation._id)).status).toBe("expired");
    const fresh = await Inquiry.findById(inquiry._id);
    expect(fresh.status).toBe("pending");
    expect(fresh.currentQuotation).toBeNull();
  });

  it("stays expired for any later accept, reject or withdraw", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { quotation } = await sentQuotation();
    freezeTime(quotation.validUntil.getTime() + 3 * DAY);
    await expect(quotationService.acceptQuotation(quotation._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(quotationService.acceptQuotation(quotation._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(quotationService.rejectQuotation(quotation._id, world.customer._id, null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(quotationService.withdrawQuotation(quotation._id, world.owner._id, null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reading an expired quotation shows it as expired", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { quotation } = await sentQuotation();
    freezeTime(quotation.validUntil.getTime() + 1);
    const read = await quotationService.getQuotationById(quotation._id, world.customer);
    expect(read.status).toBe("expired");
  });

  it("an accepted quotation does not expire (the customer committed in time)", async () => {
    freezeTime("2026-10-15T06:00:00Z");
    const { quotation } = await sentQuotation();
    await quotationService.acceptQuotation(quotation._id, world.customer._id);
    freezeTime(quotation.validUntil.getTime() + 30 * DAY);
    await expect(quotationService.acceptQuotation(quotation._id, world.customer._id)).resolves.toMatchObject({ status: "accepted" });
  });
});

describe("accepting", () => {
  const sent = async (overrides = {}, customer = world.customer) => {
    const inquiry = await newInquiry({}, customer);
    return quote(inquiry, overrides);
  };

  it("accepts once and again idempotently", async () => {
    const q = await sent();
    const first = await quotationService.acceptQuotation(q._id, world.customer._id);
    const second = await quotationService.acceptQuotation(q._id, world.customer._id);
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    expect(await Quotation.countDocuments({ status: "accepted" })).toBe(1);
    expect((await Inquiry.findById(q.inquiry)).status).toBe("accepted");
  });

  it("only the customer of the inquiry can accept or reject", async () => {
    const q = await sent();
    await expect(quotationService.acceptQuotation(q._id, world.customers[1]._id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(quotationService.acceptQuotation(q._id, world.owner._id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(quotationService.rejectQuotation(q._id, world.customers[1]._id, null)).rejects.toMatchObject({ statusCode: 404 });
    expect((await Quotation.findById(q._id)).status).toBe("sent");
  });

  it("refuses rejected, withdrawn and superseded quotations", async () => {
    const rejected = await sent();
    await quotationService.rejectQuotation(rejected._id, world.customer._id, null);
    await expect(quotationService.acceptQuotation(rejected._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });

    const withdrawn = await sent();
    await quotationService.withdrawQuotation(withdrawn._id, world.owner._id, null);
    await expect(quotationService.acceptQuotation(withdrawn._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses with 409 when someone booked the slot first, and leaves the quotation open", async () => {
    const mine = await sent();
    const other = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await bookingService.createBookingFromQuotation(other.request, world.customers[1]._id);
    await expect(quotationService.acceptQuotation(mine._id, world.customer._id)).rejects.toMatchObject({ statusCode: 409 });
    expect((await Quotation.findById(mine._id)).status).toBe("sent");
  });

  it("refuses when the event date has passed", async () => {
    const q = await sent({ eventDate: nepalNoon(2) });
    freezeTime(q.startTime.getTime() + HOUR);
    // not yet expired (7 days), but the shift is over
    await expect(quotationService.acceptQuotation(q._id, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("twenty simultaneous accepts all see an accepted quotation and change it once", async () => {
    const q = await sent();
    const results = await Promise.all(Array.from({ length: 20 }, () => quotationService.acceptQuotation(q._id, world.customer._id)));
    expect(results.every((r) => r.status === "accepted")).toBe(true);
    expect((await Quotation.findById(q._id)).status).toBe("accepted");
    expect((await Inquiry.findById(q.inquiry)).status).toBe("accepted");
  });

  it("an accept racing a withdrawal ends in one consistent state (repeated)", async () => {
    for (let round = 0; round < 15; round++) {
      const q = await sent();
      const [accept, withdraw] = await Promise.allSettled([
        quotationService.acceptQuotation(q._id, world.customer._id),
        quotationService.withdrawQuotation(q._id, world.owner._id, null),
      ]);
      const final = (await Quotation.findById(q._id)).status;
      expect(["accepted", "withdrawn"]).toContain(final);
      // whoever was told "yes" is what is stored
      expect(accept.status === "fulfilled").toBe(final === "accepted");
      expect(withdraw.status === "fulfilled").toBe(final === "withdrawn");
      const inquiry = await Inquiry.findById(q.inquiry);
      expect(inquiry.status).toBe(final === "accepted" ? "accepted" : "declined");
    }
  });

  it("an accept racing a new quotation from the owner ends consistently (repeated)", async () => {
    for (let round = 0; round < 15; round++) {
      const inquiry = await newInquiry();
      const first = await quote(inquiry);
      const [accept, next] = await Promise.allSettled([
        quotationService.acceptQuotation(first._id, world.customer._id),
        quote(inquiry, { depositValue: 25 }),
      ]);
      const stored = await Quotation.find({ inquiry: inquiry._id });
      const acceptedOnes = stored.filter((q) => q.status === "accepted");
      const openOnes = stored.filter((q) => q.status === "sent");
      // never two live quotations, never an accepted one that was reported as superseded
      expect(acceptedOnes.length + openOnes.length).toBeLessThanOrEqual(1);
      expect((await Quotation.findById(first._id)).status === "accepted").toBe(accept.status === "fulfilled");
      const fresh = await Inquiry.findById(inquiry._id);
      if (acceptedOnes.length) expect(fresh.status).toBe("accepted");
    }
  });
});

describe("paying the deposit", () => {
  it("requires an accepted quotation, the right customer and a future date", async () => {
    const inquiry = await newInquiry();
    const q = await quote(inquiry);
    await expect(paymentService.initiateDeposit({ quotationId: q._id }, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    await quotationService.acceptQuotation(q._id, world.customer._id);
    await expect(paymentService.initiateDeposit({ quotationId: q._id }, world.customers[1]._id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(paymentService.initiateDeposit({ quotationId: new mongoose.Types.ObjectId() }, world.customer._id)).rejects.toMatchObject({ statusCode: 404 });
    const form = await paymentService.initiateDeposit({ quotationId: q._id }, world.customer._id);
    expect(form.amount).toBe(20000);
    expect(form.formData.total_amount).toBe(20000);
    freezeTime(q.startTime.getTime() + 1);
    await expect(paymentService.initiateDeposit({ quotationId: q._id }, world.customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses with 409 once the slot is booked by someone else, or by this very quotation", async () => {
    const inquiry = await newInquiry();
    const q = await quote(inquiry);
    await quotationService.acceptQuotation(q._id, world.customer._id);

    const rival = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await bookingService.createBookingFromQuotation(rival.request, world.customers[1]._id);
    await expect(paymentService.initiateDeposit({ quotationId: q._id }, world.customer._id)).rejects.toMatchObject({ statusCode: 409 });

    await Booking.updateMany({}, { status: "cancelled" });
    const own = await acceptedQuotation({ daysFromNow: 33, shift: "night" });
    await bookingService.createBookingFromQuotation(own.request, own.customer._id);
    await expect(paymentService.initiateDeposit({ quotationId: own.quotation._id }, world.customer._id)).rejects.toMatchObject({ statusCode: 409, message: /already been booked/ });
  });
});
