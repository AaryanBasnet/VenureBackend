// Venue owners managing their own venues and spaces. Image uploads run against an in-process stand-in for Cloudinary.
jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));

const mongoose = require("mongoose");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { startDb, stopDb, makeUser, as, makeVenue, makeSpace, objectId, location } = require("./helpers/api");

let owner;
let otherOwner;
let admin;
let customer;
let destroy;

beforeAll(async () => {
  await startDb();
  destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
  owner = await makeUser("VenueOwner");
  otherOwner = await makeUser("VenueOwner");
  admin = await makeUser("Admin");
  customer = await makeUser("Customer");
});

afterAll(async () => {
  destroy.mockRestore();
  await stopDb();
});

beforeEach(async () => {
  destroy.mockClear();
  await Promise.all([Venue.deleteMany({}), Space.deleteMany({}), Booking.deleteMany({})]);
});

const newVenue = (extra = {}) => ({
  venueName: "Himalayan Vista Resort",
  category: "mountain-retreats",
  description: "Views of the Annapurna range",
  amenities: ["Wifi", "Parking"],
  location,
  ...extra,
});

const gold = { name: "Gold Package", tagline: "Classic Nepali celebration", pricePerPlate: 2850, minPlates: 60, highlights: ["Bara, choila", "Sekuwa with pulao"] };
const silver = { name: "Silver Package", pricePerPlate: 1900 };

const jpeg = Buffer.from("ffd8ffe000104a464946", "hex");
const attach = (req, name = "hall.jpg") => req.attach("venueImages", jpeg, { filename: name, contentType: "image/jpeg" });

const bookingFor = async (venue, space, { status = "confirmed", daysFromNow = 10 } = {}) => {
  const startTime = new Date(Date.now() + daysFromNow * 86400000);
  return Booking.create({
    customer: customer._id,
    venue: venue._id,
    space: space._id,
    startTime,
    endTime: new Date(startTime.getTime() + 3 * 3600000),
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Guest",
    phoneNumber: "9800000000",
    totalPrice: 100000,
    depositAmount: 20000,
    balanceAmount: 80000,
    status,
  });
};

describe("POST /api/venues (create)", () => {
  it("creates a pending venue owned by the caller, with packages, drinks and a contact phone", async () => {
    const res = await as(owner).post("/api/venues", newVenue({
      packages: [gold, silver],
      drinkOptions: [{ name: "Hard drinks", description: "Per bottle", items: ["Beer", "Whisky"] }],
      contactPhone: "+977 9800000000",
      geoCoordinates: { longitude: 85.5, latitude: 27.7 },
    }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, message: "Venue created successfully" });
    const data = res.body.data;
    expect(data).toMatchObject({
      venueName: "Himalayan Vista Resort",
      category: "mountain-retreats",
      status: "pending",
      isFeatured: false,
      isDeleted: false,
      owner: String(owner._id),
      contactPhone: "+977 9800000000",
      minPricePerPlate: 1900,
    });
    expect(data.packages).toHaveLength(2);
    expect(data.packages[0]).toMatchObject({ name: "Gold Package", pricePerPlate: 2850, minPlates: 60 });
    expect(data.drinkOptions[0]).toMatchObject({ name: "Hard drinks", items: ["Beer", "Whisky"] });
    expect(data.geoCoordinates.coordinates).toEqual([85.5, 27.7]);

    const stored = await Venue.findById(data._id).lean();
    expect(String(stored.owner)).toBe(String(owner._id));
  });

  it("defaults to no packages, drinks or amenities", async () => {
    const res = await as(owner).post("/api/venues", { venueName: "Bare Hall", category: "intimate-halls", location });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ packages: [], drinkOptions: [], amenities: [], minPricePerPlate: null });
  });

  it("is not visible to the public until an admin approves it", async () => {
    const created = await as(owner).post("/api/venues", newVenue());
    expect((await as(null).get(`/api/venues/${created.body.data._id}`)).status).toBe(404);
    expect((await as(null).get("/api/venues")).body.data).toEqual([]);
  });

  it("cannot be used to self-approve, feature or assign another owner (unknown fields are dropped)", async () => {
    const res = await as(owner).post("/api/venues", newVenue({ status: "approved", isFeatured: true, owner: String(otherOwner._id), isDeleted: true, averageRating: 5 }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "pending", isFeatured: false, isDeleted: false, owner: String(owner._id), averageRating: 0 });
  });

  it.each([
    ["no name", { venueName: undefined }, /venueName/],
    ["a one letter name", { venueName: "A" }, /at least 2 characters/],
    ["no category", { category: undefined }, /Select a venue category/],
    ["an unknown category", { category: "castle" }, /Select a venue category/],
    ["no location", { location: undefined }, /location/],
    ["an incomplete location", { location: { address: "x", city: "y" } }, /location/],
    ["a negative package price", { packages: [{ ...gold, pricePerPlate: -1 }] }, /pricePerPlate/],
    ["more than six packages", { packages: Array(7).fill(gold) }, /packages/],
    ["more than six drink options", { drinkOptions: Array(7).fill({ name: "Bar" }) }, /drinkOptions/],
    ["a phone number that is not a phone number", { contactPhone: "call me" }, /valid phone number/],
  ])("rejects %s with 400 and creates nothing", async (_label, override, pattern) => {
    const res = await as(owner).post("/api/venues", newVenue(override));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Validation Error/);
    expect(res.body.message).toMatch(pattern);
    expect(await Venue.countDocuments()).toBe(0);
  });

  it("only venue owners can create: customers and admins get 403, visitors 401", async () => {
    expect((await as(customer).post("/api/venues", newVenue())).status).toBe(403);
    expect((await as(admin).post("/api/venues", newVenue())).status).toBe(403);
    expect((await as(null).post("/api/venues", newVenue())).status).toBe(401);
    expect(await Venue.countDocuments()).toBe(0);
  });
});

describe("GET /api/venues/owner/me and /owner/approved-count", () => {
  it("lists only my venues (pending, approved and rejected), newest first, never deleted ones", async () => {
    await makeVenue(owner, { venueName: "First", status: "approved" });
    await makeVenue(owner, { venueName: "Second", status: "pending" });
    await makeVenue(owner, { venueName: "Third", status: "rejected" });
    await makeVenue(owner, { venueName: "Removed", isDeleted: true });
    await makeVenue(otherOwner, { venueName: "Not Mine" });

    const res = await as(owner).get("/api/venues/owner/me");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.venues.map((v) => v.venueName)).toEqual(["Third", "Second", "First"]);
    expect(res.body.data).toMatchObject({ total: 3, pages: 1 });
    expect(res.body.data.venues[0]).not.toHaveProperty("priceSortKey");
  });

  it("paginates", async () => {
    for (let i = 1; i <= 5; i++) await makeVenue(owner, { venueName: `V${i}` });
    const first = await as(owner).get("/api/venues/owner/me?limit=2&page=1");
    const last = await as(owner).get("/api/venues/owner/me?limit=2&page=3");
    expect(first.body.data).toMatchObject({ total: 5, pages: 3 });
    expect(first.body.data.venues.map((v) => v.venueName)).toEqual(["V5", "V4"]);
    expect(last.body.data.venues.map((v) => v.venueName)).toEqual(["V1"]);
  });

  it("counts only my approved, live venues", async () => {
    await makeVenue(owner, { status: "approved" });
    await makeVenue(owner, { status: "approved" });
    await makeVenue(owner, { status: "pending" });
    await makeVenue(owner, { status: "approved", isDeleted: true });
    await makeVenue(otherOwner, { status: "approved" });
    const res = await as(owner).get("/api/venues/owner/approved-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { count: 2 } });
  });

  it("is for venue owners only", async () => {
    for (const path of ["/api/venues/owner/me", "/api/venues/owner/approved-count"]) {
      expect((await as(customer).get(path)).status).toBe(403);
      expect((await as(admin).get(path)).status).toBe(403);
      expect((await as(null).get(path)).status).toBe(401);
    }
  });
});

describe("PUT /api/venues/:id (update)", () => {
  it("updates details, packages, drinks and contact phone, and keeps the cheapest price in step", async () => {
    const venue = await makeVenue(owner, { packages: [gold] });
    const res = await as(owner).put(`/api/venues/${venue._id}`, {
      venueName: "Renamed Hall",
      description: "New description",
      amenities: ["AC"],
      packages: [silver, gold],
      drinkOptions: [{ name: "Soft drinks", items: ["Coke"] }],
      contactPhone: "9801234567",
      location: { ...location, city: "Pokhara" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Venue updated successfully" });
    expect(res.body.data).toMatchObject({ venueName: "Renamed Hall", description: "New description", amenities: ["AC"], contactPhone: "9801234567", minPricePerPlate: 1900 });
    expect(res.body.data.location.city).toBe("Pokhara");
    expect(res.body.data.drinkOptions[0].name).toBe("Soft drinks");

    const stored = await Venue.findById(venue._id).select("+priceSortKey").lean();
    expect(stored.priceSortKey).toBe(1900);
    expect(stored.packages.map((p) => p.name)).toEqual(["Silver Package", "Gold Package"]);
  });

  it("changes only what was sent", async () => {
    const venue = await makeVenue(owner, { venueName: "Keep Me", description: "Keep this", packages: [gold] });
    const res = await as(owner).put(`/api/venues/${venue._id}`, { contactPhone: "9801234567" });
    expect(res.body.data).toMatchObject({ venueName: "Keep Me", description: "Keep this", contactPhone: "9801234567" });
    expect(res.body.data.packages).toHaveLength(1);
  });

  it("removes packages when an empty list is sent, and clears the contact phone with an empty string", async () => {
    const venue = await makeVenue(owner, { packages: [gold], contactPhone: "9801234567" });
    const res = await as(owner).put(`/api/venues/${venue._id}`, { packages: [], contactPhone: "" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ packages: [], minPricePerPlate: null, contactPhone: "" });
  });

  it("accepts multipart form data with JSON strings, as the web form sends it", async () => {
    const venue = await makeVenue(owner);
    const res = await as(owner)
      .multipart("put", `/api/venues/${venue._id}`)
      .field("venueName", "Form Hall")
      .field("packages", JSON.stringify([gold]))
      .field("amenities", JSON.stringify(["Garden"]));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ venueName: "Form Hall", amenities: ["Garden"], minPricePerPlate: 2850 });
  });

  it("appends newly uploaded images to the existing ones", async () => {
    const venue = await makeVenue(owner, { venueImages: [{ filename: "old", url: "https://res.cloudinary.com/test/old.jpg" }] });
    const res = await attach(as(owner).multipart("put", `/api/venues/${venue._id}`).field("venueName", "With Photos"), "new.jpg");
    expect(res.status).toBe(200);
    expect(res.body.data.venueImages.map((i) => i.url)).toEqual([
      "https://res.cloudinary.com/test/old.jpg",
      "https://res.cloudinary.com/test/venueImages/new.jpg",
    ]);
  });

  it("cannot be used to change status, featured flag, owner, rating or deleted flag", async () => {
    const venue = await makeVenue(owner, { status: "pending" });
    const res = await as(owner).put(`/api/venues/${venue._id}`, { venueName: "Sneaky Hall", status: "approved", isFeatured: true, owner: String(otherOwner._id), averageRating: 5, isDeleted: true });
    expect(res.status).toBe(200);
    const stored = await Venue.findById(venue._id).lean();
    expect(stored).toMatchObject({ venueName: "Sneaky Hall", status: "pending", isFeatured: false, isDeleted: false, averageRating: 0 });
    expect(String(stored.owner)).toBe(String(owner._id));
  });

  it("is a 404 for someone else's venue, a deleted venue or an unknown one, and nothing changes", async () => {
    const mine = await makeVenue(owner, { venueName: "Mine" });
    const removed = await makeVenue(owner, { isDeleted: true });

    for (const id of [mine._id, removed._id, objectId()]) {
      const res = await as(otherOwner).put(`/api/venues/${id}`, { venueName: "Stolen" });
      expect(res.status).toBe(404);
    }
    expect((await as(owner).put(`/api/venues/${removed._id}`, { venueName: "Zombie" })).status).toBe(404);
    expect((await Venue.findById(mine._id)).venueName).toBe("Mine");
  });

  it("deletes images that were uploaded for a venue the caller does not own", async () => {
    const venue = await makeVenue(owner);
    const res = await attach(as(otherOwner).multipart("put", `/api/venues/${venue._id}`).field("venueName", "Nope"), "stray.jpg");
    expect(res.status).toBe(404);
    expect(destroy).toHaveBeenCalledWith("test/stray.jpg");
    expect((await Venue.findById(venue._id)).venueImages).toHaveLength(0);
  });

  it.each([
    ["a one letter name", { venueName: "A" }, /at least 2 characters/],
    ["an unknown category", { category: "castle" }, /category/],
    ["a bad phone number", { contactPhone: "abc" }, /valid phone number/],
    ["too many packages", { packages: Array(7).fill(gold) }, /packages/],
  ])("rejects %s with 400", async (_label, body, pattern) => {
    const venue = await makeVenue(owner, { venueName: "Unchanged" });
    const res = await as(owner).put(`/api/venues/${venue._id}`, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect((await Venue.findById(venue._id)).venueName).toBe("Unchanged");
  });

  it("is for venue owners only", async () => {
    const venue = await makeVenue(owner);
    expect((await as(admin).put(`/api/venues/${venue._id}`, { venueName: "Admin Edit" })).status).toBe(403);
    expect((await as(customer).put(`/api/venues/${venue._id}`, { venueName: "Customer Edit" })).status).toBe(403);
    expect((await as(null).put(`/api/venues/${venue._id}`, { venueName: "Anon Edit" })).status).toBe(401);
  });
});

describe("POST /api/venues/:id/images", () => {
  it("adds the uploaded photos to my venue", async () => {
    const venue = await makeVenue(owner);
    const req = as(owner).multipart("post", `/api/venues/${venue._id}/images`);
    attach(req, "one.jpg");
    attach(req, "two.jpg");
    const res = await req;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Images uploaded successfully" });
    expect(res.body.data.venueImages).toEqual([
      { filename: "test/one.jpg", url: "https://res.cloudinary.com/test/venueImages/one.jpg" },
      { filename: "test/two.jpg", url: "https://res.cloudinary.com/test/venueImages/two.jpg" },
    ]);
  });

  it("answers 400 when no image was sent", async () => {
    const venue = await makeVenue(owner);
    const res = await as(owner).post(`/api/venues/${venue._id}/images`, {});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("No images provided");
  });

  it("rejects files that are not images, and more than 10 files", async () => {
    const venue = await makeVenue(owner);
    const notImage = await as(owner)
      .multipart("post", `/api/venues/${venue._id}/images`)
      .attach("venueImages", Buffer.from("text"), { filename: "a.txt", contentType: "text/plain" });
    expect(notImage.status).toBe(400);
    expect(notImage.body.message).toContain("Only image files are allowed");

    const req = as(owner).multipart("post", `/api/venues/${venue._id}/images`);
    for (let i = 0; i < 11; i++) attach(req, `p${i}.jpg`);
    expect((await req).status).toBe(400);
    expect((await Venue.findById(venue._id)).venueImages).toHaveLength(0);
  });

  it("404 for someone else's venue, and the stray upload is cleaned up", async () => {
    const venue = await makeVenue(owner);
    const res = await attach(as(otherOwner).multipart("post", `/api/venues/${venue._id}/images`), "stray.jpg");
    expect(res.status).toBe(404);
    expect(destroy).toHaveBeenCalledWith("test/stray.jpg");
    expect((await Venue.findById(venue._id)).venueImages).toHaveLength(0);
  });

  it("is for venue owners only", async () => {
    const venue = await makeVenue(owner);
    expect((await attach(as(customer).multipart("post", `/api/venues/${venue._id}/images`))).status).toBe(403);
    expect((await attach(as(null).multipart("post", `/api/venues/${venue._id}/images`))).status).toBe(401);
  });
});

describe("DELETE /api/venues/:id (soft delete)", () => {
  it("hides the venue everywhere but keeps the record", async () => {
    const venue = await makeVenue(owner);
    const res = await as(owner).delete(`/api/venues/${venue._id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Venue removed successfully" });

    expect((await Venue.findById(venue._id).lean()).isDeleted).toBe(true);
    expect((await as(null).get(`/api/venues/${venue._id}`)).status).toBe(404);
    expect((await as(null).get("/api/venues")).body.data).toEqual([]);
    expect((await as(owner).get("/api/venues/owner/me")).body.data.venues).toEqual([]);
    expect((await as(owner).get("/api/venues/owner/approved-count")).body.data.count).toBe(0);
  });

  it("is refused with 409 while an upcoming booking is confirmed or awaiting its deposit", async () => {
    for (const status of ["confirmed", "pending_deposit"]) {
      const venue = await makeVenue(owner, { venueName: `Busy ${status}` });
      const space = await makeSpace(venue);
      await bookingFor(venue, space, { status });
      const res = await as(owner).delete(`/api/venues/${venue._id}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/1 upcoming booking\. Cancel it first/);
      expect((await Venue.findById(venue._id)).isDeleted).toBe(false);
    }
  });

  it("is allowed once bookings are cancelled, completed or already over", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    await bookingFor(venue, space, { status: "cancelled" });
    await bookingFor(venue, space, { status: "completed", daysFromNow: -5 });
    await bookingFor(venue, space, { status: "confirmed", daysFromNow: -2 });
    expect((await as(owner).delete(`/api/venues/${venue._id}`)).status).toBe(200);
  });

  it("an owner cannot delete someone else's venue, and a deleted venue cannot be deleted again", async () => {
    const venue = await makeVenue(owner);
    expect((await as(otherOwner).delete(`/api/venues/${venue._id}`)).status).toBe(404);
    expect((await Venue.findById(venue._id)).isDeleted).toBe(false);
    expect((await as(owner).delete(`/api/venues/${venue._id}`)).status).toBe(200);
    expect((await as(owner).delete(`/api/venues/${venue._id}`)).status).toBe(404);
    expect((await as(owner).delete(`/api/venues/${objectId()}`)).status).toBe(404);
  });

  it("customers get 403, visitors 401", async () => {
    const venue = await makeVenue(owner);
    expect((await as(customer).delete(`/api/venues/${venue._id}`)).status).toBe(403);
    expect((await as(null).delete(`/api/venues/${venue._id}`)).status).toBe(401);
    expect((await Venue.findById(venue._id)).isDeleted).toBe(false);
  });
});

describe("spaces: POST /api/venues/:venueId/spaces, PUT and DELETE /api/spaces/:id", () => {
  const hall = { name: "Grand Hall", capacity: 300, description: "Chandeliers", amenities: ["Stage"], indicativePricePerHour: 15000 };

  it("creates a space in my venue with the platform shift hours, and updates the venue's capacity summary", async () => {
    const venue = await makeVenue(owner);
    const res = await as(owner).post(`/api/venues/${venue._id}/spaces`, hall);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, message: "Space created successfully" });
    expect(res.body.data).toMatchObject({ name: "Grand Hall", capacity: 300, isActive: true, venue: String(venue._id), defaultDepositType: "percentage", defaultDepositValue: 20 });
    expect(res.body.data.resolvedShifts).toEqual({
      day: { startTime: "10:00", endTime: "15:00" },
      night: { startTime: "17:00", endTime: "22:00" },
      full_day: { startTime: "10:00", endTime: "22:00" },
    });
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 300, spaceCount: 1 });
  });

  it("accepts shift overrides and a deposit rule", async () => {
    const venue = await makeVenue(owner);
    const res = await as(owner).post(`/api/venues/${venue._id}/spaces`, {
      ...hall,
      shiftOverrides: [{ shift: "night", startTime: "18:00", endTime: "23:30" }],
      defaultDepositType: "fixed",
      defaultDepositValue: 25000,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.resolvedShifts.night).toEqual({ startTime: "18:00", endTime: "23:30" });
    expect(res.body.data.resolvedShifts.day).toEqual({ startTime: "10:00", endTime: "15:00" });
    expect(res.body.data).toMatchObject({ defaultDepositType: "fixed", defaultDepositValue: 25000 });
  });

  it.each([
    ["a one letter name", { name: "H" }, /at least 2 characters/],
    ["no capacity", { capacity: undefined }, /capacity/],
    ["a capacity of zero", { capacity: 0 }, /at least 1/],
    ["a badly formatted shift time", { shiftOverrides: [{ shift: "night", startTime: "6pm", endTime: "23:00" }] }, /HH:mm/],
    ["an unknown shift", { shiftOverrides: [{ shift: "brunch", startTime: "10:00", endTime: "12:00" }] }, /shiftOverrides/],
    ["an unknown deposit type", { defaultDepositType: "barter" }, /defaultDepositType/],
  ])("rejects %s with 400", async (_label, override, pattern) => {
    const venue = await makeVenue(owner);
    const res = await as(owner).post(`/api/venues/${venue._id}/spaces`, { ...hall, ...override });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect(await Space.countDocuments()).toBe(0);
  });

  it("cannot add a space to someone else's venue, a deleted venue or an unknown venue (404)", async () => {
    const venue = await makeVenue(owner);
    const removed = await makeVenue(owner, { isDeleted: true });
    expect((await as(otherOwner).post(`/api/venues/${venue._id}/spaces`, hall)).status).toBe(404);
    expect((await as(owner).post(`/api/venues/${removed._id}/spaces`, hall)).status).toBe(404);
    expect((await as(owner).post(`/api/venues/${objectId()}/spaces`, hall)).status).toBe(404);
    expect(await Space.countDocuments()).toBe(0);
  });

  it("is for venue owners only", async () => {
    const venue = await makeVenue(owner);
    expect((await as(customer).post(`/api/venues/${venue._id}/spaces`, hall)).status).toBe(403);
    expect((await as(admin).post(`/api/venues/${venue._id}/spaces`, hall)).status).toBe(403);
    expect((await as(null).post(`/api/venues/${venue._id}/spaces`, hall)).status).toBe(401);
  });

  it("updates a space (partial update) and keeps the venue's largest capacity in step", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue, { name: "Lawn", capacity: 100 });
    const res = await as(owner).put(`/api/spaces/${space._id}`, { capacity: 450, shiftOverrides: [{ shift: "day", startTime: "09:00", endTime: "14:00" }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Space updated successfully" });
    expect(res.body.data).toMatchObject({ name: "Lawn", capacity: 450 });
    expect(res.body.data.resolvedShifts.day).toEqual({ startTime: "09:00", endTime: "14:00" });
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 450, spaceCount: 1 });
  });

  it("can switch a space off and on again with isActive", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    await as(owner).put(`/api/spaces/${space._id}`, { isActive: false });
    expect((await as(null).get(`/api/venues/${venue._id}/spaces`)).body.data).toEqual([]);
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 0, spaceCount: 0 });

    await as(owner).put(`/api/spaces/${space._id}`, { isActive: true });
    expect((await as(null).get(`/api/venues/${venue._id}/spaces`)).body.data).toHaveLength(1);
  });

  it("cannot move a space to another venue (the venue field is ignored)", async () => {
    const venue = await makeVenue(owner);
    const otherVenue = await makeVenue(otherOwner);
    const space = await makeSpace(venue);
    await as(owner).put(`/api/spaces/${space._id}`, { venue: String(otherVenue._id), name: "Still Mine" });
    const stored = await Space.findById(space._id).lean();
    expect(String(stored.venue)).toBe(String(venue._id));
    expect(stored.name).toBe("Still Mine");
  });

  it("rejects invalid updates with 400", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    expect((await as(owner).put(`/api/spaces/${space._id}`, { capacity: 0 })).status).toBe(400);
    expect((await as(owner).put(`/api/spaces/${space._id}`, { name: "X" })).status).toBe(400);
    expect((await Space.findById(space._id)).capacity).toBe(100);
  });

  it("another owner gets 404 on update and delete, customers and admins 403, visitors 401", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    expect((await as(otherOwner).put(`/api/spaces/${space._id}`, { name: "Hijacked" })).status).toBe(404);
    expect((await as(otherOwner).delete(`/api/spaces/${space._id}`)).status).toBe(404);
    expect((await as(owner).put(`/api/spaces/${objectId()}`, { name: "Ghost" })).status).toBe(404);
    expect((await as(customer).put(`/api/spaces/${space._id}`, { name: "Nope" })).status).toBe(403);
    expect((await as(admin).delete(`/api/spaces/${space._id}`)).status).toBe(403);
    expect((await as(null).delete(`/api/spaces/${space._id}`)).status).toBe(401);
    expect(await Space.findById(space._id).lean()).toMatchObject({ name: "Main Hall", isActive: true });
  });

  it("removes a space softly: it disappears from the venue but the record stays", async () => {
    const venue = await makeVenue(owner);
    const keep = await makeSpace(venue, { name: "Keep", capacity: 80 });
    const drop = await makeSpace(venue, { name: "Drop", capacity: 200 });
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 200, spaceCount: 2 });

    const res = await as(owner).delete(`/api/spaces/${drop._id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Space removed successfully" });

    expect((await Space.findById(drop._id).lean()).isActive).toBe(false);
    expect((await as(null).get(`/api/venues/${venue._id}/spaces`)).body.data.map((s) => s.name)).toEqual(["Keep"]);
    expect(await Venue.findById(venue._id).lean()).toMatchObject({ maxCapacity: 80, spaceCount: 1 });
    expect(String(keep._id)).not.toBe(String(drop._id));
  });

  it("refuses to remove a space with an upcoming booking (409), but allows it for cancelled or past ones", async () => {
    const venue = await makeVenue(owner);
    const busy = await makeSpace(venue, { name: "Busy" });
    await bookingFor(venue, busy, { status: "confirmed" });
    const res = await as(owner).delete(`/api/spaces/${busy._id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/active bookings/);
    expect((await Space.findById(busy._id)).isActive).toBe(true);

    const quiet = await makeSpace(venue, { name: "Quiet" });
    await bookingFor(venue, quiet, { status: "cancelled" });
    await bookingFor(venue, quiet, { status: "completed", daysFromNow: -30 });
    expect((await as(owner).delete(`/api/spaces/${quiet._id}`)).status).toBe(200);
  });

  it("malformed ids are a 400", async () => {
    expect((await as(owner).put("/api/spaces/nope", { name: "Whatever" })).status).toBe(400);
    expect((await as(owner).delete("/api/spaces/nope")).status).toBe(400);
    expect(mongoose.isValidObjectId("nope")).toBe(false);
  });
});
