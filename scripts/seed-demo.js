/* eslint-disable no-console */
// Fills a database with the public demo: three one-click demo accounts (customer, owner, admin) and five believable
// venues with halls, photos, packages, requests in every state, quotations, bookings, reviews, chats and an admin queue.
//
//   DB_URL=... node scripts/seed-demo.js
//
// Everything it writes is flagged isDemo, and running it again first removes the previous demo data and rebuilds it,
// so it is safe to run on a database that also holds real data (it touches nothing that is not a demo record).
// The demo accounts get a random password nobody knows: the only way in is the "Try the demo" buttons (POST /api/auth/demo).
// Photos are uploaded from demo-assets/ to Cloudinary under venure/demo (CLOUDINARY_* must be set).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Inquiry = require("../model/inquiry");
const Quotation = require("../model/quotation");
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Review = require("../model/review");
const Chat = require("../model/chat");
const Message = require("../model/message");
const Notification = require("../model/notification");
const Contact = require("../model/contact");
const ActivityLog = require("../model/activityLog");
const RefreshToken = require("../model/refreshToken");
const PaymentAttempt = require("../model/paymentAttempt");
const VenueApplication = require("../model/venueApplication");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { DEMO_ACCOUNTS } = require("../config/demoAccounts");
const { resolveShiftTimes } = require("../services/shiftService");

const ASSETS = path.join(__dirname, "..", "demo-assets");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const REFUND_TIERS = [
  { minDaysBefore: 30, refundPercentage: 100 },
  { minDaysBefore: 15, refundPercentage: 75 },
  { minDaysBefore: 7, refundPercentage: 50 },
  { minDaysBefore: 0, refundPercentage: 0 },
];

// Noon in Kathmandu on the Kathmandu day n days from now (how the date picker sends a date)
const nepalNoon = (days) => {
  const shifted = new Date(Date.now() + NEPAL_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + days, 6, 15));
};

/* ---------- what the demo contains ---------- */
const CUSTOMERS = [
  { name: "Anita Shrestha", phone: "9841000001" },
  { name: "Rohan Karki", phone: "9841000002" },
  { name: "Sunita Gurung", phone: "9841000003" },
  { name: "Priya Maharjan", phone: "9841000004" },
  { name: "Aditya Thapa", phone: "9841000005" },
  { name: "Bikash Tamang", phone: "9841000006" },
];

const VENUES = [
  {
    key: "kumari",
    venueName: "Kumari Heritage Hall",
    category: "heritage-traditional",
    location: { address: "Durbar Square, Bhaktapur", city: "Bhaktapur", state: "Bagmati", country: "Nepal" },
    coordinates: [85.4298, 27.671],
    description: "A carved-timber Newar hall beside Bhaktapur's Durbar Square. Painted ceilings, brass lamps and a stone courtyard for weddings, bratabandha and cultural evenings.",
    amenities: ["Parking", "Catering", "Sound System", "Projector"],
    contactPhone: "9851000011",
    images: ["kumari-heritage-hall", "story-big", "ambience", "autumn"],
    packages: [
      { name: "Newa Bhoj", tagline: "A traditional feast", pricePerPlate: 1800, minPlates: 100, highlights: ["Samay baji and bara", "Seasonal vegetable curries", "Juju dhau and sweets"] },
      { name: "Heritage Banquet", tagline: "Buffet with live counters", pricePerPlate: 2600, minPlates: 80, highlights: ["Veg and non-veg buffet", "Live momo counter", "Dessert table"] },
    ],
    drinkOptions: [{ name: "Traditional welcome", description: "Served on arrival", items: ["Aila", "Masala tea", "Fresh lime soda"] }],
    halls: [
      { name: "Darbar Hall", spaceType: "intimate-halls", capacity: 120, images: ["kumari-heritage-hall"], description: "A painted indoor hall with brass chandeliers." },
      { name: "Newa Courtyard", spaceType: "heritage-courtyards", capacity: 300, images: ["story-big"], description: "An open stone courtyard lit by lanterns." },
    ],
  },
  {
    key: "darbar",
    venueName: "The Darbar Pavilion",
    category: "banquet-party-palace",
    location: { address: "Mangal Bazaar, Patan", city: "Lalitpur", state: "Bagmati", country: "Nepal" },
    coordinates: [85.3247, 27.6738],
    description: "A palace-style pavilion in Patan with a lawn for big weddings and a rooftop for smaller receptions. Full catering and decoration in house.",
    amenities: ["Parking", "Air Conditioning", "Catering", "Sound System", "Garden"],
    contactPhone: "9851000022",
    images: ["darbar-pavilion", "wedding", "winter", "spring"],
    packages: [
      { name: "Royal Wedding", tagline: "The full celebration", pricePerPlate: 3800, minPlates: 250, highlights: ["Five-course dinner", "Live chaat and grill", "Mandap decoration included"] },
      { name: "Reception Buffet", tagline: "Elegant and simple", pricePerPlate: 2900, minPlates: 150, highlights: ["Veg and non-veg buffet", "Welcome drinks", "Dessert table"] },
      { name: "Cocktail Evening", tagline: "Standing reception", pricePerPlate: 2200, minPlates: 80, highlights: ["Canapes and live counters", "Two drink rounds"] },
    ],
    drinkOptions: [{ name: "Premium bar", description: "Hosted for four hours", items: ["Wine", "Whisky", "Mocktails", "Soft drinks"] }],
    halls: [
      { name: "Pavilion Lawn", spaceType: "garden-estates", capacity: 500, images: ["darbar-pavilion", "wedding"], description: "A landscaped lawn with a covered stage." },
      { name: "Sky Terrace", spaceType: "rooftop-terraces", capacity: 150, images: ["winter"], description: "A string-lit rooftop for receptions." },
    ],
  },
  {
    key: "lodge",
    venueName: "Himalayan Heritage Lodge",
    category: "hotel-resort",
    location: { address: "Nagarkot Hill Road, Nagarkot", city: "Nagarkot", state: "Bagmati", country: "Nepal" },
    coordinates: [85.5206, 27.7172],
    description: "A timber lodge on the Nagarkot ridge with sunrise views of the Himalaya. Rooms for the wedding party, a lawn for the ceremony and a terrace for the evening.",
    amenities: ["Parking", "Wifi", "Catering", "Garden", "Projector"],
    contactPhone: "9851000033",
    images: ["heritage-lodge", "mountain", "rooftop", "summer"],
    packages: [
      { name: "Ridge Weekend", tagline: "Stay and celebrate", pricePerPlate: 3200, minPlates: 60, highlights: ["Three-course dinner", "Bonfire and music", "Breakfast for guests"] },
      { name: "Mountain Feast", tagline: "Local flavours", pricePerPlate: 2400, minPlates: 80, highlights: ["Thakali set", "Grill counter", "Sel roti and sweets"] },
    ],
    drinkOptions: [{ name: "Sunrise welcome", description: "For the morning ceremony", items: ["Masala tea", "Fresh juice", "Hot lemon"] }],
    halls: [
      { name: "Sunrise Lawn", spaceType: "mountain-retreats", capacity: 200, images: ["mountain"], description: "An open lawn facing the snow peaks." },
      { name: "Lodge Terrace", spaceType: "rooftop-terraces", capacity: 100, images: ["rooftop"], description: "A covered terrace for dinner and music." },
    ],
  },
  {
    key: "lakeside",
    venueName: "Lakeside Garden Estate",
    category: "banquet-party-palace",
    location: { address: "Lakeside Road, Pokhara", city: "Pokhara", state: "Gandaki", country: "Nepal" },
    coordinates: [83.9585, 28.2096],
    description: "Terraced lawns above Phewa Lake with white drapes, string lights and a covered hall for monsoon dates. A favourite for destination weddings.",
    amenities: ["Parking", "Catering", "Sound System", "Garden", "Lake View"],
    contactPhone: "9851000044",
    images: ["summer", "garden", "spring", "intimate-hall"],
    packages: [
      { name: "Lakeside Wedding", tagline: "Dinner by the water", pricePerPlate: 3500, minPlates: 120, highlights: ["Plated starter and buffet", "Live grill", "Floral table styling"] },
      { name: "Garden Lunch", tagline: "Relaxed daytime events", pricePerPlate: 2100, minPlates: 60, highlights: ["Buffet lunch", "Fresh juices", "Dessert counter"] },
    ],
    drinkOptions: [{ name: "Lakeside bar", description: "Hosted for three hours", items: ["Wine", "Beer", "Mocktails", "Soft drinks"] }],
    halls: [
      { name: "Lakeside Lawn", spaceType: "garden-estates", capacity: 450, images: ["summer", "garden"], description: "Terraced lawn with a lake view." },
      { name: "Marigold Hall", spaceType: "intimate-halls", capacity: 150, images: ["intimate-hall"], description: "A covered hall with crystal chandeliers." },
    ],
  },
  {
    key: "ballroom",
    venueName: "Lazimpat Grand Ballroom",
    category: "hotel-resort",
    location: { address: "Lazimpat Marg, Kathmandu", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    coordinates: [85.3206, 27.7194],
    description: "A city hotel with a pillarless ballroom and a brick-palace lawn. Corporate dinners on weekdays, weddings at weekends.",
    amenities: ["Parking", "Wifi", "Air Conditioning", "Catering", "Sound System", "Projector"],
    contactPhone: "9851000055",
    images: ["intimate-hall", "heritage-courtyard", "ambience", "autumn"],
    packages: [
      { name: "Grand Banquet", tagline: "Hotel buffet", pricePerPlate: 3000, minPlates: 150, highlights: ["Multi-cuisine buffet", "Live pasta and grill", "Dessert station"] },
      { name: "Corporate Dinner", tagline: "Sit-down service", pricePerPlate: 2500, minPlates: 40, highlights: ["Three-course plated dinner", "Soft drinks"] },
    ],
    drinkOptions: [{ name: "Open bar", description: "Hosted for four hours", items: ["Wine", "Whisky", "Beer", "Mocktails"] }],
    halls: [
      { name: "Grand Ballroom", spaceType: "intimate-halls", capacity: 400, images: ["intimate-hall"], description: "A pillarless hall with a stage and dance floor." },
      { name: "Brick Palace Lawn", spaceType: "garden-estates", capacity: 250, images: ["heritage-courtyard"], description: "A lawn in front of the hotel's brick palace." },
    ],
  },
];

/* ---------- helpers ---------- */
const log = (...args) => console.log(...args);
const randomHash = () => bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
const email = (slug) => `${slug}@demo.venure.invalid`;

const uploadAssets = async () => {
  const urls = {};
  for (const file of fs.readdirSync(ASSETS).filter((f) => f.endsWith(".jpg"))) {
    const key = file.replace(/\.jpg$/, "");
    const result = await cloudinary.uploader.upload(path.join(ASSETS, file), { public_id: `venure/demo/${key}`, overwrite: true, resource_type: "image" });
    urls[key] = result.secure_url;
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return urls;
};

// A placeholder paper for the demo applications, stored privately like the real ones (only a signed link opens it)
const uploadSampleDocument = async () => {
  const file = path.join(ASSETS, "private", "sample-document.png");
  const doc = (id, name) => cloudinary.uploader.upload(file, { public_id: `venure/demo-private/${id}`, overwrite: true, resource_type: "image", type: "authenticated" })
    .then((r) => ({ publicId: r.public_id, originalName: name, mimeType: "image/png", size: fs.statSync(file).size }));
  return { registrationCert: await doc("sample-registration", "business-registration-sample.png"), panCert: await doc("sample-pan", "pan-certificate-sample.png") };
};

const wipeDemo = async () => {
  const users = (await User.find({ isDemo: true }).select("_id")).map((u) => u._id);
  const venues = (await Venue.find({ isDemo: true }).select("_id")).map((v) => v._id);
  const bookings = (await Booking.find({ venue: { $in: venues } }).select("_id")).map((b) => b._id);
  const chats = (await Chat.find({ participants: { $in: users } }).select("_id")).map((c) => c._id);
  await Promise.all([
    Payment.deleteMany({ booking: { $in: bookings } }),
    PaymentAttempt.deleteMany({ customer: { $in: users } }),
    Booking.deleteMany({ venue: { $in: venues } }),
    Quotation.deleteMany({ venue: { $in: venues } }),
    Inquiry.deleteMany({ venue: { $in: venues } }),
    Review.deleteMany({ venue: { $in: venues } }),
    Space.deleteMany({ venue: { $in: venues } }),
    Message.deleteMany({ chatId: { $in: chats } }),
    Chat.deleteMany({ _id: { $in: chats } }),
    Notification.deleteMany({ recipient: { $in: users } }),
    RefreshToken.deleteMany({ userId: { $in: users } }),
    VenueApplication.deleteMany({ isDemo: true }),
    Contact.deleteMany({ isDemo: true }),
    ActivityLog.deleteMany({ isDemo: true }),
  ]);
  await Venue.deleteMany({ isDemo: true });
  await User.deleteMany({ isDemo: true });
};

/* ---------- the seed ---------- */
const run = async () => {
  if (!process.env.DB_URL) throw new Error("Set DB_URL");
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error("Set the CLOUDINARY_* variables: the demo photos are uploaded there");
  await mongoose.connect(process.env.DB_URL);
  log("Seeding the demo into", mongoose.connection.name);

  log("Uploading photos");
  const photo = await uploadAssets();
  const imageList = (keys) => keys.map((k) => ({ filename: `${k}.jpg`, url: photo[k] }));

  const sampleDocs = await uploadSampleDocument();

  log("Removing the previous demo data");
  await wipeDemo();

  /* people */
  const hash = await randomHash();
  const accounts = {};
  for (const [key, account] of Object.entries(DEMO_ACCOUNTS)) {
    accounts[key] = await User.create({ ...account, phone: "9800000000", isDemo: true, password: hash });
  }
  const customers = [accounts.customer];
  for (const [i, c] of CUSTOMERS.entries()) {
    customers.push(await User.create({ name: c.name, phone: c.phone, email: email(`customer${i + 1}`), role: "Customer", isDemo: true, password: hash }));
  }
  const owner = accounts.owner;
  const admin = accounts.admin;
  const pick = (i) => customers[i % customers.length];

  /* venues and halls */
  const venues = {};
  for (const v of VENUES) {
    const venue = await Venue.create({
      owner: owner._id, venueName: v.venueName, category: v.category, location: v.location,
      geoCoordinates: { type: "Point", coordinates: v.coordinates }, description: v.description, amenities: v.amenities,
      contactPhone: v.contactPhone, venueImages: imageList(v.images), packages: v.packages, drinkOptions: v.drinkOptions,
      status: "approved", isDemo: true,
    });
    const spaces = [];
    for (const h of v.halls) {
      spaces.push(await Space.create({ venue: venue._id, name: h.name, description: h.description, spaceType: h.spaceType, capacity: h.capacity, amenities: v.amenities.slice(0, 3), spaceImages: imageList(h.images) }));
    }
    venues[v.key] = { doc: venue, spaces };
  }
  await Venue.updateMany({ isDemo: true, venueName: { $in: ["Kumari Heritage Hall", "The Darbar Pavilion", "Lakeside Garden Estate"] } }, { $set: { isFeatured: true } });

  /* requests, quotations and bookings */
  const lineItems = (guests, perPlate, hire, extra = []) => [
    { label: "Venue hire", quantity: 1, unitPrice: hire, perGuest: false, amount: hire },
    { label: "Catering", description: "Per plate", quantity: guests, unitPrice: perPlate, perGuest: true, amount: guests * perPlate },
    ...extra,
  ];
  const total = (items) => items.reduce((sum, i) => sum + i.amount, 0);

  const makeInquiry = (venueKey, hallIndex, customer, daysAhead, shift, guests, eventType, status, extra = {}) => {
    const { doc, spaces } = venues[venueKey];
    const space = spaces[hallIndex];
    return Inquiry.create({
      customer: customer._id, venue: doc._id, space: space._id, preferredDate: nepalNoon(daysAhead), preferredShift: shift,
      numberOfGuests: guests, eventType, contactName: customer.name, phoneNumber: customer.phone || "9800000000",
      message: extra.message ?? "", status, ...extra.fields,
    });
  };
  const makeQuotation = async (inquiry, venueKey, hallIndex, shift, perPlate, hire, status, extraItems = []) => {
    const { doc, spaces } = venues[venueKey];
    const space = spaces[hallIndex];
    const eventDate = inquiry.preferredDate;
    const times = resolveShiftTimes(eventDate, shift, space);
    const items = lineItems(inquiry.numberOfGuests, perPlate, hire, extraItems);
    const sum = total(items);
    const deposit = Math.round((sum * 0.2) / 100) * 100;
    const quotation = await Quotation.create({
      inquiry: inquiry._id, venue: doc._id, space: space._id, owner: owner._id, eventDate, shift,
      startTime: times.startTime, endTime: times.endTime, numberOfGuests: inquiry.numberOfGuests, lineItems: items,
      totalPrice: sum, depositType: "percentage", depositValue: 20, depositAmount: deposit, balanceAmount: sum - deposit,
      validUntil: new Date(Date.now() + 5 * DAY), status,
    });
    await Inquiry.updateOne({ _id: inquiry._id }, { currentQuotation: quotation._id });
    return { quotation, times };
  };
  const makeBooking = async ({ venueKey, hallIndex, customer, daysAhead, shift, guests, eventType, perPlate, hire, status, settled = false, extra = [] }) => {
    const { doc, spaces } = venues[venueKey];
    const space = spaces[hallIndex];
    const inquiry = await makeInquiry(venueKey, hallIndex, customer, daysAhead, shift, guests, eventType, "accepted");
    const { quotation, times } = await makeQuotation(inquiry, venueKey, hallIndex, shift, perPlate, hire, "accepted", extra);
    const txn = `DEMO${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const booking = await Booking.create({
      inquiry: inquiry._id, quotation: quotation._id, customer: customer._id, venue: doc._id, space: space._id,
      eventDate: inquiry.preferredDate, shift, startTime: times.startTime, endTime: times.endTime, numberOfGuests: guests,
      eventType, contactName: customer.name, phoneNumber: customer.phone || "9800000000", totalPrice: quotation.totalPrice,
      depositAmount: quotation.depositAmount, balanceAmount: quotation.balanceAmount, cancellationPolicy: REFUND_TIERS, status,
      ...(settled ? { balanceSettled: true, balanceSettledAt: new Date(times.endTime.getTime() - DAY), balanceSettledMethod: "Cash at the venue", balanceSettledBy: owner._id } : {}),
    });
    await Inquiry.updateOne({ _id: inquiry._id }, { booking: booking._id });
    await Payment.create({ booking: booking._id, type: "deposit", provider: "esewa", transactionId: txn, amountReceived: quotation.depositAmount, amountNPR: quotation.depositAmount, status: "succeeded", verifiedAt: new Date(times.startTime.getTime() - 40 * DAY) });
    return { inquiry, quotation, booking };
  };

  // Upcoming, deposit paid
  await makeBooking({ venueKey: "darbar", hallIndex: 0, customer: customers[1], daysAhead: 9, shift: "night", guests: 320, eventType: "Wedding", perPlate: 3800, hire: 180000, status: "confirmed", extra: [{ label: "Mandap and stage decoration", quantity: 1, unitPrice: 95000, perGuest: false, amount: 95000 }] });
  await makeBooking({ venueKey: "kumari", hallIndex: 1, customer: customers[2], daysAhead: 21, shift: "day", guests: 180, eventType: "Bratabandha", perPlate: 1800, hire: 60000, status: "confirmed" });
  await makeBooking({ venueKey: "lakeside", hallIndex: 0, customer: customers[3], daysAhead: 38, shift: "full_day", guests: 260, eventType: "Wedding", perPlate: 3500, hire: 150000, status: "confirmed" });
  await makeBooking({ venueKey: "ballroom", hallIndex: 0, customer: customers[4], daysAhead: 62, shift: "night", guests: 220, eventType: "Corporate dinner", perPlate: 2500, hire: 120000, status: "confirmed" });

  // Past, completed and reviewed (spread over earlier months so the earnings chart has a shape)
  const past = [
    ["darbar", 0, 1, -18, "night", 280, "Wedding", 3800, 170000, 5, "Spotless lawn and a team that thought of everything. The mandap was exactly what we asked for.", "Our wedding, done right"],
    ["kumari", 0, 2, -35, "day", 90, "Anniversary", 1800, 40000, 5, "The painted hall was stunning in the evening light. The Newa bhoj was the best our guests had eaten.", "A hall with a soul"],
    ["lodge", 0, 3, -52, "full_day", 140, "Wedding", 3200, 110000, 4, "Sunrise ceremony facing the peaks, unforgettable. Parking was tight but the staff handled it.", "Magical morning"],
    ["lakeside", 1, 4, -70, "night", 120, "Engagement", 3500, 90000, 5, "Warm service and beautiful lighting. Our families are still talking about the dinner.", "Perfect for an engagement"],
    ["ballroom", 0, 5, -95, "night", 260, "Product launch", 3000, 140000, 4, "Smooth AV and a professional team. Food was good, service could be a little faster.", "Professional and polished"],
    ["darbar", 1, 1, -120, "night", 110, "Birthday", 2200, 60000, 5, "The rooftop at night is a showstopper. Easy to plan with their team.", "Rooftop magic"],
    ["kumari", 1, 3, -150, "day", 210, "Wedding", 2600, 80000, 5, "The courtyard photographs beautifully and the management was always one step ahead.", "Heritage at its best"],
    ["lodge", 1, 4, -180, "night", 70, "Family reunion", 2400, 45000, 4, "Peaceful, scenic and well run. We will be back next year.", "Lovely family weekend"],
  ];
  for (const [venueKey, hallIndex, who, daysAhead, shift, guests, eventType, perPlate, hire, rating, comment, title] of past) {
    const done = await makeBooking({ venueKey, hallIndex, customer: pick(who), daysAhead, shift, guests, eventType, perPlate, hire, status: "completed", settled: true });
    await Review.create({ user: pick(who)._id, venue: venues[venueKey].doc._id, booking: done.booking._id, rating, title, comment });
  }
  // The reviews also feed the "featured reviews" on the landing page
  await Review.updateMany({ venue: { $in: Object.values(venues).map((v) => v.doc._id) }, rating: 5 }, { $set: { isFeatured: true } });

  // A cancelled booking with the refund the venue still owes
  const cancelled = await makeBooking({ venueKey: "lodge", hallIndex: 0, customer: customers[5], daysAhead: 45, shift: "full_day", guests: 100, eventType: "Wedding", perPlate: 3200, hire: 90000, status: "cancelled" });
  await Payment.create({ booking: cancelled.booking._id, type: "refund", provider: "esewa", transactionId: `refund-${cancelled.booking._id}`, amountReceived: -cancelled.quotation.depositAmount, amountNPR: -cancelled.quotation.depositAmount, status: "pending", verifiedAt: new Date() });

  // Requests still in progress: two new, two quoted, one accepted and waiting for the deposit, one declined, one cancelled
  const demoCustomer = accounts.customer;
  const fresh1 = await makeInquiry("kumari", 0, demoCustomer, 75, "night", 100, "Anniversary", "pending", { message: "We would like a quiet dinner for our parents' 30th anniversary. Is the Darbar Hall free that evening?" });
  const fresh2 = await makeInquiry("lakeside", 1, customers[2], 54, "day", 120, "Engagement", "pending", { message: "Looking for a daytime engagement lunch with a lake view. Do you have vegetarian options only?" });
  const quoted1 = await makeInquiry("darbar", 1, demoCustomer, 48, "night", 90, "Birthday", "quoted");
  await makeQuotation(quoted1, "darbar", 1, "night", 2200, 70000, "sent");
  const quoted2 = await makeInquiry("ballroom", 1, customers[3], 40, "day", 200, "Conference lunch", "quoted");
  await makeQuotation(quoted2, "ballroom", 1, "day", 2500, 90000, "sent");
  const accepted = await makeInquiry("lodge", 1, customers[4], 33, "night", 80, "Wedding reception", "accepted");
  await makeQuotation(accepted, "lodge", 1, "night", 2400, 70000, "accepted");
  await makeInquiry("kumari", 1, customers[1], 28, "day", 150, "Wedding", "declined", { fields: { declineReason: "That weekend the courtyard is already held for a festival procession. We can offer the following Saturday." } });
  await makeInquiry("darbar", 0, customers[5], 66, "night", 350, "Wedding", "cancelled", { message: "We may need to change the date." });

  /* chats */
  const chat = async (customer, venueKey, lines) => {
    const c = await Chat.create({ participants: [customer._id, owner._id], venueId: venues[venueKey].doc._id });
    let last;
    let t = Date.now() - lines.length * 20 * 60 * 1000;
    for (const [fromOwner, text, seen] of lines) {
      const sender = fromOwner ? owner : customer;
      const receiver = fromOwner ? customer : owner;
      t += 20 * 60 * 1000;
      last = await Message.create({ chatId: c._id, sender: sender._id, receiver: receiver._id, text, seen, createdAt: new Date(t), updatedAt: new Date(t) });
    }
    await Chat.updateOne({ _id: c._id }, { $set: { lastMessage: { text: last.text, timestamp: last.createdAt }, updatedAt: last.createdAt } }, { timestamps: false });
  };
  await chat(demoCustomer, "kumari", [
    [false, "Hello! Is the Darbar Hall available on the last Saturday of next month?", true],
    [true, "Namaste! Yes, it is free that evening. How many guests are you expecting?", true],
    [false, "About 100 people, a sit-down dinner. Could you send a quotation?", true],
    [true, "Of course. I will send it today with the Newa Bhoj and Heritage Banquet options.", false],
  ]);
  await chat(customers[2], "lakeside", [
    [false, "Do you provide the mandap decoration or should we bring our own decorator?", true],
    [true, "Both work. Our team can decorate, or your decorator can come in the morning before the event.", true],
  ]);

  /* notifications */
  await Notification.create([
    { recipient: owner._id, type: "booking", message: "New inquiry for \"Kumari Heritage Hall\" from a prospective customer.", link: `/owner/inquiries/${fresh1._id}` },
    { recipient: owner._id, type: "booking", message: "New inquiry for \"Lakeside Garden Estate\" from a prospective customer.", link: `/owner/inquiries/${fresh2._id}` },
    { recipient: owner._id, type: "chat", message: "New message from Sunita Gurung", link: "/owner/chat" },
    { recipient: demoCustomer._id, type: "booking", message: "You have a new quotation from \"The Darbar Pavilion\".", link: `/my-inquiries/${quoted1._id}` },
  ]);

  /* the admin's queue: applications, messages and activity */
  const hall = (name, spaceType, capacity) => ({ name, spaceType, capacity });
  const application = (data) => new VenueApplication({ ...sampleDocs, ...data, isDemo: true, status: data.status || "pending" }).save({ validateBeforeSave: false });
  await application({
    venueName: "Mustang Mountain Lodge", venueType: "hotel-resort", about: "A stone lodge in Jomsom with a courtyard for mountain weddings.",
    email: email("applicant1"), phone: "9861000001", contactName: "Tenzin Gurung", location: { province: "Gandaki", city: "Jomsom", area: "Airport Road" },
    halls: [hall("Stone Courtyard", "heritage-courtyards", 150), hall("Fireside Hall", "intimate-halls", 60)],
    venuePhotos: imageList(["mountain", "heritage-lodge", "rooftop"]), panNumber: "600123456",
  });
  await application({
    venueName: "Chitwan Riverside Garden", venueType: "banquet-party-palace", about: "A riverside garden for weddings near Bharatpur.",
    email: email("applicant2"), phone: "9861000002", contactName: "Suman Chaudhary", location: { province: "Bagmati", city: "Bharatpur", area: "Riverside Marg" },
    halls: [hall("Riverside Lawn", "garden-estates", 400)], venuePhotos: imageList(["garden", "spring", "summer"]), panNumber: "600654321",
  });
  await application({
    venueName: "Dharan Heritage House", venueType: "heritage-traditional", about: "A restored Rana-era house for small celebrations.",
    email: email("applicant3"), phone: "9861000003", contactName: "Mina Rai", location: { province: "Koshi", city: "Dharan", area: "Bhanu Chowk" },
    halls: [hall("Rana Parlour", "intimate-halls", 80)], venuePhotos: imageList(["heritage-courtyard", "autumn"]), panNumber: "600789012",
    status: "rejected", rejectionReason: "The registration certificate was not readable. Please apply again with a clearer scan.", reviewedBy: admin._id,
  });
  await Contact.create([
    { name: "Kabita Adhikari", email: email("contact1"), phone: "9841000011", message: "Do you list venues in Biratnagar? We are planning a wedding there next year.", isDemo: true },
    { name: "Dipesh Rana", email: email("contact2"), message: "How do I change the date of a request I already sent?", isDemo: true },
    { name: "Sabina Lama", email: email("contact3"), phone: "9841000013", message: "I own a banquet hall in Butwal and would like to list it. Where do I start?", isDemo: true },
  ]);
  await ActivityLog.create([
    { type: "registration", message: "A new venue application was submitted: Mustang Mountain Lodge", isDemo: true },
    { type: "booking", message: "A booking was confirmed at The Darbar Pavilion", isDemo: true },
    { type: "payment", message: "A deposit of NPR 2,40,000 was paid for Lakeside Garden Estate", isDemo: true },
    { type: "venue", message: "Himalayan Heritage Lodge was approved", isDemo: true },
    { type: "user", message: "Anita Shrestha joined Venure", isDemo: true },
    { type: "booking", message: "A booking at Himalayan Heritage Lodge was cancelled and a refund is owed", isDemo: true },
  ]);

  log("Done.");
  log(`Demo accounts: ${Object.values(DEMO_ACCOUNTS).map((a) => a.email).join(", ")} (no password: use the demo buttons).`);
  log("Venues:", VENUES.map((v) => v.venueName).join(", "));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
