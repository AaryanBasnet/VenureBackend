/* eslint-disable no-console */
// Builds the fixture for k6/race.js in the LOAD database (refuses anything else): N customers who each hold an
// ACCEPTED quotation for the SAME space and time slot plus an eSewa payment attempt, and the signed callback each
// would bring back from eSewa. Writes k6/results/race-fixture.json. Uses the raw driver (no hooks, no indexes).
//
//   DB_URL=mongodb://127.0.0.1:27017/venure-load node k6/prep-race.js [N=50] [startDaysFromNow=300]
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const esewa = require("../utils/esewa");
require("dotenv").config();

const uri = process.env.DB_URL || "";
const dbName = (uri.split("?")[0].split("/").pop() || "").toLowerCase();
if (!/(127\.0\.0\.1|localhost)/.test(uri) || !dbName.includes("load")) {
  console.error("Refusing to run: DB_URL must be a local database whose name contains 'load'.");
  process.exit(1);
}

const N = Number(process.argv[2] || 50);
const DAYS = Number(process.argv[3] || 300);
const DEPOSIT = 20000;
const TOTAL = 100000;
const HOUR = 3600000;

(async () => {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const oid = () => new mongoose.Types.ObjectId();

  const space = await db.collection("spaces").findOne({ isActive: true });
  const venue = await db.collection("venues").findOne({ _id: space.venue });
  const customers = await db.collection("users").find({ email: { $regex: "^load-customer-(1[0-9]{2}|[2-9][0-9]{2})@" } }).sort({ email: 1 }).limit(N).toArray();
  if (customers.length < N) throw new Error("not enough seeded customers");

  const start = new Date(Date.now() + DAYS * 24 * HOUR); start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 6 * HOUR);
  // Clean any previous fixture for this slot
  await db.collection("bookings").deleteMany({ space: space._id, startTime: start });
  await db.collection("quotations").deleteMany({ space: space._id, startTime: start });

  const { secretKey, merchantCode } = esewa.getConfig();
  const fixture = [];
  for (const [i, c] of customers.entries()) {
    const now = new Date();
    const inquiry = { _id: oid(), customer: c._id, venue: venue._id, space: space._id, preferredDate: start, preferredShift: "day", numberOfGuests: 100, eventType: "Wedding", message: "", contactName: c.name, phoneNumber: "9800000000", status: "accepted", booking: null, createdAt: now, updatedAt: now, __v: 0 };
    const quotation = {
      _id: oid(), inquiry: inquiry._id, venue: venue._id, space: space._id, owner: venue.owner, eventDate: start, shift: "day", startTime: start, endTime: end, numberOfGuests: 100,
      lineItems: [{ label: "Venue hire", quantity: 1, unitPrice: TOTAL, perGuest: false, amount: TOTAL }], totalPrice: TOTAL, currency: "NPR", depositType: "fixed", depositValue: DEPOSIT,
      depositAmount: DEPOSIT, balanceAmount: TOTAL - DEPOSIT, validUntil: new Date(Date.now() + 7 * 24 * HOUR), status: "accepted", createdAt: now, updatedAt: now, __v: 0,
    };
    inquiry.currentQuotation = quotation._id;
    const uuid = `VN-RACE-${Date.now()}-${i}`;
    const attempt = { _id: oid(), quotation: quotation._id, customer: c._id, provider: "esewa", transactionUuid: uuid, amountNPR: DEPOSIT, status: "initiated", createdAt: now, updatedAt: now, __v: 0 };
    await db.collection("inquiries").insertOne(inquiry);
    await db.collection("quotations").insertOne(quotation);
    await db.collection("paymentattempts").insertOne(attempt);

    const body = { transaction_code: `RC${i}`, status: "COMPLETE", total_amount: String(DEPOSIT), transaction_uuid: uuid, product_code: merchantCode, signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
    body.signature = esewa.sign(body, body.signed_field_names, secretKey);
    fixture.push({ email: c.email, quotationId: String(quotation._id), data: Buffer.from(JSON.stringify(body)).toString("base64") });
  }

  const out = path.join(__dirname, "results", "race-fixture.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ space: String(space._id), venue: String(venue._id), startTime: start.toISOString(), fixture }, null, 1));
  console.log(`fixture: ${N} customers racing for space ${space._id} at ${start.toISOString()} -> ${out}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
