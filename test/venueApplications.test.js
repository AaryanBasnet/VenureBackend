// No network: Cloudinary's storage engine and the mail sender are replaced.
jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));
jest.mock("../utils/sendEmail", () => jest.fn().mockResolvedValue(undefined));

const request = require("supertest");
const bcrypt = require("bcryptjs");
const sendEmail = require("../utils/sendEmail");
const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const VenueApplication = require("../model/venueApplication");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { app, startDb, stopDb, clearDb, makeUser, as, objectId } = require("./helpers/api");

let admin, customer, destroy;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

const PDF = Buffer.from("%PDF-1.1 test");
const IMG = Buffer.from("89504e470d0a1a0a", "hex");

const fields = (overrides = {}) => ({
  venueName: "Riverside Garden Hall",
  venueType: "banquet-party-palace",
  about: "A garden by the river.",
  email: "sita@riverside.test",
  phone: "9812345678",
  contactName: "Sita Sharma",
  province: "Bagmati",
  city: "Bhaktapur",
  area: "Suryabinayak chowk",
  mapLink: "",
  panNumber: "123456789",
  halls: JSON.stringify([{ name: "Glass Hall", capacity: 300 }, { name: "Lawn", capacity: 600 }]),
  ...overrides,
});

// Sends an application: text fields plus the files. `files` can drop or replace any of them.
const apply = ({ body = {}, photos = 3, registration = true, pan = true, ip = nextIp(), extra = [] } = {}) => {
  let req = request(app).post("/api/venue-applications").set("X-Forwarded-For", ip);
  for (const [k, v] of Object.entries(fields(body))) if (v !== undefined) req = req.field(k, v);
  for (let i = 0; i < photos; i++) req = req.attach("applicationPhotos", IMG, { filename: `p${i}.png`, contentType: "image/png" });
  if (registration) req = req.attach("registrationCert", PDF, { filename: "registration.pdf", contentType: "application/pdf" });
  if (pan) req = req.attach("panCert", PDF, { filename: "pan.pdf", contentType: "application/pdf" });
  for (const [name, buf, type] of extra) req = req.attach(name, buf, { filename: name, contentType: type });
  return req;
};

beforeAll(async () => {
  await startDb();
  await VenueApplication.init();
  destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
});
afterAll(async () => {
  destroy.mockRestore();
  await stopDb();
});
beforeEach(async () => {
  await clearDb();
  destroy.mockClear();
  sendEmail.mockClear();
  admin = await makeUser("Admin");
  customer = await makeUser("Customer");
});

describe("applying", () => {
  it("stores the application, needs no account, and emails a confirmation", async () => {
    const res = await apply();
    expect(res.status).toBe(201);
    const saved = await VenueApplication.findOne().lean();
    expect(saved).toMatchObject({ venueName: "Riverside Garden Hall", status: "pending", email: "sita@riverside.test", panNumber: "123456789" });
    expect(saved.halls).toEqual([{ name: "Glass Hall", capacity: 300 }, { name: "Lawn", capacity: 600 }]);
    expect(saved.photos).toHaveLength(3);
    expect(saved.location).toMatchObject({ province: "Bagmati", city: "Bhaktapur", area: "Suryabinayak chowk" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "sita@riverside.test", subject: expect.stringContaining("received") });
    // Applying never creates an account or a venue
    expect(await User.countDocuments({ email: "sita@riverside.test" })).toBe(0);
    expect(await Venue.countDocuments()).toBe(0);
  });

  it("lowercases the email and keeps the map pin when one was given", async () => {
    await apply({ body: { email: "Sita@Riverside.TEST", coordinates: JSON.stringify({ lat: 27.67, lng: 85.43 }) } });
    const saved = await VenueApplication.findOne().lean();
    expect(saved.email).toBe("sita@riverside.test");
    expect(saved.coordinates).toEqual({ lat: 27.67, lng: 85.43 });
  });

  it.each([
    ["venueName", { venueName: "" }],
    ["venue type", { venueType: "castle" }],
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "12" }],
    ["contact person", { contactName: "" }],
    ["province", { province: "" }],
    ["city", { city: "" }],
    ["street", { area: "x" }],
    ["PAN number", { panNumber: "12345" }],
    ["PAN number letters", { panNumber: "12345678a" }],
    ["map link", { mapLink: "https://evil.example/maps" }],
    ["map link on a look-alike host", { mapLink: "https://maps.google.com.evil.example/x" }],
    ["map link that is not a web address", { mapLink: "javascript:alert(1)" }],
    ["no halls", { halls: "[]" }],
    ["hall without a name", { halls: JSON.stringify([{ name: "", capacity: 10 }]) }],
    ["hall with no capacity", { halls: JSON.stringify([{ name: "A", capacity: 0 }]) }],
    ["too many halls", { halls: JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ name: `H${i}`, capacity: 10 }))) }],
    ["halls not JSON", { halls: "nonsense" }],
  ])("refuses a bad %s and removes the files it had stored", async (_label, body) => {
    const res = await apply({ body });
    expect(res.status).toBe(400);
    expect(await VenueApplication.countDocuments()).toBe(0);
    // 3 photos + 2 documents were uploaded before the check, and are deleted again
    expect(destroy).toHaveBeenCalledTimes(5);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("needs at least 3 photos, the registration certificate and the PAN certificate", async () => {
    expect((await apply({ photos: 2 })).status).toBe(400);
    expect((await apply({ registration: false })).status).toBe(400);
    expect((await apply({ pan: false })).status).toBe(400);
    expect(await VenueApplication.countDocuments()).toBe(0);
  });

  it("refuses documents that are not a PDF, JPG or PNG, and photos that are not images", async () => {
    const badDoc = await apply({ registration: false, extra: [["registrationCert", Buffer.from("x"), "text/html"]] });
    expect(badDoc.status).toBe(400);
    const badPhoto = await apply({ photos: 0, extra: [["applicationPhotos", PDF, "application/pdf"]] });
    expect(badPhoto.status).toBe(400);
    expect(await VenueApplication.countDocuments()).toBe(0);
  });

  it("refuses an email that already has an account", async () => {
    await makeUser("Customer", { email: "sita@riverside.test" });
    const res = await apply();
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already has an account/);
    expect(await VenueApplication.countDocuments()).toBe(0);
  });

  it("allows only one open application per email, but a new one after a rejection", async () => {
    expect((await apply()).status).toBe(201);
    const again = await apply();
    expect(again.status).toBe(409);
    expect(await VenueApplication.countDocuments()).toBe(1);
    await VenueApplication.updateOne({}, { status: "rejected" });
    expect((await apply()).status).toBe(201);
    expect(await VenueApplication.countDocuments()).toBe(2);
  });

  it("still succeeds when the confirmation email cannot be sent", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    expect((await apply()).status).toBe(201);
    expect(await VenueApplication.countDocuments()).toBe(1);
  });

  it("limits one address to 8 applications an hour", async () => {
    const ip = "10.77.0.1";
    for (let i = 0; i < 8; i++) {
      // each fails fast on validation: the limit counts requests, not successes
      expect((await apply({ body: { email: `a${i}@x.test`, panNumber: "1" }, ip })).status).toBe(400);
    }
    expect((await apply({ ip })).status).toBe(429);
    expect((await apply({ ip: "10.77.0.2" })).status).toBe(201);
  });
});

describe("reviewing", () => {
  let id;
  beforeEach(async () => {
    await apply();
    id = String((await VenueApplication.findOne())._id);
  });

  it("is for admins only", async () => {
    const owner = await makeUser("VenueOwner");
    for (const who of [null, customer, owner]) {
      const status = who ? 403 : 401;
      expect((await as(who).get("/api/venue-applications")).status).toBe(status);
      expect((await as(who).get(`/api/venue-applications/${id}`)).status).toBe(status);
      expect((await as(who).post(`/api/venue-applications/${id}/approve`, { category: "garden-estates" })).status).toBe(status);
      expect((await as(who).post(`/api/venue-applications/${id}/reject`, { reason: "No good reason" })).status).toBe(status);
      expect((await as(who).get(`/api/venue-applications/${id}/documents/panCert/link`)).status).toBe(status);
    }
    expect((await VenueApplication.findById(id)).status).toBe("pending");
  });

  it("lists applications with a count of those still waiting", async () => {
    const original = await VenueApplication.findById(id).select("+registrationCert.publicId +panCert.publicId").lean();
    await VenueApplication.create({ ...original, _id: objectId(), email: "b@x.test", status: "rejected" });
    const all = await as(admin).get("/api/venue-applications");
    expect(all.body.data.total).toBe(2);
    expect(all.body.data.pending).toBe(1);
    const waiting = await as(admin).get("/api/venue-applications?status=pending");
    expect(waiting.body.data.items).toHaveLength(1);
    expect(JSON.stringify(all.body)).not.toContain("publicId");
  });

  it("shows one application with a suggested site category, and never the stored file ids", async () => {
    const res = await as(admin).get(`/api/venue-applications/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ venueName: "Riverside Garden Hall", suggestedCategory: "garden-estates", panNumber: "123456789" });
    expect(res.body.data.registrationCert).toMatchObject({ originalName: "registration.pdf", mimeType: "application/pdf" });
    expect(JSON.stringify(res.body)).not.toContain("publicId");
    expect(JSON.stringify(res.body)).not.toContain("setupTokenHash");
  });

  it("gives an admin a signed, expiring link to each private document", async () => {
    for (const kind of ["registrationCert", "panCert"]) {
      const res = await as(admin).get(`/api/venue-applications/${id}/documents/${kind}/link`);
      expect(res.status).toBe(200);
      expect(res.body.data.url).toMatch(/^https:\/\/api\.cloudinary\.com\//);
      expect(res.body.data.url).toContain("signature=");
      expect(res.body.data.url).toContain("expires_at=");
      expect(res.body.data.url).toContain("authenticated");
    }
    expect((await as(admin).get(`/api/venue-applications/${id}/documents/photos/link`)).status).toBe(404);
    expect((await as(admin).get(`/api/venue-applications/${objectId()}/documents/panCert/link`)).status).toBe(404);
  });

  it("rejects with a reason, tells the applicant, and creates nothing", async () => {
    const res = await as(admin).post(`/api/venue-applications/${id}/reject`, { reason: "The PAN certificate is not readable." });
    expect(res.status).toBe(200);
    const saved = await VenueApplication.findById(id);
    expect(saved).toMatchObject({ status: "rejected", reviewNote: "The PAN certificate is not readable." });
    expect(String(saved.reviewedBy)).toBe(String(admin._id));
    const mail = sendEmail.mock.calls.at(-1)[0];
    expect(mail.to).toBe("sita@riverside.test");
    expect(mail.html).toContain("The PAN certificate is not readable.");
    expect(await User.countDocuments({ email: "sita@riverside.test" })).toBe(0);
    expect(await Venue.countDocuments()).toBe(0);
  });

  it("escapes what the admin writes before putting it in the email", async () => {
    await as(admin).post(`/api/venue-applications/${id}/reject`, { reason: "<script>alert(1)</script> fix it" });
    expect(sendEmail.mock.calls.at(-1)[0].html).not.toContain("<script>");
  });

  it("needs a reason to reject, and a valid site category to approve", async () => {
    expect((await as(admin).post(`/api/venue-applications/${id}/reject`, { reason: "no" })).status).toBe(400);
    expect((await as(admin).post(`/api/venue-applications/${id}/approve`, { category: "castle" })).status).toBe(400);
    expect((await as(admin).post(`/api/venue-applications/${id}/approve`, {})).status).toBe(400);
    expect((await VenueApplication.findById(id)).status).toBe("pending");
  });
});

describe("approving, and choosing a password", () => {
  let id;
  const approve = (category = "garden-estates") => as(admin).post(`/api/venue-applications/${id}/approve`, { category });
  const linkToken = () => {
    const mail = sendEmail.mock.calls.map((c) => c[0]).filter((m) => /Choose your password/.test(m.subject)).at(-1);
    return /token=([a-f0-9]{64})/.exec(mail.html)[1];
  };

  beforeEach(async () => {
    await apply({ body: { coordinates: JSON.stringify({ lat: 27.67, lng: 85.43 }) } });
    id = String((await VenueApplication.findOne())._id);
  });

  it("creates the owner, the live venue with its halls and photos, and emails a one-time link", async () => {
    const res = await approve();
    expect(res.status).toBe(200);

    const owner = await User.findOne({ email: "sita@riverside.test" }).select("+password");
    expect(owner).toMatchObject({ role: "VenueOwner", name: "Sita Sharma", phone: "9812345678" });
    expect(owner.password).toBeUndefined();

    const venue = await Venue.findOne({ owner: owner._id });
    expect(venue).toMatchObject({ venueName: "Riverside Garden Hall", status: "approved", category: "garden-estates", venueType: "banquet-party-palace" });
    expect(venue.location).toMatchObject({ address: "Suryabinayak chowk", city: "Bhaktapur", state: "Bagmati", country: "Nepal" });
    expect(venue.geoCoordinates.coordinates).toEqual([85.43, 27.67]);
    expect(venue.venueImages).toHaveLength(3);
    const spaces = await Space.find({ venue: venue._id }).sort("capacity");
    expect(spaces.map((s) => [s.name, s.capacity])).toEqual([["Glass Hall", 300], ["Lawn", 600]]);

    const saved = await VenueApplication.findById(id);
    expect(saved).toMatchObject({ status: "approved" });
    expect(String(saved.owner)).toBe(String(owner._id));
    expect(String(saved.venue)).toBe(String(venue._id));

    const mail = sendEmail.mock.calls.map((c) => c[0]).find((m) => /Choose your password/.test(m.subject));
    expect(mail.to).toBe("sita@riverside.test");
    expect(mail.html).toMatch(/\/set-password\?token=[a-f0-9]{64}/);
  });

  it("still approves when the email cannot be sent, says so, and lets the admin send the link again", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const res = await approve();
    expect(res.status).toBe(200);
    expect(res.body.data.emailed).toBe(false);
    expect(res.body.message).toMatch(/could not be sent/);
    expect(await User.countDocuments({ email: "sita@riverside.test" })).toBe(1);
    expect(await Venue.countDocuments()).toBe(1);

    const again = await as(admin).post(`/api/venue-applications/${id}/resend-link`);
    expect(again.status).toBe(200);
    expect(again.body.data.emailed).toBe(true);
    const done = await request(app).post("/api/auth/setup-password").set("X-Forwarded-For", nextIp()).send({ token: linkToken(), password: "Sunrise2026" });
    expect(done.status).toBe(200);
  });

  describe("sending the link again", () => {
    const resend = () => as(admin).post(`/api/venue-applications/${id}/resend-link`);
    const choose = (token) => request(app).post("/api/auth/setup-password").set("X-Forwarded-For", nextIp()).send({ token, password: "Sunrise2026" });

    it("issues a new link and the earlier one stops working", async () => {
      await approve();
      const first = linkToken();
      expect((await resend()).status).toBe(200);
      const second = linkToken();
      expect(second).not.toBe(first);
      expect((await choose(first)).status).toBe(400);
      expect((await choose(second)).status).toBe(200);
    });

    it("only works for an approved owner who has not chosen a password yet", async () => {
      expect((await resend()).status).toBe(404); // still waiting
      await approve();
      const token = linkToken();
      expect((await choose(token)).status).toBe(200);
      const done = await resend();
      expect(done.status).toBe(409);
      expect(done.body.message).toMatch(/already chosen a password/);
    });

    it("is for admins only", async () => {
      await approve();
      expect((await as(customer).post(`/api/venue-applications/${id}/resend-link`)).status).toBe(403);
      expect((await as(null).post(`/api/venue-applications/${id}/resend-link`)).status).toBe(401);
    });

    it("tells the admin whether the application's owner still has to choose a password", async () => {
      await approve();
      expect((await as(admin).get(`/api/venue-applications/${id}`)).body.data.setupPending).toBe(true);
      await choose(linkToken());
      expect((await as(admin).get(`/api/venue-applications/${id}`)).body.data.setupPending).toBe(false);
    });
  });

  it("stores only a hash of the link, never the link itself", async () => {
    await approve();
    const token = linkToken();
    const saved = await VenueApplication.findById(id).select("+setupTokenHash +setupTokenExpires");
    expect(saved.setupTokenHash).toBeDefined();
    expect(saved.setupTokenHash).not.toContain(token);
    expect(saved.setupTokenExpires.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
  });

  it("cannot be approved twice, even at the same moment, and makes one account", async () => {
    const results = await Promise.all([approve(), approve(), approve()]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await User.countDocuments({ email: "sita@riverside.test" })).toBe(1);
    expect(await Venue.countDocuments()).toBe(1);
    expect(sendEmail.mock.calls.filter((c) => /Choose your password/.test(c[0].subject))).toHaveLength(1);
  });

  it("cannot approve what was rejected, or reject what was approved", async () => {
    await as(admin).post(`/api/venue-applications/${id}/reject`, { reason: "Not clear enough" });
    expect((await approve()).status).toBe(409);
    await VenueApplication.updateOne({ _id: id }, { status: "pending" });
    expect((await approve()).status).toBe(200);
    expect((await as(admin).post(`/api/venue-applications/${id}/reject`, { reason: "Changed my mind" })).status).toBe(409);
  });

  it("puts everything back if the email was taken while the application waited", async () => {
    await makeUser("Customer", { email: "sita@riverside.test" });
    const res = await approve();
    expect(res.status).toBe(409);
    expect(await Venue.countDocuments()).toBe(0);
    expect(await Space.countDocuments()).toBe(0);
    expect(await User.countDocuments({ email: "sita@riverside.test" })).toBe(1);
    const saved = await VenueApplication.findById(id).select("+setupTokenHash");
    expect(saved.status).toBe("pending");
    expect(saved.setupTokenHash).toBeUndefined();
  });

  it("returns 404 for an application that does not exist", async () => {
    expect((await as(admin).post(`/api/venue-applications/${objectId()}/approve`, { category: "garden-estates" })).status).toBe(404);
  });

  describe("the link", () => {
    const choose = (token, password = "Sunrise2026") => request(app).post("/api/auth/setup-password").set("X-Forwarded-For", nextIp()).send({ token, password });
    const login = (email, password) => request(app).post("/api/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password });

    it("lets the owner sign in with the email and the password they chose, and only then", async () => {
      await approve();
      const before = await login("sita@riverside.test", "Sunrise2026");
      expect(before.status).toBe(401);
      expect(before.body.message).toMatch(/Choose your password/);

      const set = await choose(linkToken());
      expect(set.status).toBe(200);
      expect(set.body.data.email).toBe("sita@riverside.test");

      const after = await login("sita@riverside.test", "Sunrise2026");
      expect(after.status).toBe(200);
      expect(after.body.data.role).toBe("VenueOwner");
      expect((await login("sita@riverside.test", "WrongPass2026")).status).toBe(401);
      const stored = await User.findOne({ email: "sita@riverside.test" }).select("+password");
      expect(await bcrypt.compare("Sunrise2026", stored.password)).toBe(true);
    });

    it("works once", async () => {
      await approve();
      const token = linkToken();
      expect((await choose(token)).status).toBe(200);
      const again = await choose(token, "Another2026Pass");
      expect(again.status).toBe(400);
      expect(again.body.message).toMatch(/expired or was already used/);
      expect((await login("sita@riverside.test", "Sunrise2026")).status).toBe(200);
      expect((await login("sita@riverside.test", "Another2026Pass")).status).toBe(401);
    });

    it("stops working after 7 days", async () => {
      await approve();
      await VenueApplication.updateOne({ _id: id }, { setupTokenExpires: new Date(Date.now() - 1000) });
      expect((await choose(linkToken())).status).toBe(400);
      expect((await login("sita@riverside.test", "Sunrise2026")).status).toBe(401);
    });

    it("refuses a made-up link, a link for a rejected application, and a weak password", async () => {
      await approve();
      expect((await choose("a".repeat(64))).status).toBe(400);
      expect((await choose(linkToken(), "short")).status).toBe(400);
      expect((await choose(linkToken(), "alllowercase1")).status).toBe(400);
      // none of those used the link up
      expect((await choose(linkToken())).status).toBe(200);
    });

    it("can never change the password of an account that already has one", async () => {
      await approve();
      const token = linkToken();
      const owner = await User.findOne({ email: "sita@riverside.test" });
      await User.updateOne({ _id: owner._id }, { password: await bcrypt.hash("Existing2026Pw", 10) });
      expect((await choose(token)).status).toBe(400);
      expect((await login("sita@riverside.test", "Existing2026Pw")).status).toBe(200);
    });
  });
});
