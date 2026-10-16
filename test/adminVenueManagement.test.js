// Admin moderation of venues: listing, approve / reject, featuring and deleting any venue.
const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const Notification = require("../model/notification");
const { app, startDb, stopDb, makeUser, as, makeVenue, makeSpace, objectId, location } = require("./helpers/api");

let admin;
let owner;
let customer;

beforeAll(async () => {
  await startDb();
  admin = await makeUser("Admin");
  owner = await makeUser("VenueOwner", { name: "Hall Owner", email: "hall-owner@admin.test" });
  customer = await makeUser("Customer");
});

afterAll(stopDb);

beforeEach(async () => {
  await Promise.all([Venue.deleteMany({}), Space.deleteMany({}), Booking.deleteMany({}), Notification.deleteMany({})]);
});

describe("GET /api/venues/admin/all", () => {
  it("lists venues of every status with the owner's name and email, newest first, without deleted ones", async () => {
    await makeVenue(owner, { venueName: "Approved One", status: "approved" });
    await makeVenue(owner, { venueName: "Pending One", status: "pending" });
    await makeVenue(owner, { venueName: "Rejected One", status: "rejected" });
    await makeVenue(owner, { venueName: "Deleted One", isDeleted: true });

    const res = await as(admin).get("/api/venues/admin/all");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.venues.map((v) => v.venueName)).toEqual(["Rejected One", "Pending One", "Approved One"]);
    expect(res.body).toMatchObject({ total: 3, pages: 1 });
    expect(res.body.venues[0].owner).toEqual({ _id: String(owner._id), name: "Hall Owner", email: "hall-owner@admin.test" });
    expect(res.body.venues[0]).not.toHaveProperty("priceSortKey");
  });

  it("filters by status and ignores an unknown status", async () => {
    await makeVenue(owner, { venueName: "A", status: "approved" });
    await makeVenue(owner, { venueName: "P", status: "pending" });
    expect((await as(admin).get("/api/venues/admin/all?status=pending")).body.venues.map((v) => v.venueName)).toEqual(["P"]);
    expect((await as(admin).get("/api/venues/admin/all?status=approved")).body.total).toBe(1);
    expect((await as(admin).get("/api/venues/admin/all?status=bogus")).body.total).toBe(2);
  });

  it("searches by venue name, literally", async () => {
    await makeVenue(owner, { venueName: "Royal Palace" });
    await makeVenue(owner, { venueName: "Garden View" });
    expect((await as(admin).get("/api/venues/admin/all?search=royal")).body.venues.map((v) => v.venueName)).toEqual(["Royal Palace"]);
    expect((await as(admin).get("/api/venues/admin/all?search=.*")).body.total).toBe(0);
  });

  it("paginates, and the pages do not overlap", async () => {
    for (let i = 1; i <= 5; i++) await makeVenue(owner, { venueName: `V${i}`, location: { ...location, city: `City${i}` } });
    const first = await as(admin).get("/api/venues/admin/all?page=1&limit=2");
    const second = await as(admin).get("/api/venues/admin/all?page=2&limit=2");
    const third = await as(admin).get("/api/venues/admin/all?page=3&limit=2");
    expect(first.body).toMatchObject({ total: 5, pages: 3 });
    expect([first, second, third].map((r) => r.body.venues.length)).toEqual([2, 2, 1]);
    const ids = [first, second, third].flatMap((r) => r.body.venues.map((v) => v._id));
    expect(new Set(ids).size).toBe(5);
  });

  it("is admin only", async () => {
    expect((await as(owner).get("/api/venues/admin/all")).status).toBe(403);
    expect((await as(customer).get("/api/venues/admin/all")).status).toBe(403);
    expect((await as(null).get("/api/venues/admin/all")).status).toBe(401);
  });
});

describe("GET /api/venues/admin/approved-count", () => {
  it("counts approved, live venues", async () => {
    await makeVenue(owner, { status: "approved" });
    await makeVenue(owner, { status: "approved" });
    await makeVenue(owner, { status: "pending" });
    await makeVenue(owner, { status: "approved", isDeleted: true });
    const res = await as(admin).get("/api/venues/admin/approved-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { count: 2 } });
  });

  it("is admin only", async () => {
    expect((await as(owner).get("/api/venues/admin/approved-count")).status).toBe(403);
    expect((await as(null).get("/api/venues/admin/approved-count")).status).toBe(401);
  });
});

describe("PATCH /api/venues/:id/status", () => {
  it("approves a pending venue: it goes public and the owner is told", async () => {
    const venue = await makeVenue(owner, { venueName: "Waiting Hall", status: "pending" });
    expect((await as(null).get(`/api/venues/${venue._id}`)).status).toBe(404);

    const res = await as(admin).patch(`/api/venues/${venue._id}/status`, { status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Venue status updated to approved" });
    expect(res.body.data).toMatchObject({ _id: String(venue._id), status: "approved" });

    expect((await as(null).get(`/api/venues/${venue._id}`)).status).toBe(200);
    const note = await Notification.findOne({ recipient: owner._id });
    expect(note).toMatchObject({ type: "approval", read: false });
    expect(note.message).toBe('Your venue "Waiting Hall" has been approved.');
  });

  it("rejects a venue: it leaves the public site and loses its featured flag", async () => {
    const venue = await makeVenue(owner, { venueName: "Bad Hall", isFeatured: true });
    const res = await as(admin).patch(`/api/venues/${venue._id}/status`, { status: "rejected" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "rejected", isFeatured: false });
    expect((await as(null).get(`/api/venues/${venue._id}`)).status).toBe(404);
    expect((await as(null).get("/api/venues/featured")).body.data).toEqual([]);
    expect((await Notification.findOne({ recipient: owner._id })).message).toBe('Your venue "Bad Hall" has been rejected.');
  });

  it("keeps the featured flag when an approved venue is approved again", async () => {
    const venue = await makeVenue(owner, { isFeatured: true });
    const res = await as(admin).patch(`/api/venues/${venue._id}/status`, { status: "approved" });
    expect(res.body.data.isFeatured).toBe(true);
  });

  it("pushes the notification to the owner's live socket room when the server has one", async () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    app.set("io", { to });
    try {
      const venue = await makeVenue(owner, { status: "pending" });
      await as(admin).patch(`/api/venues/${venue._id}/status`, { status: "approved" });
      expect(to).toHaveBeenCalledWith(String(owner._id));
      expect(emit).toHaveBeenCalledWith("newNotification", expect.objectContaining({ type: "approval" }));
    } finally {
      app.set("io", undefined);
    }
  });

  it.each([
    ["an unknown status", { status: "banana" }],
    ["no status", {}],
    ["a status of the wrong type", { status: 5 }],
  ])("rejects %s with 400 and changes nothing", async (_label, body) => {
    const venue = await makeVenue(owner, { status: "pending" });
    const res = await as(admin).patch(`/api/venues/${venue._id}/status`, body);
    expect(res.status).toBe(400);
    expect((await Venue.findById(venue._id)).status).toBe("pending");
    expect(await Notification.countDocuments()).toBe(0);
  });

  it("404 for an unknown or deleted venue, 400 for a malformed id", async () => {
    const removed = await makeVenue(owner, { isDeleted: true, status: "pending" });
    expect((await as(admin).patch(`/api/venues/${objectId()}/status`, { status: "approved" })).status).toBe(404);
    expect((await as(admin).patch(`/api/venues/${removed._id}/status`, { status: "approved" })).status).toBe(404);
    expect((await as(admin).patch("/api/venues/nope/status", { status: "approved" })).status).toBe(400);
    expect((await Venue.findById(removed._id)).status).toBe("pending");
  });

  it("owners cannot approve their own venue (403), visitors get 401", async () => {
    const venue = await makeVenue(owner, { status: "pending" });
    expect((await as(owner).patch(`/api/venues/${venue._id}/status`, { status: "approved" })).status).toBe(403);
    expect((await as(customer).patch(`/api/venues/${venue._id}/status`, { status: "approved" })).status).toBe(403);
    expect((await as(null).patch(`/api/venues/${venue._id}/status`, { status: "approved" })).status).toBe(401);
    expect((await Venue.findById(venue._id)).status).toBe("pending");
  });
});

describe("PATCH /api/venues/:id/feature", () => {
  it("features an approved venue, then un-features it", async () => {
    const venue = await makeVenue(owner, { venueName: "Star Hall" });

    const on = await as(admin).patch(`/api/venues/${venue._id}/feature`);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ success: true, message: "Venue is now featured" });
    expect(on.body.data.isFeatured).toBe(true);
    expect((await as(null).get("/api/venues/featured")).body.data.map((v) => v.venueName)).toEqual(["Star Hall"]);

    const off = await as(admin).patch(`/api/venues/${venue._id}/feature`);
    expect(off.body).toMatchObject({ message: "Venue removed from featured" });
    expect(off.body.data.isFeatured).toBe(false);
    expect((await as(null).get("/api/venues/featured")).body.data).toEqual([]);
  });

  it("refuses to feature a pending or rejected venue (400)", async () => {
    for (const status of ["pending", "rejected"]) {
      const venue = await makeVenue(owner, { status });
      const res = await as(admin).patch(`/api/venues/${venue._id}/feature`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Only approved venues can be featured");
      expect((await Venue.findById(venue._id)).isFeatured).toBe(false);
    }
  });

  it("always lets a venue be un-featured, even when it is no longer approved", async () => {
    const venue = await makeVenue(owner, { status: "pending", isFeatured: true });
    const res = await as(admin).patch(`/api/venues/${venue._id}/feature`);
    expect(res.status).toBe(200);
    expect(res.body.data.isFeatured).toBe(false);
  });

  it("404 for an unknown or deleted venue", async () => {
    const removed = await makeVenue(owner, { isDeleted: true });
    expect((await as(admin).patch(`/api/venues/${objectId()}/feature`)).status).toBe(404);
    expect((await as(admin).patch(`/api/venues/${removed._id}/feature`)).status).toBe(404);
  });

  it("is admin only", async () => {
    const venue = await makeVenue(owner);
    expect((await as(owner).patch(`/api/venues/${venue._id}/feature`)).status).toBe(403);
    expect((await as(customer).patch(`/api/venues/${venue._id}/feature`)).status).toBe(403);
    expect((await as(null).patch(`/api/venues/${venue._id}/feature`)).status).toBe(401);
    expect((await Venue.findById(venue._id)).isFeatured).toBe(false);
  });
});

describe("DELETE /api/venues/:id as an admin", () => {
  it("can remove any venue (soft delete)", async () => {
    const venue = await makeVenue(owner);
    const res = await as(admin).delete(`/api/venues/${venue._id}`);
    expect(res.status).toBe(200);
    expect((await Venue.findById(venue._id).lean()).isDeleted).toBe(true);
    expect((await as(admin).get("/api/venues/admin/all")).body.venues).toEqual([]);
    expect((await as(admin).get("/api/venues/admin/approved-count")).body.data.count).toBe(0);
  });

  it("is refused with 409 while customers have upcoming bookings", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    const startTime = new Date(Date.now() + 5 * 86400000);
    await Booking.create({
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
      status: "confirmed",
    });
    const res = await as(admin).delete(`/api/venues/${venue._id}`);
    expect(res.status).toBe(409);
    expect((await Venue.findById(venue._id)).isDeleted).toBe(false);
  });

  it("404 for an unknown venue", async () => {
    expect((await as(admin).delete(`/api/venues/${objectId()}`)).status).toBe(404);
  });
});
