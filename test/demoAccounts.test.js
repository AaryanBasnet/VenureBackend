// The one-click demo accounts: they sign in without a password, change almost nothing, and the demo admin can never
// see a real person's data (applicants, accounts, venues, reviews, messages, bookings, activity).
const Inquiry = require("../model/inquiry");
const Notification = require("../model/notification");
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const Review = require("../model/review");
const Contact = require("../model/contact");
const ActivityLog = require("../model/activityLog");
const VenueApplication = require("../model/venueApplication");
const { DEMO_ACCOUNTS } = require("../config/demoAccounts");
const { app, request, startDb, stopDb, clearDb, makeUser, as, makeVenue, makeSpace, objectId } = require("./helpers/api");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const DAY = 24 * 60 * 60 * 1000;
const demoUser = (key) => makeUser(DEMO_ACCOUNTS[key].role, { name: DEMO_ACCOUNTS[key].name, email: DEMO_ACCOUNTS[key].email, isDemo: true });
const inquiryBody = (venue, extra = {}) => ({
  venue: String(venue._id), preferredDate: new Date(Date.now() + 30 * DAY).toISOString(), numberOfGuests: 50,
  eventType: "Wedding", contactName: "Demo", phoneNumber: "9800000000", ...extra,
});

describe("signing in with one click", () => {
  it("opens a session for each demo account and says it is a demo", async () => {
    for (const key of ["customer", "owner", "admin"]) {
      const user = await demoUser(key);
      const res = await request(app).post("/api/auth/demo").send({ role: key });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ _id: String(user._id), role: DEMO_ACCOUNTS[key].role, isDemo: true });
      expect(res.headers["set-cookie"].join(";")).toMatch(/accessToken=/);
    }
  });

  it("says so when the demo is not set up, and refuses an unknown account", async () => {
    expect((await request(app).post("/api/auth/demo").send({ role: "owner" })).status).toBe(404);
    expect((await request(app).post("/api/auth/demo").send({ role: "superuser" })).status).toBe(400);
    expect((await request(app).post("/api/auth/demo").send({})).status).toBe(400);
  });

  it("a real account with the demo's role is never reachable this way", async () => {
    await makeUser("Admin", { email: DEMO_ACCOUNTS.admin.email }); // same address, but not flagged as a demo
    expect((await request(app).post("/api/auth/demo").send({ role: "admin" })).status).toBe(404);
  });
});

describe("what the demo accounts may change", () => {
  it("the demo admin and the demo owner can read but every write is refused", async () => {
    const admin = await demoUser("admin");
    const owner = await demoUser("owner");
    const venue = await makeVenue(owner, { isDemo: true, status: "pending" });
    const status = await as(admin).patch(`/api/venues/${venue._id}/status`, { status: "approved" });
    expect(status.status).toBe(403);
    expect(status.body.message).toMatch(/demo account/);
    expect((await Venue.findById(venue._id)).status).toBe("pending");
    expect((await as(owner).put(`/api/venues/${venue._id}`, { venueName: "Hijacked" })).status).toBe(403);
    expect((await as(owner).get("/api/venues/owner/me")).status).toBe(200);
  });

  it("the demo customer cannot edit the profile, review or cancel, but can read", async () => {
    const customer = await demoUser("customer");
    expect((await as(customer).put("/api/user/profile", { name: "Changed" })).status).toBe(403);
    expect((await as(customer).get("/api/inquiries/my")).status).toBe(200);
  });

  it("the demo customer can send a request to a demo venue, and it expires after a day", async () => {
    const customer = await demoUser("customer");
    const owner = await demoUser("owner");
    const venue = await makeVenue(owner, { isDemo: true });
    const res = await as(customer).post("/api/inquiries", inquiryBody(venue));
    expect(res.status).toBe(201);
    const stored = await Inquiry.findById(res.body.data._id).lean();
    expect(stored.expireAt.getTime()).toBeGreaterThan(Date.now() + DAY - 60 * 1000);
    const note = await Notification.findOne({ recipient: owner._id }).lean();
    expect(note.expireAt).toBeDefined();
  });

  it("but not to a real venue, and only a few a day", async () => {
    const customer = await demoUser("customer");
    const realOwner = await makeUser("VenueOwner");
    const real = await makeVenue(realOwner);
    const refused = await as(customer).post("/api/inquiries", inquiryBody(real));
    expect(refused.status).toBe(403);
    expect(await Inquiry.countDocuments()).toBe(0);

    const demoOwner = await demoUser("owner");
    const demoVenue = await makeVenue(demoOwner, { isDemo: true });
    for (let i = 0; i < 5; i++) expect((await as(customer).post("/api/inquiries", inquiryBody(demoVenue))).status).toBe(201);
    expect((await as(customer).post("/api/inquiries", inquiryBody(demoVenue))).status).toBe(429);
  });

  it("a real customer's requests never get an expiry", async () => {
    const customer = await makeUser("Customer");
    const owner = await makeUser("VenueOwner");
    const venue = await makeVenue(owner);
    const res = await as(customer).post("/api/inquiries", inquiryBody(venue));
    expect(res.status).toBe(201);
    expect((await Inquiry.findById(res.body.data._id).lean()).expireAt).toBeUndefined();
  });
});

describe("the demo admin never sees real people", () => {
  const SECRET = "Real-Person-Secret";
  let demoAdmin;
  let realAdmin;

  beforeEach(async () => {
    demoAdmin = await demoUser("admin");
    realAdmin = await makeUser("Admin");
    const realOwner = await makeUser("VenueOwner", { name: `${SECRET} Owner`, email: "real.owner@real.test" });
    const demoOwner = await demoUser("owner");
    const realCustomer = await makeUser("Customer", { name: `${SECRET} Customer`, email: "real.customer@real.test" });
    const demoCustomer = await demoUser("customer");

    const realVenue = await makeVenue(realOwner, { venueName: `${SECRET} Hall` });
    const demoVenue = await makeVenue(demoOwner, { venueName: "Demo Hall", isDemo: true });
    const realSpace = await makeSpace(realVenue);
    const demoSpace = await makeSpace(demoVenue);

    const booking = (venue, space, customer, price) => {
      const startTime = new Date(Date.now() + 10 * DAY);
      return Booking.create({
        customer: customer._id, venue: venue._id, space: space._id, eventDate: startTime, shift: "day", startTime,
        endTime: new Date(startTime.getTime() + 3600 * 1000), numberOfGuests: 50, eventType: "Wedding", contactName: "x", phoneNumber: "9800000000",
        totalPrice: price, depositAmount: 1000, balanceAmount: price - 1000, status: "confirmed",
      });
    };
    await booking(realVenue, realSpace, realCustomer, 100000);
    await booking(demoVenue, demoSpace, demoCustomer, 50000);

    await Review.create({ user: realCustomer._id, venue: realVenue._id, booking: objectId(), rating: 5, title: `${SECRET} review`, comment: `${SECRET} comment` });
    await Review.create({ user: demoCustomer._id, venue: demoVenue._id, booking: objectId(), rating: 4, title: "Demo review", comment: "Demo comment" });
    await Contact.create({ name: `${SECRET} Contact`, email: "c@real.test", message: `${SECRET} message` });
    await Contact.create({ name: "Demo Contact", email: "c@demo.test", message: "Demo message", isDemo: true });
    await ActivityLog.create({ type: "user", message: `${SECRET} signed up` });
    await ActivityLog.create({ type: "user", message: "Demo signed up", isDemo: true });

    const application = (overrides) => new VenueApplication({ venueName: "x", email: "x@x.test", ...overrides }).save({ validateBeforeSave: false });
    realApplication = await application({ venueName: `${SECRET} Application`, email: "real.applicant@real.test", contactName: SECRET });
    demoApplication = await application({ venueName: "Demo Application", email: "demo.applicant@demo.test", isDemo: true });
  });
  let realApplication;
  let demoApplication;

  const leaks = (res) => JSON.stringify(res.body).includes(SECRET) || JSON.stringify(res.body).includes("@real.test");

  it("every admin list shows only demo records", async () => {
    const paths = [
      "/api/user/admin/all?page=1&limit=50",
      "/api/venues/admin/all",
      "/api/admin/reviews?page=1&limit=50",
      "/api/admin/activity-logs",
      "/api/contact/admin/all",
      "/api/venue-applications",
    ];
    for (const path of paths) {
      const res = await as(demoAdmin).get(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect([path, leaks(res)]).toEqual([path, false]);
      expect([path, /[Dd]emo/.test(JSON.stringify(res.body))]).toEqual([path, true]);
    }
  });

  it("a real admin still sees everything", async () => {
    for (const path of ["/api/user/admin/all?page=1&limit=50", "/api/venues/admin/all", "/api/admin/reviews?page=1&limit=50", "/api/admin/activity-logs", "/api/contact/admin/all", "/api/venue-applications"]) {
      expect([path, leaks(await as(realAdmin).get(path))]).toEqual([path, true]);
    }
  });

  it("the numbers add up only the demo records", async () => {
    expect((await as(demoAdmin).get("/api/user/admin/customers/total")).body.data).toBe(1);
    expect((await as(realAdmin).get("/api/user/admin/customers/total")).body.data).toBe(2);
    expect((await as(demoAdmin).get("/api/venues/admin/approved-count")).body.data.count).toBe(1);
    expect((await as(realAdmin).get("/api/venues/admin/approved-count")).body.data.count).toBe(2);
    expect((await as(demoAdmin).get("/api/bookings/total")).body.data).toBe(1);
    expect((await as(realAdmin).get("/api/bookings/total")).body.data).toBe(2);
    const demoEarnings = (await as(demoAdmin).get("/api/admin/earnings/monthly")).body.data.reduce((sum, m) => sum + m.totalEarnings, 0);
    expect(demoEarnings).toBe(50000);
  });

  it("a real person's record cannot be opened by id", async () => {
    const realUser = await makeUser("Customer", { name: `${SECRET} Other` });
    expect((await as(demoAdmin).get(`/api/user/admin/${realUser._id}`)).status).toBe(404);
    expect((await as(realAdmin).get(`/api/user/admin/${realUser._id}`)).status).toBe(200);
    expect((await as(demoAdmin).get(`/api/venue-applications/${realApplication._id}`)).status).toBe(404);
    expect((await as(demoAdmin).get(`/api/venue-applications/${demoApplication._id}`)).status).toBe(200);
    expect((await as(demoAdmin).get(`/api/venue-applications/${realApplication._id}/documents/registrationCert/link`)).status).toBe(404);
  });

  it("the pending count only counts demo applications", async () => {
    expect((await as(demoAdmin).get("/api/venue-applications")).body.data.pending).toBe(1);
    expect((await as(realAdmin).get("/api/venue-applications")).body.data.pending).toBe(2);
  });
});

describe("a demo admin cannot open a real request or quotation by its id", () => {
  it("403 for a real request, 200 for a demo one, and a real admin can open both", async () => {
    const demoAdmin = await demoUser("admin");
    const realAdmin = await makeUser("Admin");
    const customer = await makeUser("Customer");
    const realVenue = await makeVenue(await makeUser("VenueOwner"));
    const demoVenue = await makeVenue(await makeUser("VenueOwner"), { isDemo: true });
    const ask = (venue) => Inquiry.create({ customer: customer._id, venue: venue._id, preferredDate: new Date(Date.now() + 30 * DAY), numberOfGuests: 50, eventType: "Wedding", contactName: "J", phoneNumber: "9800000000" });
    const real = await ask(realVenue);
    const demo = await ask(demoVenue);
    expect((await as(demoAdmin).get(`/api/inquiries/${real._id}`)).status).toBe(403);
    expect((await as(demoAdmin).get(`/api/inquiries/${demo._id}`)).status).toBe(200);
    expect((await as(realAdmin).get(`/api/inquiries/${real._id}`)).status).toBe(200);
    expect((await as(realAdmin).get(`/api/inquiries/${demo._id}`)).status).toBe(200);
  });
});
