/* eslint-disable no-console */
// Fills a LOCAL, throw-away database with realistic volume for load testing (see docs/PERFORMANCE.md).
//
//   DB_URL=mongodb://127.0.0.1:27017/venure-load node scripts/seed-load.js [--scale 1]
//
// Refuses to run unless DB_URL points at 127.0.0.1/localhost AND the database name contains "load".
// It DROPS that database first. It writes with the raw driver (no Mongoose hooks, no index building),
// so you control when indexes exist: start the code you want to measure (or run
// scripts/ensure-indexes.js) afterwards.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// The load-test accounts share one password that you choose: LOAD_PASSWORD=<something> (never committed).
const loadPassword = process.env.LOAD_PASSWORD || "";
if (!loadPassword) {
  console.error("Set LOAD_PASSWORD to the password the load-test accounts should use (and pass the same value to k6/run.js).");
  process.exit(1);
}

const uri = process.env.DB_URL || "";
const dbName = (uri.split("?")[0].split("/").pop() || "").toLowerCase();
if (!/(127\.0\.0\.1|localhost)/.test(uri) || !dbName.includes("load")) {
  console.error("Refusing to run: DB_URL must contain 127.0.0.1 or localhost and a database name containing 'load'.");
  process.exit(1);
}

const scaleArg = process.argv.indexOf("--scale");
const SCALE = scaleArg > -1 ? Number(process.argv[scaleArg + 1]) : 1;
const N = {
  owners: Math.round(400 * SCALE),
  customers: Math.round(5000 * SCALE),
  venues: Math.round(3000 * SCALE),
  bookings: Math.round(40000 * SCALE),
  inquiries: Math.round(30000 * SCALE),
  quotations: Math.round(15000 * SCALE),
  reviews: Math.round(20000 * SCALE),
  notifications: Math.round(50000 * SCALE),
  messages: Math.round(20000 * SCALE),
  chats: Math.round(3000 * SCALE),
};

// Deterministic PRNG so every run builds the same data
let seed = 20261015;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const skewed = (n) => Math.floor(n * rnd() ** 2.2); // low indexes get far more rows (hot users/venues)
const oid = () => new mongoose.Types.ObjectId();

const CITIES = [
  ["Kathmandu", 27.7172, 85.324], ["Lalitpur", 27.6588, 85.3247], ["Bhaktapur", 27.671, 85.4298], ["Pokhara", 28.2096, 83.9856],
  ["Chitwan", 27.5291, 84.3542], ["Biratnagar", 26.4525, 87.2718], ["Birgunj", 27.0104, 84.8779], ["Butwal", 27.7006, 83.4484],
  ["Dharan", 26.8065, 87.2846], ["Nepalgunj", 28.05, 81.6167], ["Hetauda", 27.4287, 85.0322], ["Janakpur", 26.7288, 85.9263],
  ["Dhulikhel", 27.6194, 85.5389], ["Nagarkot", 27.7172, 85.5206], ["Bandipur", 27.9333, 84.4167], ["Lumbini", 27.4833, 83.2762],
  ["Itahari", 26.6646, 87.2718], ["Damak", 26.6667, 87.7], ["Dhangadhi", 28.6833, 80.6], ["Tansen", 27.8667, 83.5469],
];
const CATEGORIES = ["heritage-courtyards", "garden-estates", "intimate-halls", "mountain-retreats", "rooftop-terraces"];
const AMENITIES = ["Wifi", "Parking", "Air Conditioning", "Stage", "Sound System", "Garden", "Bridal Room", "Generator Backup", "Catering Kitchen", "Valet", "Projector", "Dance Floor", "Rooftop", "Fireworks Area", "Accessible"];
const EVENT_TYPES = ["Wedding", "Reception", "Birthday", "Corporate", "Engagement", "Bratabandha", "Anniversary", "Conference"];
const SHIFTS = [["day", 10, 16], ["night", 17, 23], ["full_day", 9, 23]];
const WORDS = "grand heritage courtyard garden estate hall palace terrace lawn royal himalayan lotus mandala sunrise valley pagoda newari brick banquet celebration elegant spacious traditional modern intimate scenic".split(" ");
const sentence = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
const phone = () => `98${int(10000000, 99999999)}`;
const day = 86400000;

const insertAll = async (col, docs) => {
  for (let i = 0; i < docs.length; i += 2000) await col.insertMany(docs.slice(i, i + 2000), { ordered: false });
  console.log(`  ${col.collectionName.padEnd(14)} ${docs.length}`);
};

(async () => {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`Seeding ${db.databaseName} (scale ${SCALE}); dropping it first.`);
  await db.dropDatabase();
  const c = (n) => db.collection(n);
  const now = Date.now();
  const hash = await bcrypt.hash(loadPassword, 10); // one shared hash: 5,400 separate bcrypts would take minutes

  // ---- users ----
  const users = [];
  users.push({ _id: oid(), name: "Load Admin", email: "load-admin@load.test", password: hash, role: "Admin", avatar: "", favorites: [], createdAt: new Date(now - 400 * day), __v: 0 });
  const owners = Array.from({ length: N.owners }, (_, i) => ({ _id: oid(), name: `Load Owner ${i}`, email: `load-owner-${i}@load.test`, password: hash, role: "VenueOwner", phone: phone(), avatar: "", favorites: [], createdAt: new Date(now - int(30, 400) * day), __v: 0 }));
  const customers = Array.from({ length: N.customers }, (_, i) => ({ _id: oid(), name: `Load Customer ${i}`, email: `load-customer-${i}@load.test`, password: hash, role: "Customer", phone: phone(), avatar: "", favorites: [], createdAt: new Date(now - int(1, 400) * day), __v: 0 }));
  users.push(...owners, ...customers);
  // The first customers favourite a handful of venues so GET favorites returns something
  // (filled in below once venues exist)

  // ---- venues, spaces ----
  const venues = [];
  const spaces = [];
  for (let i = 0; i < N.venues + Math.round(200 * SCALE); i++) {
    const [city, lat, lng] = pick(CITIES);
    const status = i < N.venues ? "approved" : i % 4 === 0 ? "rejected" : "pending";
    const packages = Array.from({ length: pick([0, 1, 2, 2, 3, 3, 4, 5, 6]) }, (_, p) => ({
      _id: oid(), name: `${pick(["Classic", "Deluxe", "Royal", "Heritage", "Premium", "Basic"])} ${p + 1}`, tagline: sentence(4), pricePerPlate: int(6, 60) * 100, minPlates: int(50, 150), highlights: [sentence(3), sentence(3)],
    }));
    const prices = packages.map((p) => p.pricePerPlate);
    const min = prices.length ? Math.min(...prices) : null;
    const venueId = oid();
    const created = new Date(now - int(1, 700) * day);
    const sp = Array.from({ length: int(1, 6) }, (_, s) => ({
      _id: oid(), venue: venueId, name: `${pick(["Grand Hall", "Garden Lawn", "Terrace", "Courtyard", "Banquet", "Mini Hall"])} ${s + 1}`, description: sentence(12),
      capacity: int(5, 120) * 10, amenities: [pick(AMENITIES)], spaceImages: [], indicativePricePerHour: int(20, 200) * 100, shiftOverrides: [],
      defaultDepositType: "percentage", defaultDepositValue: 20, isActive: rnd() > 0.05, migratedFromVenue: false, createdAt: created, updatedAt: created, __v: 0,
    }));
    spaces.push(...sp);
    const active = sp.filter((s) => s.isActive);
    venues.push({
      _id: venueId, owner: owners[skewed(owners.length)]._id, venueName: `${pick(WORDS)} ${pick(WORDS)} ${pick(["Palace", "Garden", "Hall", "Lodge", "Courtyard", "Terrace"])} ${i}`.replace(/^./, (x) => x.toUpperCase()),
      category: pick(CATEGORIES), location: { address: `${int(1, 99)} ${pick(WORDS)} Marg`, city, state: "Bagmati", country: "Nepal" },
      geoCoordinates: { type: "Point", coordinates: [lng + (rnd() - 0.5) * 0.1, lat + (rnd() - 0.5) * 0.1] },
      venueImages: Array.from({ length: int(3, 6) }, (_, k) => ({ filename: `venure/${venueId}-${k}`, url: `https://res.cloudinary.com/demo/image/upload/venure/${venueId}-${k}.jpg` })),
      description: sentence(60), amenities: Array.from(new Set(Array.from({ length: int(2, 8) }, () => pick(AMENITIES)))), packages,
      drinkOptions: rnd() > 0.5 ? [{ _id: oid(), name: "Welcome drinks", description: sentence(5), items: [sentence(2), sentence(2)] }] : [],
      contactPhone: phone(), status, isDeleted: false, averageRating: 0, totalReviews: 0, isFeatured: status === "approved" && i < 12,
      minPricePerPlate: min, priceSortKey: min === null ? 1e12 : min,
      maxCapacity: active.length ? Math.max(...active.map((s) => s.capacity)) : 0, spaceCount: active.length, createdAt: created, updatedAt: created, __v: 0,
    });
  }
  const approved = venues.filter((v) => v.status === "approved");
  const spacesByVenue = new Map();
  spaces.forEach((s) => {
    const k = String(s.venue);
    if (!spacesByVenue.has(k)) spacesByVenue.set(k, []);
    spacesByVenue.get(k).push(s);
  });
  const venueById = new Map(venues.map((v) => [String(v._id), v]));
  customers.slice(0, 200).forEach((u) => { u.favorites = Array.from({ length: 6 }, () => approved[skewed(approved.length)]._id); });

  // ---- bookings: one per space/day/shift so no two overlap ----
  const bookings = [];
  const taken = new Set();
  const customerPick = () => customers[skewed(customers.length)];
  while (bookings.length < N.bookings) {
    const v = approved[skewed(approved.length)]; // popular venues are hot
    const s = pick(spacesByVenue.get(String(v._id)));
    const offset = int(-330, 150);
    const [shift, h1, h2] = pick(SHIFTS);
    const k = (suffix) => `${s._id}|${offset}|${suffix}`;
    if (shift === "full_day" ? taken.has(k("day")) || taken.has(k("night")) || taken.has(k("full_day")) : taken.has(k(shift)) || taken.has(k("full_day"))) continue;
    taken.add(k(shift));
    const base = new Date(now + offset * day); base.setUTCHours(0, 0, 0, 0);
    const startTime = new Date(base.getTime() + h1 * 3600000);
    const endTime = new Date(base.getTime() + h2 * 3600000);
    const past = offset < 0;
    const r = rnd();
    const status = past ? (r < 0.75 ? "completed" : r < 0.9 ? "cancelled" : "confirmed") : (r < 0.55 ? "confirmed" : r < 0.8 ? "pending_deposit" : "cancelled");
    const guests = int(30, 600);
    const total = guests * int(8, 50) * 100;
    const dep = Math.round(total * 0.2);
    const cu = customerPick();
    const created = new Date(startTime.getTime() - int(5, 90) * day);
    bookings.push({
      _id: oid(), inquiry: null, quotation: null, customer: cu._id, venue: v._id, space: s._id, eventDate: base, shift, startTime, endTime, numberOfGuests: guests,
      eventType: pick(EVENT_TYPES), specialRequirements: "", contactName: cu.name, phoneNumber: phone(), totalPrice: total, depositAmount: dep, balanceAmount: total - dep,
      balanceSettled: status === "completed", cancellationPolicy: [{ minDaysBefore: 14, refundPercentage: 100 }, { minDaysBefore: 7, refundPercentage: 50 }],
      status, createdAt: created, updatedAt: created, __v: 0,
    });
  }

  // ---- inquiries, quotations ----
  const inquiries = [];
  for (let i = 0; i < N.inquiries; i++) {
    const v = approved[skewed(approved.length)];
    const s = pick(spacesByVenue.get(String(v._id)));
    const cu = customerPick();
    const created = new Date(now - int(0, 300) * day);
    inquiries.push({
      _id: oid(), customer: cu._id, venue: v._id, space: s._id, preferredDate: new Date(created.getTime() + int(10, 120) * day), preferredShift: pick(["day", "night", "full_day", null]),
      numberOfGuests: int(30, 600), eventType: pick(EVENT_TYPES), message: sentence(15), contactName: cu.name, phoneNumber: phone(),
      status: pick(["pending", "pending", "quoted", "quoted", "accepted", "declined", "cancelled", "expired"]), currentQuotation: null, booking: null, createdAt: created, updatedAt: created, __v: 0,
    });
  }
  const quotations = [];
  for (let i = 0; i < N.quotations; i++) {
    const inq = inquiries[i];
    const v = venueById.get(String(inq.venue));
    const total = inq.numberOfGuests * int(8, 50) * 100;
    const dep = Math.round(total * 0.2);
    const start = new Date(inq.preferredDate); start.setUTCHours(10, 0, 0, 0);
    const q = {
      _id: oid(), inquiry: inq._id, venue: inq.venue, space: inq.space, owner: v.owner, eventDate: inq.preferredDate, shift: "day", startTime: start, endTime: new Date(start.getTime() + 6 * 3600000),
      numberOfGuests: inq.numberOfGuests, lineItems: [{ label: "Venue", quantity: 1, unitPrice: total, perGuest: false, amount: total }], totalPrice: total, currency: "NPR",
      depositType: "percentage", depositValue: 20, depositAmount: dep, balanceAmount: total - dep, validUntil: new Date(now + 7 * day), status: inq.status === "accepted" ? "accepted" : "sent", notes: "", createdAt: inq.createdAt, updatedAt: inq.createdAt, __v: 0,
    };
    quotations.push(q);
    inq.currentQuotation = q._id;
  }

  // ---- reviews: one per completed booking ----
  const completed = bookings.filter((b) => b.status === "completed");
  const reviews = [];
  for (let i = 0; i < Math.min(N.reviews, completed.length); i++) {
    const b = completed[i];
    const rating = pick([3, 4, 4, 5, 5, 5, 2, 1]);
    reviews.push({ _id: oid(), user: b.customer, venue: b.venue, booking: b._id, rating, title: sentence(3), comment: sentence(25), isFeatured: i < 30 && rating >= 4, helpfulCount: 0, createdAt: new Date(b.endTime.getTime() + day), updatedAt: new Date(b.endTime.getTime() + day), __v: 0 });
    const v = venueById.get(String(b.venue));
    v.averageRating += rating; v.totalReviews += 1;
  }
  venues.forEach((v) => { if (v.totalReviews) v.averageRating = Math.round((v.averageRating / v.totalReviews) * 10) / 10; });

  // ---- notifications, chats, messages ----
  const notifications = Array.from({ length: N.notifications }, () => {
    const u = rnd() < 0.8 ? customers[skewed(customers.length)] : owners[skewed(owners.length)];
    return { _id: oid(), recipient: u._id, type: pick(["chat", "booking", "system", "approval", "venue"]), message: sentence(8), link: "/dashboard", read: rnd() < 0.6, createdAt: new Date(now - int(0, 200) * day - int(0, day)), __v: 0 };
  });
  const chats = [];
  const chatKeys = new Set();
  while (chats.length < N.chats) {
    const v = approved[skewed(approved.length)]; const cu = customerPick();
    const k = `${v._id}|${cu._id}`; if (chatKeys.has(k)) continue; chatKeys.add(k);
    const created = new Date(now - int(1, 200) * day);
    chats.push({ _id: oid(), participants: [cu._id, v.owner], venueId: v._id, createdAt: created, updatedAt: created, __v: 0 });
  }
  const messages = [];
  for (let i = 0; i < N.messages; i++) {
    const ch = chats[skewed(chats.length)]; const fromFirst = rnd() < 0.5;
    const at = new Date(ch.createdAt.getTime() + int(0, 5000) * 60000);
    messages.push({ _id: oid(), chatId: ch._id, sender: ch.participants[fromFirst ? 0 : 1], receiver: ch.participants[fromFirst ? 1 : 0], text: sentence(int(3, 14)), seen: rnd() < 0.7, createdAt: at, updatedAt: at, __v: 0 });
    if (at > ch.updatedAt) ch.updatedAt = at;
  }

  console.log("Inserting:");
  await insertAll(c("users"), users);
  await insertAll(c("venues"), venues);
  await insertAll(c("spaces"), spaces);
  await insertAll(c("bookings"), bookings);
  await insertAll(c("inquiries"), inquiries);
  await insertAll(c("quotations"), quotations);
  await insertAll(c("reviews"), reviews);
  await insertAll(c("notifications"), notifications);
  await insertAll(c("chats"), chats);
  await insertAll(c("messages"), messages);

  // Login needs the unique email index; every other index is left to whichever code runs next
  await c("users").createIndex({ email: 1 }, { unique: true });
  console.log("Done. Accounts: load-admin@load.test, load-owner-N@load.test, load-customer-N@load.test (password in docs/PERFORMANCE.md).");
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
