const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { callbackFor, mockStatusApi } = require("./helpers/esewa");

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const Booking = require("../model/booking");
const Payment = require("../model/payment");

const inquiryService = require("../services/inquiryService");
const quotationService = require("../services/quotationService");
const paymentService = require("../services/paymentService");
const bookingService = require("../services/bookingService");

let mongod;
let venue;
let space;
let owner;
let customer;

const DAY = 24 * 60 * 60 * 1000;
const futureDate = (daysFromNow) => new Date(Date.now() + daysFromNow * DAY);

const inquiryPayload = (overrides = {}) => ({
  venue: venue._id,
  numberOfGuests: 50,
  eventType: "Wedding",
  preferredDate: futureDate(30),
  contactName: "Jane Customer",
  phoneNumber: "9800000000",
  ...overrides,
});

const quotationPayload = (overrides = {}) => ({
  space: space._id,
  eventDate: futureDate(30),
  shift: "day",
  numberOfGuests: 50,
  lineItems: [{ label: "Venue hire", unitPrice: 100000, quantity: 1 }],
  depositType: "percentage",
  depositValue: 20,
  ...overrides,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Payment.init();

  owner = await User.create({ name: "Owner", email: "owner@flow.test", password: "hashedpassword", role: "VenueOwner" });
  customer = await User.create({ name: "Customer", email: "customer@flow.test", password: "hashedpassword", role: "Customer" });

  venue = await Venue.create({
    owner: owner._id,
    venueName: "Flow Hall",
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
  });
  space = await Space.create({ venue: venue._id, name: "Main Hall", capacity: 100 });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await Inquiry.deleteMany({});
  await Quotation.deleteMany({});
  await Booking.deleteMany({});
  await Payment.deleteMany({});
  mockStatusApi();
});

describe("Inquiry -> Quotation -> Deposit -> Booking", () => {
  it("runs the full happy path end to end", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    expect(inquiry.status).toBe("pending");

    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    expect(quotation.status).toBe("sent");
    expect(quotation.totalPrice).toBe(100000);
    expect(quotation.depositAmount).toBe(20000);
    expect(quotation.balanceAmount).toBe(80000);

    expect((await Inquiry.findById(inquiry._id)).status).toBe("quoted");

    const accepted = await quotationService.acceptQuotation(quotation._id, customer._id);
    expect(accepted.status).toBe("accepted");
    expect((await Inquiry.findById(inquiry._id)).status).toBe("accepted");

    const payment = await paymentService.initiateDeposit({ quotationId: quotation._id }, customer._id);
    expect(payment.formData.signature).toBeDefined();
    expect(payment.amount).toBe(20000);

    // eSewa sends the customer back; the server verifies the payment and books
    const verified = await paymentService.verifyEsewaDeposit(callbackFor(payment.formData), customer._id);
    const booking = await bookingService.createBookingFromQuotation(
      { quotationId: verified.quotationId, transactionId: verified.transactionId, amountNPR: verified.amountNPR },
      customer._id
    );
    expect(booking.status).toBe("confirmed");
    expect(booking.depositAmount).toBe(20000);
    expect(booking.balanceAmount).toBe(80000);
    expect(booking.space.toString()).toBe(space._id.toString());

    expect((await Inquiry.findById(inquiry._id)).booking.toString()).toBe(booking._id.toString());

    const paymentDoc = await Payment.findOne({ booking: booking._id });
    expect(paymentDoc.type).toBe("deposit");
    expect(paymentDoc.transactionId).toBe(verified.transactionId);
    expect(paymentDoc.provider).toBe("esewa");
  });

  it("lets the customer reject a quotation, returning the inquiry to pending", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);

    const rejected = await quotationService.rejectQuotation(quotation._id, customer._id, null);
    expect(rejected.status).toBe("rejected");

    const updatedInquiry = await Inquiry.findById(inquiry._id);
    expect(updatedInquiry.status).toBe("pending");
    expect(updatedInquiry.currentQuotation).toBeNull();
  });

  it("lets the owner withdraw a sent quotation, declining the inquiry", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);

    const withdrawn = await quotationService.withdrawQuotation(quotation._id, owner._id, null);
    expect(withdrawn.status).toBe("withdrawn");
    expect((await Inquiry.findById(inquiry._id)).status).toBe("declined");
  });

  it("lets the owner decline an inquiry directly, before quoting", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const declined = await inquiryService.declineInquiry(inquiry._id, owner._id, null);
    expect(declined.status).toBe("declined");
  });

  it("lets the customer cancel their own inquiry", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const cancelled = await inquiryService.cancelInquiry(inquiry._id, customer._id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("supersedes the previous quotation when the owner sends a revised one", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const first = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    const second = await quotationService.createQuotation(
      inquiry._id,
      owner._id,
      quotationPayload({ lineItems: [{ label: "Venue hire", unitPrice: 120000, quantity: 1 }] }),
      null
    );

    expect((await Quotation.findById(first._id)).status).toBe("superseded");
    expect((await Inquiry.findById(inquiry._id)).currentQuotation.toString()).toBe(second._id.toString());
  });

  it("expires a stale quotation lazily when accepted after validUntil has passed", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    await Quotation.findByIdAndUpdate(quotation._id, { validUntil: new Date(Date.now() - 1000) });

    await expect(quotationService.acceptQuotation(quotation._id, customer._id)).rejects.toMatchObject({
      statusCode: 400,
    });

    expect((await Quotation.findById(quotation._id)).status).toBe("expired");
    expect((await Inquiry.findById(inquiry._id)).status).toBe("pending");
  });

  describe("a slot somebody else has already booked", () => {
    const bookSlot = async (otherCustomer) => {
      const inquiry = await inquiryService.createInquiry(inquiryPayload(), otherCustomer._id, null);
      const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
      await quotationService.acceptQuotation(quotation._id, otherCustomer._id);
      return bookingService.createBookingFromQuotation(
        { quotationId: quotation._id, transactionId: `TX-${Date.now()}-${require("crypto").randomUUID()}`, amountNPR: quotation.depositAmount },
        otherCustomer._id
      );
    };

    it("is not quoted to a second customer", async () => {
      const other = await User.create({ name: "Other", email: `other-${Date.now()}@flow.test`, password: "hashedpassword", role: "Customer" });
      await bookSlot(other);

      const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
      await expect(
        quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null)
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await Inquiry.findById(inquiry._id)).status).toBe("pending");
    });

    it("cannot be accepted: the quotation stays sent instead of becoming accepted and unpayable", async () => {
      const other = await User.create({ name: "Other 2", email: `other2-${Date.now()}@flow.test`, password: "hashedpassword", role: "Customer" });
      const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
      const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);

      await bookSlot(other); // somebody else pays first

      await expect(quotationService.acceptQuotation(quotation._id, customer._id)).rejects.toMatchObject({ statusCode: 409 });
      expect((await Quotation.findById(quotation._id)).status).toBe("sent");
      expect((await Inquiry.findById(inquiry._id)).status).toBe("quoted");
    });

    it("is free to quote and accept again once the booking is cancelled", async () => {
      const other = await User.create({ name: "Other 3", email: `other3-${Date.now()}@flow.test`, password: "hashedpassword", role: "Customer" });
      const booking = await bookSlot(other);
      await bookingService.cancelBooking(booking._id, { _id: other._id, role: "Customer" });

      const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
      const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
      const accepted = await quotationService.acceptQuotation(quotation._id, customer._id);
      expect(accepted.status).toBe("accepted");
    });
  });

  it("rejects a deposit percentage outside the platform-allowed range", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);

    await expect(
      quotationService.createQuotation(inquiry._id, owner._id, quotationPayload({ depositValue: 90 }), null)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a guest count over the chosen space's capacity", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);

    await expect(
      quotationService.createQuotation(inquiry._id, owner._id, quotationPayload({ numberOfGuests: 500 }), null)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses to book a quotation that was never accepted", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);

    await expect(
      bookingService.createBookingFromQuotation({ quotationId: quotation._id, transactionId: "TC_fake", amountNPR: 20000 }, customer._id)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an eSewa callback with a forged signature", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    await quotationService.acceptQuotation(quotation._id, customer._id);
    const payment = await paymentService.initiateDeposit({ quotationId: quotation._id }, customer._id);

    const forged = JSON.parse(Buffer.from(callbackFor(payment.formData), "base64").toString());
    forged.total_amount = "1";
    const data = Buffer.from(JSON.stringify(forged)).toString("base64");
    await expect(paymentService.verifyEsewaDeposit(data, customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("does not accept a payment when eSewa's own status check says it is not complete", async () => {
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    await quotationService.acceptQuotation(quotation._id, customer._id);
    const payment = await paymentService.initiateDeposit({ quotationId: quotation._id }, customer._id);

    mockStatusApi("PENDING");
    await expect(paymentService.verifyEsewaDeposit(callbackFor(payment.formData), customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("does not let another customer use someone else's payment", async () => {
    const other = await User.create({ name: "Other", email: "other@flow.test", password: "hashedpassword", role: "Customer" });
    const inquiry = await inquiryService.createInquiry(inquiryPayload(), customer._id, null);
    const quotation = await quotationService.createQuotation(inquiry._id, owner._id, quotationPayload(), null);
    await quotationService.acceptQuotation(quotation._id, customer._id);
    const payment = await paymentService.initiateDeposit({ quotationId: quotation._id }, customer._id);

    await expect(paymentService.verifyEsewaDeposit(callbackFor(payment.formData), other._id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
