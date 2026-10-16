const bcrypt = require("bcryptjs");
const User = require("../model/user");
const Booking = require("../model/booking");
const RefreshToken = require("../model/refreshToken");
const { app, request, startDb, stopDb, makeUser, as, makeVenue, makeSpace, objectId } = require("./helpers/api");

let admin;
let owner;
let venue;
let space;

beforeAll(async () => {
  await startDb();
  admin = await makeUser("Admin", { name: "Root Admin" });
  owner = await makeUser("VenueOwner", { name: "Bagmati Owner" });
  venue = await makeVenue(owner);
  space = await makeSpace(venue);
});

afterAll(stopDb);

// Customers are created per test and removed again, so counts never depend on test order
let created = [];
const customer = async (overrides = {}) => {
  const u = await makeUser("Customer", overrides);
  created.push(u._id);
  return u;
};
afterEach(async () => {
  await User.deleteMany({ _id: { $in: created } });
  await Booking.deleteMany({});
  await RefreshToken.deleteMany({});
  created = [];
});

const bookingFor = (user, status = "confirmed") => {
  const startTime = new Date(Date.now() + 10 * 86400000);
  return Booking.create({
    customer: user._id,
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

describe("GET /api/user/admin/all", () => {
  it("lists users with a booking count and the pagination block", async () => {
    const busy = await customer({ name: "Busy Bee" });
    const idle = await customer({ name: "Idle Ida" });
    await bookingFor(busy);
    await bookingFor(busy, "cancelled");

    const res = await as(admin).get("/api/user/admin/all?search=Bee");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ _id: String(busy._id), name: "Busy Bee", bookingCount: 2 });
    expect(res.body.pagination).toEqual({ total: 1, page: 1, limit: 10 });
    expect(res.body.data[0]).not.toHaveProperty("password");

    const idleRes = await as(admin).get("/api/user/admin/all?search=Idle");
    expect(idleRes.body.data[0]).toMatchObject({ _id: String(idle._id), bookingCount: 0 });
  });

  it("filters by role", async () => {
    await customer();
    const owners = await as(admin).get("/api/user/admin/all?role=VenueOwner");
    expect(owners.body.data.map((u) => u.role)).toEqual(["VenueOwner"]);
    const admins = await as(admin).get("/api/user/admin/all?role=Admin");
    expect(admins.body.data.map((u) => u.email)).toEqual([admin.email]);
  });

  it("searches name and email, case-insensitively", async () => {
    const a = await customer({ name: "Kamala Thapa", email: "kamala@mail.test" });
    await customer({ name: "Someone Else", email: "other@mail.test" });

    expect((await as(admin).get("/api/user/admin/all?search=kamala")).body.data.map((u) => u._id)).toEqual([String(a._id)]);
    expect((await as(admin).get("/api/user/admin/all?search=OTHER@MAIL")).body.pagination.total).toBe(1);
  });

  it("treats the search text literally, not as a regular expression", async () => {
    await customer({ name: "Plain Name" });
    const all = await as(admin).get("/api/user/admin/all?search=.*");
    expect(all.status).toBe(200);
    expect(all.body.data).toEqual([]);
  });

  it("paginates, and the pages do not overlap", async () => {
    for (let i = 0; i < 5; i++) await customer({ name: `Paged ${i}` });
    const first = await as(admin).get("/api/user/admin/all?search=Paged&page=1&limit=2");
    const second = await as(admin).get("/api/user/admin/all?search=Paged&page=2&limit=2");
    const third = await as(admin).get("/api/user/admin/all?search=Paged&page=3&limit=2");

    expect(first.body.pagination).toEqual({ total: 5, page: 1, limit: 2 });
    expect([first, second, third].map((r) => r.body.data.length)).toEqual([2, 2, 1]);
    const ids = [first, second, third].flatMap((r) => r.body.data.map((u) => u._id));
    expect(new Set(ids).size).toBe(5);
  });

  it("hides deactivated users", async () => {
    const gone = await customer({ name: "Gone Guy", isDeleted: true });
    const res = await as(admin).get("/api/user/admin/all?search=Gone");
    expect(res.body.data.map((u) => u._id)).not.toContain(String(gone._id));
    expect(res.body.pagination.total).toBe(0);
  });

  it.each([
    ["an unknown role", "role=Superuser"],
    ["a page below 1", "page=0"],
    ["a limit above 100", "limit=101"],
  ])("rejects %s with 400", async (_label, query) => {
    const res = await as(admin).get(`/api/user/admin/all?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Validation Error/);
  });

  it("is admin only: owners and customers get 403, visitors 401", async () => {
    const c = await customer();
    expect((await as(owner).get("/api/user/admin/all")).status).toBe(403);
    expect((await as(c).get("/api/user/admin/all")).status).toBe(403);
    expect((await as(null).get("/api/user/admin/all")).status).toBe(401);
  });
});

describe("GET /api/user/admin/customers/total", () => {
  it("counts active customers only", async () => {
    await customer();
    await customer();
    await customer({ isDeleted: true });
    const res = await as(admin).get("/api/user/admin/customers/total");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: 2 });
  });

  it("is admin only", async () => {
    const c = await customer();
    expect((await as(c).get("/api/user/admin/customers/total")).status).toBe(403);
    expect((await as(null).get("/api/user/admin/customers/total")).status).toBe(401);
  });
});

describe("GET /api/user/admin/:id", () => {
  it("returns one user", async () => {
    const c = await customer({ name: "John Doe" });
    const res = await as(admin).get(`/api/user/admin/${c._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ _id: String(c._id), name: "John Doe", email: c.email, role: "Customer" });
    expect(res.body.data).not.toHaveProperty("password");
  });

  it("404 for an unknown or deactivated user, 400 for a malformed id", async () => {
    const gone = await customer({ isDeleted: true });
    expect((await as(admin).get(`/api/user/admin/${objectId()}`)).status).toBe(404);
    expect((await as(admin).get(`/api/user/admin/${gone._id}`)).status).toBe(404);
    expect((await as(admin).get("/api/user/admin/not-an-id")).status).toBe(400);
  });

  it("is admin only", async () => {
    const c = await customer();
    expect((await as(c).get(`/api/user/admin/${c._id}`)).status).toBe(403);
    expect((await as(null).get(`/api/user/admin/${c._id}`)).status).toBe(401);
  });
});

describe("DELETE /api/user/admin/:id (deactivate)", () => {
  it("soft deletes: the record stays, but the user disappears from lists", async () => {
    const c = await customer({ name: "Delete Me" });
    const res = await as(admin).delete(`/api/user/admin/${c._id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "User account has been deactivated (soft deleted)." });

    const stored = await User.findById(c._id).select("+isDeleted").lean();
    expect(stored).not.toBeNull();
    expect(stored.isDeleted).toBe(true);
    expect((await as(admin).get("/api/user/admin/all?search=Delete")).body.data).toEqual([]);
    expect((await as(admin).get(`/api/user/admin/${c._id}`)).status).toBe(404);
  });

  it("ends every session at once: the access token stops working, refresh and login fail, refresh tokens are gone", async () => {
    const password = "Test@1234";
    const c = await customer({ email: "session@user.test", password: await bcrypt.hash(password, 10) });

    // Two real sign-ins (two devices) so there are two stored refresh tokens
    const phone = request.agent(app);
    const laptop = request.agent(app);
    expect((await phone.post("/api/auth/login").send({ email: c.email, password })).status).toBe(200);
    expect((await laptop.post("/api/auth/login").send({ email: c.email, password })).status).toBe(200);
    expect(await RefreshToken.countDocuments({ userId: c._id })).toBe(2);
    expect((await phone.get("/api/user/profile")).status).toBe(200);

    expect((await as(admin).delete(`/api/user/admin/${c._id}`)).status).toBe(200);

    expect(await RefreshToken.countDocuments({ userId: c._id })).toBe(0);
    expect((await phone.get("/api/user/profile")).status).toBe(401);
    expect((await laptop.post("/api/auth/refresh")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: c.email, password })).status).toBe(401);
  });

  it("only revokes the deactivated user's sessions, not other people's", async () => {
    const password = "Test@1234";
    const doomed = await customer({ email: "doomed@user.test", password: await bcrypt.hash(password, 10) });
    const safe = await customer({ email: "safe@user.test", password: await bcrypt.hash(password, 10) });
    const safeAgent = request.agent(app);
    await request(app).post("/api/auth/login").send({ email: doomed.email, password });
    await safeAgent.post("/api/auth/login").send({ email: safe.email, password });

    await as(admin).delete(`/api/user/admin/${doomed._id}`);

    expect(await RefreshToken.countDocuments({ userId: safe._id })).toBe(1);
    expect((await safeAgent.get("/api/user/profile")).status).toBe(200);
  });

  it("refuses to deactivate an Admin account (403), including your own", async () => {
    const otherAdmin = await makeUser("Admin");
    created.push(otherAdmin._id);
    for (const target of [otherAdmin, admin]) {
      const res = await as(admin).delete(`/api/user/admin/${target._id}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Cannot delete an Admin/);
      expect((await User.findById(target._id).select("+isDeleted").lean()).isDeleted).toBe(false);
    }
    expect((await as(admin).get("/api/user/profile")).status).toBe(200);
  });

  it("can deactivate a venue owner", async () => {
    const o = await makeUser("VenueOwner");
    created.push(o._id);
    expect((await as(admin).delete(`/api/user/admin/${o._id}`)).status).toBe(200);
  });

  it("404 for an unknown user, 400 for a malformed id", async () => {
    expect((await as(admin).delete(`/api/user/admin/${objectId()}`)).status).toBe(404);
    expect((await as(admin).delete("/api/user/admin/not-an-id")).status).toBe(400);
  });

  it("is admin only, and one customer cannot deactivate another", async () => {
    const a = await customer();
    const b = await customer();
    expect((await as(a).delete(`/api/user/admin/${b._id}`)).status).toBe(403);
    expect((await as(owner).delete(`/api/user/admin/${b._id}`)).status).toBe(403);
    expect((await as(null).delete(`/api/user/admin/${b._id}`)).status).toBe(401);
    expect((await User.findById(b._id).select("+isDeleted").lean()).isDeleted).toBe(false);
  });
});
