const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Notification = require("../model/notification");
const { cancelBooking, notifyBookingConfirmed, getRefundPercentage, CANCELLATION_REFUND_TIERS } = require("../services/bookingService");

let mongod;
let venue;
let space;
let ownerId;

const DAY = 24 * 60 * 60 * 1000;
const DEPOSIT_AMOUNT = 20000;

// eSewa cannot be refunded through an API, so a cancellation records what Venure owes back.
const refundOwed = async (booking) => {
  const refund = await Payment.findOne({ booking: booking._id, type: "refund" });
  return refund ? -refund.amountNPR : 0;
};

const createConfirmedBooking = async (daysFromNow, customerId) => {
  const startTime = new Date(Date.now() + daysFromNow * DAY);
  const booking = await Booking.create({
    customer: customerId,
    venue: venue._id,
    space: space._id,
    eventDate: startTime,
    shift: "day",
    startTime,
    endTime: new Date(startTime.getTime() + 3 * 60 * 60 * 1000),
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
    totalPrice: 100000,
    depositAmount: DEPOSIT_AMOUNT,
    balanceAmount: 80000,
    cancellationPolicy: CANCELLATION_REFUND_TIERS,
    status: "confirmed",
  });

  await Payment.create({
    booking: booking._id,
    type: "deposit",
    provider: "esewa",
    transactionId: `TC${booking._id}`,
    amountReceived: DEPOSIT_AMOUNT,
    currency: "npr",
    amountNPR: DEPOSIT_AMOUNT,
    status: "succeeded",
  });

  return booking;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  ownerId = new mongoose.Types.ObjectId();
  venue = await Venue.create({
    owner: ownerId,
    venueName: "Refund Hall",
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
  });
  space = await Space.create({ venue: venue._id, name: "Hall", capacity: 100 });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Booking.deleteMany({});
  await Payment.deleteMany({});
  await Notification.deleteMany({});
});

describe("getRefundPercentage (pure)", () => {
  it("returns 100% at and above 30 days before the event", () => {
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 31)).toBe(100);
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 30)).toBe(100);
  });

  it("returns 75% between 15 and 29 days before", () => {
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 29)).toBe(75);
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 15)).toBe(75);
  });

  it("returns 50% between 7 and 14 days before", () => {
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 14)).toBe(50);
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 7)).toBe(50);
  });

  it("returns 0% under 7 days before", () => {
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 6)).toBe(0);
    expect(getRefundPercentage(CANCELLATION_REFUND_TIERS, 0)).toBe(0);
  });
});

describe("cancelBooking refund amounts", () => {
  it("refunds 100% of the deposit when a customer cancels 30+ days out", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(31, customerId);

    await cancelBooking(booking._id, { _id: customerId, role: "Customer" });

    expect(await refundOwed(booking)).toBe(DEPOSIT_AMOUNT);
  });

  it("refunds 75% when a customer cancels 15-29 days out", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(20, customerId);

    await cancelBooking(booking._id, { _id: customerId, role: "Customer" });

    expect(await refundOwed(booking)).toBe(Math.round(DEPOSIT_AMOUNT * 0.75));
  });

  it("refunds 50% when a customer cancels 7-14 days out", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(10, customerId);

    await cancelBooking(booking._id, { _id: customerId, role: "Customer" });

    expect(await refundOwed(booking)).toBe(Math.round(DEPOSIT_AMOUNT * 0.5));
  });

  it("refunds nothing when a customer cancels under 7 days out", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(3, customerId);

    const cancelled = await cancelBooking(booking._id, { _id: customerId, role: "Customer" });

    expect(cancelled.status).toBe("cancelled");
    expect(await refundOwed(booking)).toBe(0);
  });

  it("always refunds the deposit in full when the owner cancels, regardless of timing", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(2, customerId); // would be 0% for a customer

    await cancelBooking(booking._id, { _id: ownerId, role: "VenueOwner" });

    expect(await refundOwed(booking)).toBe(DEPOSIT_AMOUNT);
  });

  it("always refunds the deposit in full when an admin cancels, regardless of timing", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(2, customerId);
    const adminId = new mongoose.Types.ObjectId();

    await cancelBooking(booking._id, { _id: adminId, role: "Admin" });

    expect(await refundOwed(booking)).toBe(DEPOSIT_AMOUNT);
  });
});

describe("telling the other side", () => {
  it("notifies the venue owner when the customer cancels", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(40, customerId);

    await cancelBooking(booking._id, { _id: customerId, role: "Customer" });

    const notes = await Notification.find({ recipient: ownerId });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/Refund Hall.*cancelled by the customer/);
    expect(notes[0].link).toBe("/owner/bookings");
    expect(await Notification.countDocuments({ recipient: customerId })).toBe(0);
  });

  it("notifies the customer, and promises the full deposit back, when the owner cancels", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(2, customerId);

    await cancelBooking(booking._id, { _id: ownerId, role: "VenueOwner" });

    const notes = await Notification.find({ recipient: customerId });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/cancelled by the venue.*full deposit/);
    expect(notes[0].link).toBe("/my-bookings");
    expect(await Notification.countDocuments({ recipient: ownerId })).toBe(0);
  });

  it("notifies both sides when a deposit is paid and the date is confirmed", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const booking = await createConfirmedBooking(40, customerId);

    await notifyBookingConfirmed(booking, null);

    const owner = await Notification.findOne({ recipient: ownerId });
    expect(owner.message).toMatch(/A deposit was paid and "Refund Hall" is booked for/);
    const customer = await Notification.findOne({ recipient: customerId });
    expect(customer.message).toMatch(/Your date at "Refund Hall" on .* is confirmed/);
  });
});
