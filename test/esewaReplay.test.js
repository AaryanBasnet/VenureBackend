// Paying the deposit: every way the eSewa redirect can be forged, repeated, late or wrong, and what the
// customer and the slot are left with afterwards. eSewa itself is played by test/helpers/esewa.js.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../app");
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const PaymentAttempt = require("../model/paymentAttempt");
const inquiryService = require("../services/inquiryService");
const quotationService = require("../services/quotationService");
const paymentService = require("../services/paymentService");
const bookingService = require("../services/bookingService");
const esewa = require("../utils/esewa");
const { callbackFor, mockStatusApi } = require("./helpers/esewa");
const { world, start, stop, reset, acceptedQuotation, nepalNoon } = require("./helpers/bookingWorld");

beforeAll(() => start({ customers: 3 }), 120000);
afterAll(() => stop());
beforeEach(async () => {
  await reset();
  mockStatusApi();
});

// An inquiry, a quotation and the eSewa form, exactly as the customer would have them just before paying
const flow = async ({ customer = world.customer, daysFromNow = 30, shift = "day", space = world.space, deposit = 20 } = {}) => {
  const inquiry = await inquiryService.createInquiry(
    { venue: world.venue._id, space: space._id, numberOfGuests: 50, eventType: "Wedding", preferredDate: nepalNoon(daysFromNow), contactName: "Jane", phoneNumber: "9800000000" },
    customer._id,
    null
  );
  const quotation = await quotationService.createQuotation(
    inquiry._id,
    world.owner._id,
    { space: space._id, eventDate: nepalNoon(daysFromNow), shift, numberOfGuests: 50, lineItems: [{ label: "Hall", unitPrice: 100000 }], depositType: "percentage", depositValue: deposit },
    null
  );
  await quotationService.acceptQuotation(quotation._id, customer._id);
  const form = await paymentService.initiateDeposit({ quotationId: quotation._id }, customer._id);
  return { inquiry, quotation, form, customer, encoded: callbackFor(form.formData) };
};
const verify = (f, opts, as = f.customer) => paymentService.verifyEsewaDeposit(callbackFor(f.form.formData, opts), as._id);
const book = (verified, customerId) =>
  bookingService.createBookingFromQuotation({ quotationId: String(verified.quotationId), transactionId: verified.transactionId, amountNPR: verified.amountNPR }, customerId);
const payAndBook = async (f) => book(await verify(f), f.customer._id);

const nothingStored = async () => {
  expect(await Booking.countDocuments()).toBe(0);
  expect(await Payment.countDocuments()).toBe(0);
};
const attemptStatus = async (f) => (await PaymentAttempt.findOne({ transactionUuid: f.form.transactionUuid })).status;

describe("the happy path", () => {
  it("books once with the amount the server set", async () => {
    const f = await flow();
    expect(f.form.amount).toBe(20000);
    const booking = await payAndBook(f);
    expect(booking).toMatchObject({ status: "confirmed", depositAmount: 20000, totalPrice: 100000, balanceAmount: 80000 });
    expect(booking.holdClaimExpiresAt).toBeUndefined();
    const payments = await Payment.find({});
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ type: "deposit", amountNPR: 20000, status: "succeeded", booking: booking._id });
    expect(await attemptStatus(f)).toBe("completed");
    expect(String((await Inquiry.findById(f.inquiry._id)).booking)).toBe(String(booking._id));
  });
});

describe("forged or tampered redirects", () => {
  const body = (f) => JSON.parse(Buffer.from(f.encoded, "base64").toString());
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");

  it("rejects a wrong signature, a changed field, a missing signature and rubbish", async () => {
    const f = await flow();
    const good = body(f);
    const cases = {
      "wrong signature": encode({ ...good, signature: "AAAA" + good.signature.slice(4) }),
      "changed amount after signing": encode({ ...good, total_amount: "1" }),
      "changed status after signing": encode({ ...good, status: "COMPLETE", transaction_uuid: good.transaction_uuid + "x" }),
      "no signature": encode({ ...good, signature: undefined }),
      "signed with another secret": encode({ ...good, signature: esewa.sign(good, good.signed_field_names, "not-the-secret") }),
      "a signed field removed": encode({ ...good, signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,missing_field" }),
      "plain text": "not base64 json",
      "empty json": encode({}),
      "an array": encode([good]),
      "null": encode(null),
    };
    for (const [name, encoded] of Object.entries(cases)) {
      await expect(paymentService.verifyEsewaDeposit(encoded, f.customer._id)).rejects.toMatchObject({ statusCode: 400 });
      expect({ name, status: await attemptStatus(f) }).toEqual({ name, status: "initiated" });
    }
    await nothingStored();
  });

  it("rejects a correctly signed callback for the wrong amount", async () => {
    const f = await flow();
    for (const total of [20000.01, 19999.99, 1, 0, 100000, 20000000, "20000.5", "abc", ""]) {
      await expect(verify(f, { totalAmount: total })).rejects.toMatchObject({ statusCode: 400, message: /does not match/ });
    }
    expect(await attemptStatus(f)).toBe("initiated");
    await nothingStored();
  });

  it.each([
    ["20000", true],
    ["20000.00", true],
    ["20000.0", true],
    ["20,000", true],
    ["20,000.00", true],
    [" 20000 ", true],
    ["2,0000", false],
    ["20,00", false],
    ["2,0,0,0,0", false],
    ["20000,00", false],
    ["20000.5", false],
    ["20000.0000001", false],
    ["-20000", false],
    ["+20000", false],
    ["2e4", false],
    ["0x4E20", false],
    ["20000abc", false],
    ["٢٠٠٠٠", false],
    ["", false],
    ["NaN", false],
    ["Infinity", false],
  ])("amount text %p is %s", async (text, accepted) => {
    const f = await flow();
    const attempt = verify(f, { totalAmount: text });
    if (accepted) await expect(attempt).resolves.toMatchObject({ amountNPR: 20000 });
    else await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
  });

  it("parseEsewaAmount returns NaN for anything that is not an amount", () => {
    expect(paymentService.parseEsewaAmount("1,234,567.50")).toBe(1234567.5);
    expect(Number.isNaN(paymentService.parseEsewaAmount(undefined))).toBe(true);
    expect(Number.isNaN(paymentService.parseEsewaAmount({}))).toBe(true);
    expect(paymentService.parseEsewaAmount(20000)).toBe(20000);
  });

  it("rejects another customer's redirect, and an unknown transaction", async () => {
    const f = await flow();
    await expect(verify(f, {}, world.customers[1])).rejects.toMatchObject({ statusCode: 404 });
    const stranger = { ...JSON.parse(Buffer.from(f.encoded, "base64").toString()), transaction_uuid: "VN-unknown-000000" };
    stranger.signature = esewa.sign(stranger, stranger.signed_field_names, esewa.getConfig().secretKey);
    await expect(paymentService.verifyEsewaDeposit(Buffer.from(JSON.stringify(stranger)).toString("base64"), f.customer._id)).rejects.toMatchObject({ statusCode: 404 });
    await nothingStored();
  });

  it("rejects a callback for another merchant", async () => {
    const f = await flow();
    const forged = { ...JSON.parse(Buffer.from(f.encoded, "base64").toString()), product_code: "SOMEONEELSE" };
    forged.signature = esewa.sign(forged, forged.signed_field_names, esewa.getConfig().secretKey);
    await expect(paymentService.verifyEsewaDeposit(Buffer.from(JSON.stringify(forged)).toString("base64"), f.customer._id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a callback that says the payment was cancelled fails the attempt, and a later genuine success still works", async () => {
    const f = await flow();
    await expect(verify(f, { status: "CANCELED" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(verify(f, { status: "PENDING" })).rejects.toMatchObject({ statusCode: 400 });
    expect(await attemptStatus(f)).toBe("failed");
    await expect(payAndBook(f)).resolves.toMatchObject({ status: "confirmed" });
    expect(await attemptStatus(f)).toBe("completed");
  });

  it("a late 'cancelled' redirect never undoes a payment that already completed", async () => {
    const f = await flow();
    await payAndBook(f);
    await expect(verify(f, { status: "CANCELED" })).rejects.toMatchObject({ statusCode: 400 });
    expect(await attemptStatus(f)).toBe("completed");
  });
});

describe("eSewa's own status check", () => {
  const respond = (impl) => {
    global.fetch = jest.fn(impl);
  };

  it.each([
    ["a network failure", () => Promise.reject(new Error("connect ECONNRESET")), 502],
    ["a timeout", () => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), 502],
    ["an HTTP 500", async () => ({ ok: false, status: 500, json: async () => ({}) }), 502],
    ["an HTTP 404", async () => ({ ok: false, status: 404, json: async () => ({}) }), 502],
    ["a body that is not JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }), 502],
    ["status PENDING", async () => ({ ok: true, json: async () => ({ status: "PENDING" }) }), 400],
    ["status NOT_FOUND", async () => ({ ok: true, json: async () => ({ status: "NOT_FOUND" }) }), 400],
    ["status FULL_REFUND", async () => ({ ok: true, json: async () => ({ status: "FULL_REFUND" }) }), 400],
    ["status in lower case", async () => ({ ok: true, json: async () => ({ status: "complete" }) }), 400],
    ["an empty object", async () => ({ ok: true, json: async () => ({}) }), 400],
    ["null", async () => ({ ok: true, json: async () => null }), 400],
    ["a payment for another amount", async () => ({ ok: true, json: async () => ({ status: "COMPLETE", total_amount: "5.0" }) }), 400],
    ["a payment for another transaction", async () => ({ ok: true, json: async () => ({ status: "COMPLETE", transaction_uuid: "VN-other" }) }), 400],
  ])("%s leaves no booking and no payment (HTTP %i)", async (_name, impl, statusCode) => {
    const f = await flow();
    respond(impl);
    await expect(verify(f)).rejects.toMatchObject({ statusCode });
    await nothingStored();
    expect(await attemptStatus(f)).not.toBe("completed");
  });

  it("asks eSewa about this transaction, this amount and this merchant only", async () => {
    const f = await flow();
    await verify(f);
    const url = String(global.fetch.mock.calls[0][0]);
    expect(url).toContain(`transaction_uuid=${encodeURIComponent(f.form.transactionUuid)}`);
    expect(url).toContain("total_amount=20000");
    expect(url).toContain("product_code=EPAYTEST");
  });

  it("accepts eSewa's answer when it repeats the amount and transaction correctly", async () => {
    const f = await flow();
    respond(async () => ({ ok: true, json: async () => ({ status: "COMPLETE", total_amount: "20,000.0", transaction_uuid: f.form.transactionUuid, ref_id: "R1" }) }));
    await expect(verify(f)).resolves.toMatchObject({ amountNPR: 20000 });
  });

  it("recovers once eSewa answers again after an outage", async () => {
    const f = await flow();
    respond(() => Promise.reject(new Error("down")));
    await expect(verify(f)).rejects.toMatchObject({ statusCode: 502 });
    mockStatusApi();
    await expect(payAndBook(f)).resolves.toMatchObject({ status: "confirmed" });
  });
});

describe("the same callback arriving more than once", () => {
  it("a second delivery returns the same booking and creates nothing new", async () => {
    const f = await flow();
    const first = await payAndBook(f);
    const verified = await verify(f);
    const again = await book(verified, f.customer._id);
    expect(String(again._id)).toBe(String(first._id));
    expect(again.$locals.replayed).toBe(true);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
    expect((await Booking.findById(first._id)).status).toBe("confirmed");
  });

  it("twelve simultaneous deliveries of one callback give exactly one booking and one payment, and everyone gets that booking", async () => {
    for (let round = 0; round < 5; round++) {
      await reset();
      const f = await flow({ daysFromNow: 30 + round });
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => payAndBook(f)));
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures.map((r) => r.reason.message)).toEqual([]);
      const ids = new Set(results.map((r) => String(r.value._id)));
      expect(ids.size).toBe(1);
      expect(await Booking.countDocuments({ status: "confirmed" })).toBe(1);
      expect(await Booking.countDocuments()).toBe(1);
      expect(await Payment.countDocuments()).toBe(1);
      expect(await attemptStatus(f)).toBe("completed");
    }
  });

  it("a replay by someone else is refused, and does not touch the booking", async () => {
    const f = await flow();
    const booking = await payAndBook(f);
    await expect(
      bookingService.createBookingFromQuotation({ quotationId: String(f.quotation._id), transactionId: booking && (await Payment.findOne({}))?.transactionId, amountNPR: 20000 }, world.customers[1]._id)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await Booking.countDocuments({ status: "confirmed" })).toBe(1);
    expect(await attemptStatus(f)).toBe("completed");
  });

  it("a delivery after the booking was cancelled does not rebook it", async () => {
    const f = await flow();
    const booking = await payAndBook(f);
    await bookingService.cancelBooking(booking._id, f.customer, null);
    await expect(book(await verify(f), f.customer._id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await Booking.countDocuments({ status: { $ne: "cancelled" } })).toBe(0);
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1);
    expect(await Payment.countDocuments({ type: "refund" })).toBe(1);
  });

  it("reusing one payment code for a different quotation is refused", async () => {
    const a = await flow({ daysFromNow: 30 });
    const bFlow = await flow({ daysFromNow: 31 });
    const first = await payAndBook(a);
    expect(first.status).toBe("confirmed");
    const code = (await Payment.findOne({})).transactionId;
    await expect(
      bookingService.createBookingFromQuotation({ quotationId: String(bFlow.quotation._id), transactionId: code, amountNPR: 20000 }, world.customer._id)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await Booking.countDocuments()).toBe(1);
  });
});

describe("a paid deposit that cannot be turned into a booking is flagged for refund", () => {
  it("another customer booked the slot first", async () => {
    const mine = await flow({ customer: world.customers[0] });
    const rival = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await bookingService.createBookingFromQuotation(rival.request, world.customers[1]._id);

    const verified = await verify(mine);
    await expect(book(verified, mine.customer._id)).rejects.toMatchObject({ statusCode: 409, message: /deposit will be refunded/ });
    expect(await attemptStatus(mine)).toBe("refund_due");
    expect(await Booking.countDocuments({ customer: mine.customer._id })).toBe(0);
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1); // only the winner's
  });

  it.each([
    ["withdrawn", "withdrawn"],
    ["expired", "expired"],
    ["rejected", "rejected"],
    ["superseded", "superseded"],
  ])("the quotation became %s while the customer was paying", async (_name, to) => {
    const f = await flow();
    const verified = await verify(f);
    await Quotation.updateOne({ _id: f.quotation._id }, { status: to });
    await expect(book(verified, f.customer._id)).rejects.toMatchObject({ statusCode: 400, message: /deposit will be refunded/ });
    expect(await attemptStatus(f)).toBe("refund_due");
    await nothingStored();
  });

  it("the event date passed while the customer was paying", async () => {
    const f = await flow();
    const verified = await verify(f);
    await Quotation.updateOne({ _id: f.quotation._id }, { startTime: new Date(Date.now() - 1000), endTime: new Date(Date.now() + 1000) });
    await expect(book(verified, f.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    expect(await attemptStatus(f)).toBe("refund_due");
    await nothingStored();
  });

  it("the paid amount does not match the quotation", async () => {
    const f = await flow();
    const verified = await verify(f);
    await expect(book({ ...verified, amountNPR: 19999 }, f.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    expect(await attemptStatus(f)).toBe("refund_due");
    await nothingStored();
  });

  it("a second payment for an already booked quotation is refunded, not booked twice", async () => {
    const f = await flow();
    await payAndBook(f);
    const second = await paymentService.initiateDeposit({ quotationId: f.quotation._id }, f.customer._id).catch((e) => e);
    expect(second.statusCode).toBe(409); // the form is not even offered
    // ...but if a second attempt was started anyway and paid, it is refunded
    const attempt = await PaymentAttempt.create({ quotation: f.quotation._id, customer: f.customer._id, transactionUuid: "VN-second", amountNPR: 20000, status: "completed", transactionCode: "TC-SECOND" });
    await expect(
      bookingService.createBookingFromQuotation({ quotationId: String(f.quotation._id), transactionId: "TC-SECOND", amountNPR: 20000 }, f.customer._id)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await PaymentAttempt.findById(attempt._id)).status).toBe("refund_due");
    expect(await Booking.countDocuments({ status: "confirmed" })).toBe(1);
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1);
  });

  it("the wrong customer cannot book, and their attempt is not marked for refund", async () => {
    const f = await flow();
    const verified = await verify(f);
    await expect(book(verified, world.customers[1]._id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await attemptStatus(f)).toBe("completed");
    await nothingStored();
  });

  it("an unknown quotation or malformed input never creates anything", async () => {
    await expect(bookingService.createBookingFromQuotation({ quotationId: String(new mongoose.Types.ObjectId()), transactionId: "T", amountNPR: 1 }, world.customer._id)).rejects.toMatchObject({ statusCode: 404 });
    const f = await flow();
    for (const bad of [{ transactionId: "" }, { transactionId: null }, { transactionId: 123 }, { amountNPR: NaN }, { amountNPR: undefined }]) {
      await expect(bookingService.createBookingFromQuotation({ quotationId: String(f.quotation._id), transactionId: "TC-X", amountNPR: 20000, ...bad }, f.customer._id)).rejects.toMatchObject({ statusCode: 400 });
    }
    await nothingStored();
  });

  it("a failure while confirming undoes the claim and the payment record, and flags the refund", async () => {
    const f = await flow();
    const verified = await verify(f);
    const spy = jest.spyOn(Booking, "findOneAndUpdate").mockRejectedValueOnce(new Error("connection lost"));
    await expect(book(verified, f.customer._id)).rejects.toMatchObject({ statusCode: 500, message: /deposit will be refunded/ });
    spy.mockRestore();
    expect(await attemptStatus(f)).toBe("refund_due");
    await nothingStored();
    // and the slot is free for the next person
    const next = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await expect(bookingService.createBookingFromQuotation(next.request, world.customers[1]._id)).resolves.toMatchObject({ status: "confirmed" });
  });

  it("a failure to link the inquiry after confirming does not undo a paid booking", async () => {
    const f = await flow();
    const verified = await verify(f);
    const spy = jest.spyOn(Inquiry, "findByIdAndUpdate").mockRejectedValueOnce(new Error("write failed"));
    const booking = await book(verified, f.customer._id);
    spy.mockRestore();
    expect(booking.status).toBe("confirmed");
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1);
    expect(await attemptStatus(f)).toBe("completed");
  });
});

describe("a crash between the claim and the confirmation", () => {
  const strandedClaim = async (f, expiresInMs) => {
    // What a process that died right after inserting its claim and recording the payment leaves behind
    const verified = await verify(f);
    const bookingId = new mongoose.Types.ObjectId();
    await Booking.create({
      _id: bookingId,
      inquiry: f.inquiry._id,
      quotation: f.quotation._id,
      customer: f.customer._id,
      venue: f.quotation.venue,
      space: f.quotation.space,
      startTime: f.quotation.startTime,
      endTime: f.quotation.endTime,
      eventDate: f.quotation.eventDate,
      shift: f.quotation.shift,
      numberOfGuests: 50,
      eventType: "Wedding",
      contactName: "Jane",
      phoneNumber: "9800000000",
      totalPrice: 100000,
      depositAmount: 20000,
      balanceAmount: 80000,
      status: "pending_deposit",
      holdClaimExpiresAt: new Date(Date.now() + expiresInMs),
    });
    await Payment.create({ booking: bookingId, type: "deposit", provider: "esewa", transactionId: verified.transactionId, amountReceived: 20000, amountNPR: 20000, status: "succeeded" });
    return { verified, bookingId };
  };

  it("the claim carries an expiry and the collection has a TTL index on it", async () => {
    const f = await flow();
    await payAndBook(f);
    const indexes = await Booking.collection.indexes();
    const ttl = indexes.find((i) => i.key.holdClaimExpiresAt === 1);
    expect(ttl).toMatchObject({ expireAfterSeconds: 0 });
    const slot = indexes.find((i) => i.name === "active_slot_keys_unique");
    expect(slot).toMatchObject({ unique: true });
    expect(slot.partialFilterExpression.status.$in).toEqual(["pending_deposit", "confirmed", "completed"]);
  });

  it("a stranded claim blocks the slot only until it expires, then anyone can book it (before the TTL monitor runs)", async () => {
    const f = await flow();
    const { bookingId } = await strandedClaim(f, 700);
    const rival = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await expect(bookingService.createBookingFromQuotation(rival.request, world.customers[1]._id)).rejects.toMatchObject({ statusCode: 409 });

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await Booking.exists({ _id: bookingId })).toBeTruthy(); // the TTL monitor has not removed it
    const rival2 = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 30, shift: "day" });
    await expect(bookingService.createBookingFromQuotation(rival2.request, world.customers[1]._id)).resolves.toMatchObject({ status: "confirmed" });
    expect(await Booking.exists({ _id: bookingId })).toBeFalsy(); // cleared on the way past
    expect(await Payment.exists({ booking: bookingId })).toBeFalsy(); // and so is the orphaned payment record
    expect(await Booking.countDocuments({ status: "pending_deposit" })).toBe(0); // no ghost booking
  });

  it("the customer who paid can simply retry once the claim has expired, and gets the booking", async () => {
    const f = await flow();
    const { verified } = await strandedClaim(f, 400);
    // immediately: the claim may still be alive, so the retry waits for it; after it expires the retry books
    const booking = await book(verified, f.customer._id);
    expect(booking.status).toBe("confirmed");
    expect(await Booking.countDocuments({ status: { $in: ["pending_deposit", "confirmed"] } })).toBe(1);
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1);
  });

  it("a payment whose claim was already removed by the TTL monitor does not block a retry", async () => {
    const f = await flow();
    const { verified, bookingId } = await strandedClaim(f, -1000);
    await Booking.deleteOne({ _id: bookingId }); // what the TTL monitor does
    expect(await Payment.exists({ transactionId: verified.transactionId })).toBeTruthy();
    await expect(book(verified, f.customer._id)).resolves.toMatchObject({ status: "confirmed" });
    expect(await Payment.countDocuments({ type: "deposit" })).toBe(1);
  });
});

describe("over HTTP", () => {
  const cookie = (user) => `accessToken=${jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" })}`;
  const post = (path, user, body) => request(app).post(path).set("Cookie", cookie(user)).send(body);

  it("returns 201 for the booking and 200 with the same booking when the redirect is repeated", async () => {
    const f = await flow();
    const first = await post("/api/payment/esewa/verify", f.customer, { data: f.encoded }).expect(201);
    expect(first.body).toMatchObject({ success: true, data: { status: "confirmed" } });
    const again = await post("/api/payment/esewa/verify", f.customer, { data: f.encoded }).expect(200);
    expect(again.body.data._id).toBe(first.body.data._id);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
  });

  it("reports a taken slot as 409 with the refund message, and a forged redirect as 400", async () => {
    const mine = await flow({ daysFromNow: 40 });
    const rival = await acceptedQuotation({ customer: world.customers[1], daysFromNow: 40, shift: "day" });
    await bookingService.createBookingFromQuotation(rival.request, world.customers[1]._id);
    const res = await post("/api/payment/esewa/verify", mine.customer, { data: mine.encoded }).expect(409);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.message).toMatch(/refunded/);
    await post("/api/payment/esewa/verify", mine.customer, { data: "AAAAAAAAAAAAAAAA" }).expect(400);
    await request(app).post("/api/payment/esewa/verify").send({ data: mine.encoded }).expect(401);
  });
});
