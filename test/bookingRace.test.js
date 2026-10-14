const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const { createBookingFromQuotation } = require("../services/bookingService");
const PaymentAttempt = require("../model/paymentAttempt");

let mongod;
let venue;
let space;

const HOUR = 60 * 60 * 1000;
const slot = (startHoursFromNow, hours) => {
  const start = new Date(Date.now() + startHoursFromNow * HOUR);
  return { startTime: start, endTime: new Date(start.getTime() + hours * HOUR) };
};

const TOTAL_PRICE = 100000;
const DEPOSIT_AMOUNT = 20000; // 20%

// Creates an accepted Inquiry+Quotation for the given slot/customer, and a
// verified eSewa payment for its deposit. Returns the booking request.
const acceptedQuotationRequest = async (paymentId, customerId, { startTime, endTime }) => {
  const inquiry = await Inquiry.create({
    customer: customerId,
    venue: venue._id,
    space: space._id,
    preferredDate: startTime,
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
  });

  const quotation = await Quotation.create({
    inquiry: inquiry._id,
    venue: venue._id,
    space: space._id,
    owner: venue.owner,
    eventDate: startTime,
    shift: "day",
    startTime,
    endTime,
    numberOfGuests: 50,
    lineItems: [{ label: "Venue hire", quantity: 1, unitPrice: TOTAL_PRICE, perGuest: false, amount: TOTAL_PRICE }],
    totalPrice: TOTAL_PRICE,
    depositType: "fixed",
    depositValue: DEPOSIT_AMOUNT,
    depositAmount: DEPOSIT_AMOUNT,
    balanceAmount: TOTAL_PRICE - DEPOSIT_AMOUNT,
    validUntil: new Date(Date.now() + 7 * 24 * HOUR),
    status: "accepted",
  });

  // eSewa has already confirmed this payment; only the booking step is under test.
  await PaymentAttempt.create({
    quotation: quotation._id,
    customer: customerId,
    transactionUuid: `${paymentId}-uuid`,
    amountNPR: DEPOSIT_AMOUNT,
    status: "completed",
    transactionCode: paymentId,
  });

  return { quotationId: quotation._id.toString(), transactionId: paymentId, amountNPR: DEPOSIT_AMOUNT };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Booking.init();
  await Payment.init();

  venue = await Venue.create({
    owner: new mongoose.Types.ObjectId(),
    venueName: "Race Hall",
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
  });
  space = await Space.create({ venue: venue._id, name: "Main Hall", capacity: 200 });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Booking.deleteMany({});
  await Payment.deleteMany({});
  await Inquiry.deleteMany({});
  await Quotation.deleteMany({});
  await PaymentAttempt.deleteMany({});
});

describe("createBookingFromQuotation under concurrency", () => {
  it("lets at most one of many simultaneous requests take the same slot", async () => {
    const when = slot(48, 3);

    // Setup (10 independent accepted quotations for the same slot) happens
    // before the race — only createBookingFromQuotation itself is concurrent.
    const customers = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId());
    const requests = [];
    for (let i = 0; i < customers.length; i++) {
      requests.push(await acceptedQuotationRequest(`pi_same_${i}`, customers[i], when));
    }

    const results = await Promise.allSettled(
      requests.map((req, i) => createBookingFromQuotation(req, customers[i]))
    );
    const succeeded = results.filter((r) => r.status === "fulfilled");

    const active = await Booking.countDocuments({ space: space._id, status: { $in: ["confirmed", "completed"] } });
    expect(succeeded.length).toBeLessThanOrEqual(1);
    expect(active).toBe(succeeded.length);
    // Nobody is left holding a claim, and every loser is marked for a refund
    expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0);
    expect(await PaymentAttempt.countDocuments({ status: "refund_due" })).toBe(10 - succeeded.length);
    results
      .filter((r) => r.status === "rejected")
      .forEach((r) => expect(r.reason.statusCode).toBe(409));
  });

  it("books overlapping slots one at a time", async () => {
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    const start = slot(72, 4);
    const req1 = await acceptedQuotationRequest("pi_a", first, start);
    await createBookingFromQuotation(req1, first);

    const overlapWhen = slot(74, 4); // starts inside the first
    const req2 = await acceptedQuotationRequest("pi_b", second, overlapWhen);
    await expect(createBookingFromQuotation(req2, second)).rejects.toMatchObject({ statusCode: 409 });
    expect(await PaymentAttempt.countDocuments({ status: "refund_due" })).toBe(1);
  });

  it("allows back-to-back bookings that only touch at the boundary", async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const morning = slot(96, 2);
    const afternoon = { startTime: morning.endTime, endTime: new Date(morning.endTime.getTime() + 2 * HOUR) };

    const reqA = await acceptedQuotationRequest("pi_m", a, morning);
    await createBookingFromQuotation(reqA, a);

    const reqB = await acceptedQuotationRequest("pi_n", b, afternoon);
    await expect(createBookingFromQuotation(reqB, b)).resolves.toMatchObject({ status: "confirmed" });
    expect(await PaymentAttempt.countDocuments({ status: "refund_due" })).toBe(0);
  });

  it("frees a slot once its booking is cancelled", async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const when = slot(120, 2);
    const reqA = await acceptedQuotationRequest("pi_x", a, when);
    const booking = await createBookingFromQuotation(reqA, a);
    await Booking.updateOne({ _id: booking._id }, { status: "cancelled" });

    const reqB = await acceptedQuotationRequest("pi_y", b, when);
    await expect(createBookingFromQuotation(reqB, b)).resolves.toMatchObject({ status: "confirmed" });
  });
});
