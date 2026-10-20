// Who can become what: the public sign-up makes customers only; owners come from an approved application and admins
// from scripts/create-admin.js. And every admin-only endpoint refuses everyone who is not an admin.
const request = require("supertest");
const User = require("../model/user");
const { createAdmin, checkPassword } = require("../scripts/create-admin");
const { app, startDb, stopDb, clearDb, makeUser, as, objectId } = require("./helpers/api");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

let ipCounter = 0;
const register = (body) => request(app).post("/api/auth/register").set("X-Forwarded-For", `10.55.0.${++ipCounter}`).send(body);
const person = (extra = {}) => ({ name: "Someone", email: `s${ipCounter + 1}@roles.test`, phone: "9812345678", password: "Test@1234", ...extra });

describe("the public sign-up", () => {
  it("makes a customer, with or without saying so", async () => {
    const plain = await register(person());
    expect(plain.status).toBe(201);
    expect(plain.body.data.role).toBe("Customer");
    const said = await register(person({ role: "Customer" }));
    expect(said.status).toBe(201);
    expect(said.body.data.role).toBe("Customer");
  });

  it.each(["VenueOwner", "Admin", "admin", "Owner", "superuser", ""])("refuses to create an account that asks for the role %p, and creates nothing", async (role) => {
    const body = person({ role });
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Venue owners join by applying/);
    expect(await User.countDocuments({ email: body.email })).toBe(0);
    expect(res.headers["set-cookie"]).toBeUndefined(); // no session either
  });

  it("cannot be talked into a role by sending extra fields", async () => {
    const res = await register(person({ isAdmin: true, isDeleted: false, favorites: ["x"] }));
    expect(res.status).toBe(201);
    const saved = await User.findOne({ email: res.body.data.email }).lean();
    expect(saved.role).toBe("Customer");
    expect(saved.isAdmin).toBeUndefined();
  });
});

describe("admin-only endpoints", () => {
  const id = objectId();
  const ENDPOINTS = [
    ["get", "/api/user/admin/customers/total"],
    ["get", "/api/user/admin/all"],
    ["get", `/api/user/admin/${id}`],
    ["delete", `/api/user/admin/${id}`],
    ["get", "/api/venues/admin/all"],
    ["get", "/api/venues/admin/approved-count"],
    ["patch", `/api/venues/${id}/status`, { status: "approved" }],
    ["patch", `/api/venues/${id}/feature`],
    ["patch", `/api/${id}/feature`],
    ["get", "/api/contact/admin/all"],
    ["get", "/api/admin/activity-logs"],
    ["get", "/api/admin/earnings/monthly"],
    ["get", "/api/admin/reviews"],
    ["get", "/api/bookings/total"],
    ["put", "/api/landing", {}],
    ["get", "/api/venue-applications"],
    ["get", `/api/venue-applications/${id}`],
    ["post", `/api/venue-applications/${id}/approve`],
    ["post", `/api/venue-applications/${id}/reject`, { reason: "not now" }],
    ["post", `/api/venue-applications/${id}/resend-link`],
  ];
  let admin, owner, customer;
  beforeEach(async () => {
    admin = await makeUser("Admin");
    owner = await makeUser("VenueOwner");
    customer = await makeUser("Customer");
  });

  // every row has three entries: with two, Jest would hand the test a "done" callback in the third place
  it.each(ENDPOINTS.map(([method, path, body]) => [method, path, body ?? null]))("%s %s is closed to visitors, customers and owners, and open to an admin", async (method, path, bodyOrNull) => {
    const body = bodyOrNull ?? undefined;
    expect((await as(null)[method](path, body)).status).toBe(401);
    expect((await as(customer)[method](path, body)).status).toBe(403);
    expect((await as(owner)[method](path, body)).status).toBe(403);
    const asAdmin = await as(admin)[method](path, body);
    expect([401, 403]).not.toContain(asAdmin.status); // whatever the answer is (200, 400, 404), it got past the role check
  });

  it("an admin account cannot be removed through the admin screens, so the last admin cannot lock everyone out", async () => {
    const other = await makeUser("Admin");
    const res = await as(admin).delete(`/api/user/admin/${other._id}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await User.findById(other._id).select("+isDeleted")).isDeleted).not.toBe(true);
    expect((await as(admin).delete(`/api/user/admin/${admin._id}`)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("scripts/create-admin.js", () => {
  const good = { name: "Aaryan Admin", email: "Admin@Example.COM", password: "A-long-Password1" };

  it("creates an admin who can sign in, with the password stored hashed", async () => {
    const created = await createAdmin(good);
    expect(created.email).toBe("admin@example.com");
    const saved = await User.findOne({ email: "admin@example.com" }).select("+password");
    expect(saved.role).toBe("Admin");
    expect(saved.password).not.toContain("A-long-Password1");

    const login = await request(app).post("/api/auth/login").set("X-Forwarded-For", "10.56.0.1").send({ email: "admin@example.com", password: "A-long-Password1" });
    expect(login.status).toBe(200);
    expect(login.body.data.role).toBe("Admin");
  });

  it("refuses a weak password, a bad email, a missing name and an email that already has an account", async () => {
    await expect(createAdmin({ ...good, password: "Short1" })).rejects.toThrow(/at least 12 characters/);
    await expect(createAdmin({ ...good, password: "alllowercase12345" })).rejects.toThrow(/uppercase letter, a lowercase letter and a number/);
    await expect(createAdmin({ ...good, email: "not-an-email" })).rejects.toThrow(/valid email/);
    await expect(createAdmin({ ...good, name: " " })).rejects.toThrow(/name/);
    await makeUser("Customer", { email: "admin@example.com" });
    await expect(createAdmin(good)).rejects.toThrow(/already exists/);
    expect(await User.countDocuments({ role: "Admin" })).toBe(0);
  });

  it("checks passwords the same way the prompt does", () => {
    expect(checkPassword("Abcdefghij12")).toBe("");
    expect(checkPassword("Abcdefghij1")).not.toBe("");
    expect(checkPassword(undefined)).not.toBe("");
  });
});
