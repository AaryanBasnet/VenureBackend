// Shared set-up for the calendar and booking suites: an in-memory MongoDB, one approved venue with two halls,
// a second venue, an owner and as many customers as a test needs, plus builders for accepted quotations
// and their (already verified) eSewa payments.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../../model/user");
const Venue = require("../../model/venue");
const Space = require("../../model/space");
const Inquiry = require("../../model/inquiry");
const Quotation = require("../../model/quotation");
const Booking = require("../../model/booking");
const Payment = require("../../model/payment");
const PaymentAttempt = require("../../model/paymentAttempt");
const Notification = require("../../model/notification");
const { resolveShiftTimes } = require("../../services/shiftService");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };

// Noon in Kathmandu on the Kathmandu day that is n days from now: how the date picker sends a date
const nepalNoon = (daysFromNow, now = Date.now()) => {
  const shifted = new Date(now + NEPAL_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + daysFromNow, 6, 15));
};

let mongod;
const world = { customers: [] };

const start = async ({ customers = 3 } = {}) => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Booking.init();
  await Payment.init();
  await PaymentAttempt.init();

  world.owner = await User.create({ name: "Owner", email: "owner@world.test", password: "hashedpassword", role: "VenueOwner" });
  world.otherOwner = await User.create({ name: "Other Owner", email: "owner2@world.test", password: "hashedpassword", role: "VenueOwner" });
  world.admin = await User.create({ name: "Admin", email: "admin@world.test", password: "hashedpassword", role: "Admin" });
  world.customers = [];
  for (let i = 0; i < customers; i++) {
    world.customers.push(await User.create({ name: `Customer ${i}`, email: `c${i}@world.test`, password: "hashedpassword", role: "Customer" }));
  }
  world.customer = world.customers[0];

  world.venue = await Venue.create({ owner: world.owner._id, venueName: "World Hall", location, status: "approved" });
  world.space = await Space.create({ venue: world.venue._id, name: "Main Hall", capacity: 100 });
  world.space2 = await Space.create({ venue: world.venue._id, name: "Lawn", capacity: 300 });
  world.otherVenue = await Venue.create({ owner: world.otherOwner._id, venueName: "Other Hall", location, status: "approved" });
  world.otherSpace = await Space.create({ venue: world.otherVenue._id, name: "Other Main", capacity: 100 });
  return world;
};

const stop = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
};

const reset = async () => {
  await Promise.all([Booking, Payment, Inquiry, Quotation, PaymentAttempt, Notification].map((m) => m.deleteMany({})));
  await Space.updateMany({}, { shiftOverrides: [] });
  for (const space of [world.space, world.space2, world.otherSpace]) if (space) space.shiftOverrides = [];
};

let counter = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

// An inquiry + accepted quotation + completed eSewa attempt, ready for createBookingFromQuotation.
// Pass `slot` ({startTime,endTime}) for arbitrary instants, or {daysFromNow, shift} for a real shift.
const acceptedQuotation = async ({
  customer = world.customer,
  space = world.space,
  daysFromNow = 30,
  shift = "day",
  slot = null,
  eventDate: givenDate = null,
  total = 100000,
  deposit = 20000,
  status = "accepted",
  validUntil = new Date(Date.now() + 7 * DAY),
  guests = 50,
  venue = world.venue,
} = {}) => {
  const eventDate = givenDate || (slot ? slot.startTime : nepalNoon(daysFromNow));
  const times = slot || resolveShiftTimes(eventDate, shift, space);
  const inquiry = await Inquiry.create({
    customer: customer._id,
    venue: venue._id,
    space: space._id,
    preferredDate: eventDate,
    numberOfGuests: guests,
    eventType: "Wedding",
    contactName: "Test Customer",
    phoneNumber: "9800000000",
    status: "accepted",
  });
  const quotation = await Quotation.create({
    inquiry: inquiry._id,
    venue: venue._id,
    space: space._id,
    owner: venue.owner,
    eventDate,
    shift,
    startTime: times.startTime,
    endTime: times.endTime,
    numberOfGuests: guests,
    lineItems: [{ label: "Venue hire", quantity: 1, unitPrice: total, perGuest: false, amount: total }],
    totalPrice: total,
    depositType: "fixed",
    depositValue: deposit,
    depositAmount: deposit,
    balanceAmount: total - deposit,
    validUntil,
    status,
  });
  await Inquiry.updateOne({ _id: inquiry._id }, { currentQuotation: quotation._id });
  const transactionId = nextId("TX");
  const attempt = await PaymentAttempt.create({
    quotation: quotation._id,
    customer: customer._id,
    transactionUuid: `${transactionId}-uuid`,
    amountNPR: deposit,
    status: "completed",
    transactionCode: transactionId,
  });
  return {
    inquiry,
    quotation,
    attempt,
    customer,
    request: { quotationId: quotation._id.toString(), transactionId, amountNPR: deposit },
  };
};

// Freezes only the clock (Date): timers, the MongoDB driver and promises keep running normally.
const FAKEABLE = ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"];
const freezeTime = (when) => jest.useFakeTimers({ now: new Date(when), doNotFake: FAKEABLE });
const unfreezeTime = () => jest.useRealTimers();

module.exports = { freezeTime, unfreezeTime, world, start, stop, reset, acceptedQuotation, nepalNoon, HOUR, DAY, NEPAL_OFFSET_MS, location, nextId };
