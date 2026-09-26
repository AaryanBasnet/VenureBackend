const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Stripe is faked: every PaymentIntent id resolves to a succeeded intent that
// matches the customer/venue/slot registered for it below.
const mockIntents = new Map();
const mockRefunds = jest.fn().mockResolvedValue({});
jest.mock("../utils/stripe", () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: async (id) => mockIntents.get(id) },
    refunds: { create: (args) => mockRefunds(args) },
  }),
}));

const Booking = require("../model/booking");
const Venue = require("../model/venue");
const { createBooking } = require("../services/bookingService");
const { quoteBooking, nprToUsdCents } = require("../services/pricingService");

let mongod;
let venue;

const HOUR = 60 * 60 * 1000;
const slot = (startHoursFromNow, hours) => {
  const start = new Date(Date.now() + startHoursFromNow * HOUR);
  return { startTime: start.toISOString(), endTime: new Date(start.getTime() + hours * HOUR).toISOString() };
};

// Builds a paid PaymentIntent for a customer and returns the booking request
const paidRequest = (paymentId, customerId, when) => {
  const quote = quoteBooking({ venue, ...when, numberOfGuests: 50, addons: [] });
  mockIntents.set(paymentId, {
    id: paymentId,
    status: "succeeded",
    currency: "usd",
    amount_received: nprToUsdCents(quote.totalPrice),
    metadata: {
      userId: customerId.toString(),
      venueId: venue._id.toString(),
      startTime: quote.start.toISOString(),
      endTime: quote.end.toISOString(),
    },
  });
  return {
    venue: venue._id.toString(),
    ...when,
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
    paymentIntentId: paymentId,
  };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Booking.init();
  venue = await Venue.create({
    owner: new mongoose.Types.ObjectId(),
    venueName: "Race Hall",
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    capacity: 200,
    pricePerHour: 1000,
    status: "approved",
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Booking.deleteMany({});
  mockIntents.clear();
  mockRefunds.mockClear();
});

describe("createBooking under concurrency", () => {
  it("lets at most one of many simultaneous requests take the same slot", async () => {
    const when = slot(48, 3);
    const attempts = Array.from({ length: 10 }, (_, i) => {
      const customer = new mongoose.Types.ObjectId();
      return createBooking(paidRequest(`pi_same_${i}`, customer, when), customer);
    });

    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled");

    const active = await Booking.countDocuments({ venue: venue._id, status: { $in: ["booked", "approved"] } });
    expect(succeeded.length).toBeLessThanOrEqual(1);
    expect(active).toBe(succeeded.length);
    // Nobody is left holding a claim, and every loser gets their money back
    expect(await Booking.countDocuments({ status: "pending_payment" })).toBe(0);
    expect(mockRefunds).toHaveBeenCalledTimes(10 - succeeded.length);
    results
      .filter((r) => r.status === "rejected")
      .forEach((r) => expect(r.reason.statusCode).toBe(409));
  });

  it("books overlapping slots one at a time", async () => {
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    const start = slot(72, 4);
    await createBooking(paidRequest("pi_a", first, start), first);

    const overlapping = paidRequest("pi_b", second, slot(74, 4)); // starts inside the first
    await expect(createBooking(overlapping, second)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRefunds).toHaveBeenCalledTimes(1);
  });

  it("allows back-to-back bookings that only touch at the boundary", async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const morning = slot(96, 2);
    const afternoon = { startTime: morning.endTime, endTime: new Date(new Date(morning.endTime).getTime() + 2 * HOUR).toISOString() };

    await createBooking(paidRequest("pi_m", a, morning), a);
    await expect(createBooking(paidRequest("pi_n", b, afternoon), b)).resolves.toMatchObject({ status: "booked" });
    expect(mockRefunds).not.toHaveBeenCalled();
  });

  it("frees a slot once its booking is cancelled", async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const when = slot(120, 2);
    const booking = await createBooking(paidRequest("pi_x", a, when), a);
    await Booking.updateOne({ _id: booking._id }, { status: "cancelled" });

    await expect(createBooking(paidRequest("pi_y", b, when), b)).resolves.toMatchObject({ status: "booked" });
  });
});
