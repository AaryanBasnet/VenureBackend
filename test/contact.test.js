const Contact = require("../model/contact");
const { app, request, startDb, stopDb, makeUser, as } = require("./helpers/api");

let admin;
let customer;
let ipCounter = 0;

beforeAll(async () => {
  await startDb();
  admin = await makeUser("Admin");
  customer = await makeUser("Customer");
});

afterAll(stopDb);

beforeEach(async () => {
  await Contact.deleteMany({});
});

const valid = { name: "Sita Sharma", email: "sita@example.com", phone: "9800000000", message: "Do you have a hall for 200 guests in May?" };

// Every call comes from its own client address (the app trusts one proxy hop), so the per-IP limit of the
// public form never leaks between tests.
const submit = (body, ip = `10.1.0.${++ipCounter}`) => request(app).post("/api/contact").set("X-Forwarded-For", ip).send(body);

describe("POST /api/contact", () => {
  it("stores the message for a signed-out visitor", async () => {
    const res = await submit(valid);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, message: "Thank you! Your message has been received." });

    const saved = await Contact.findOne({ email: "sita@example.com" }).lean();
    expect(saved).toMatchObject({ name: "Sita Sharma", phone: "9800000000", message: valid.message });
  });

  it("accepts a message with no email or phone", async () => {
    expect((await submit({ name: "Ram", message: "Please call me back about pricing." })).status).toBe(201);
    expect((await submit({ ...valid, email: "" })).status).toBe(201);
  });

  it.each([
    ["a missing name", { ...valid, name: undefined }, /name/],
    ["a one letter name", { ...valid, name: "R" }, /Name must be at least 2/],
    ["a missing message", { ...valid, message: undefined }, /message/],
    ["a message that is too short", { ...valid, message: "Hi" }, /at least 10/],
    ["a message that is too long", { ...valid, message: "x".repeat(2001) }, /2000/],
    ["an invalid email", { ...valid, email: "not-an-email" }, /Invalid email/],
    ["a phone number that is too long", { ...valid, phone: "9".repeat(21) }, /Phone number is too long/],
  ])("rejects %s with 400 and stores nothing", async (_label, body, messagePattern) => {
    const res = await submit(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/^Validation Error/);
    expect(res.body.message).toMatch(messagePattern);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it("ignores fields it does not know about", async () => {
    await submit({ ...valid, isAdmin: true, createdAt: "2000-01-01" });
    const saved = await Contact.findOne().lean();
    expect(saved.isAdmin).toBeUndefined();
    expect(saved.createdAt.getFullYear()).toBeGreaterThan(2000);
  });

  it("limits one address to 5 messages an hour, then answers 429, while other addresses still get through", async () => {
    const ip = "10.2.0.1";
    for (let i = 0; i < 5; i++) expect((await submit(valid, ip)).status).toBe(201);

    const blocked = await submit(valid, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, message: "Too many messages sent. Please try again later." });
    expect(await Contact.countDocuments()).toBe(5);

    expect((await submit(valid, "10.2.0.2")).status).toBe(201);
  });
});

describe("GET /api/contact/admin/all", () => {
  it("lets an admin read every submission, newest first", async () => {
    await Contact.create({ ...valid, name: "First", createdAt: new Date("2030-01-01T00:00:00Z") });
    await Contact.create({ ...valid, name: "Second", createdAt: new Date("2030-01-02T00:00:00Z") });

    const res = await as(admin).get("/api/contact/admin/all");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((c) => c.name)).toEqual(["Second", "First"]);
    expect(res.body.data[0]).toMatchObject({ email: "sita@example.com", message: valid.message });
  });

  it("is empty when nobody wrote in", async () => {
    const res = await as(admin).get("/api/contact/admin/all");
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it("is private: customers get 403, signed-out visitors 401", async () => {
    await Contact.create(valid);
    const asCustomer = await as(customer).get("/api/contact/admin/all");
    expect(asCustomer.status).toBe(403);
    expect(JSON.stringify(asCustomer.body)).not.toContain("sita@example.com");
    expect((await as(null).get("/api/contact/admin/all")).status).toBe(401);
  });

  it("is not reachable at the old path", async () => {
    expect((await as(admin).get("/api/contact/admin")).status).toBe(404);
  });

  it("is not blocked by the public form's rate limit", async () => {
    const ip = "10.3.0.1";
    for (let i = 0; i < 6; i++) await submit(valid, ip);
    expect((await as(admin).get("/api/contact/admin/all")).status).toBe(200);
  });
});
