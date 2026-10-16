const ActivityLog = require("../model/activityLog");
const Booking = require("../model/booking");
const logger = require("../utils/logger");
const { createActivityLog } = require("../services/adminDashboardService");
const { startDb, stopDb, makeUser, as, makeVenue, makeSpace } = require("./helpers/api");
const { freezeTime, unfreezeTime } = require("./helpers/bookingWorld");

let admin;
let owner;
let customer;
let venue;
let space;

beforeAll(async () => {
  await startDb();
  admin = await makeUser("Admin");
  owner = await makeUser("VenueOwner");
  customer = await makeUser("Customer");
  venue = await makeVenue(owner);
  space = await makeSpace(venue);
});

afterAll(stopDb);

beforeEach(async () => {
  await Promise.all([ActivityLog.deleteMany({}), Booking.deleteMany({})]);
});

afterEach(() => {
  unfreezeTime();
  jest.restoreAllMocks();
});

const booking = (when, { status = "confirmed", totalPrice = 10000 } = {}) =>
  Booking.create({
    customer: customer._id,
    venue: venue._id,
    space: space._id,
    startTime: when,
    endTime: new Date(when.getTime() + 3 * 3600000),
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Guest",
    phoneNumber: "9800000000",
    totalPrice,
    depositAmount: 1000,
    balanceAmount: totalPrice - 1000,
    status,
  });

describe("GET /api/admin/activity-logs", () => {
  it("returns the newest entries first with who did it", async () => {
    await ActivityLog.create({ type: "system", message: "old", createdBy: admin._id, createdAt: new Date("2030-01-01T00:00:00Z") });
    await ActivityLog.create({ type: "venue", message: "new", createdBy: owner._id, createdAt: new Date("2030-01-02T00:00:00Z") });

    const res = await as(admin).get("/api/admin/activity-logs");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((l) => l.message)).toEqual(["new", "old"]);
    expect(res.body.data[0].createdBy).toMatchObject({ _id: String(owner._id), name: owner.name, email: owner.email });
    expect(res.body.data[0].createdBy).not.toHaveProperty("password");
  });

  it("returns at most the 50 newest", async () => {
    await ActivityLog.insertMany(
      Array.from({ length: 52 }, (_, i) => ({ type: "system", message: `log ${i}`, createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)) }))
    );
    const res = await as(admin).get("/api/admin/activity-logs");
    expect(res.body.data).toHaveLength(50);
    expect(res.body.data[0].message).toBe("log 51");
  });

  it("is admin only (403 for owners and customers, 401 signed out)", async () => {
    expect((await as(owner).get("/api/admin/activity-logs")).status).toBe(403);
    expect((await as(customer).get("/api/admin/activity-logs")).status).toBe(403);
    expect((await as(null).get("/api/admin/activity-logs")).status).toBe(401);
  });

  it("is not served at the old path", async () => {
    expect((await as(admin).get("/api/admin/activity/logs")).status).toBe(404);
  });
});

describe("createActivityLog", () => {
  it("writes an entry", async () => {
    await createActivityLog("system", "Helper test log", admin._id, { foo: "bar" });
    const log = await ActivityLog.findOne({ message: "Helper test log" }).lean();
    expect(log).toMatchObject({ type: "system", data: { foo: "bar" } });
    expect(String(log.createdBy)).toBe(String(admin._id));
  });

  it("never throws: logging must not break the request that triggered it", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {});
    await expect(createActivityLog("not-a-type", "Will fail", admin._id)).resolves.toBeUndefined();
    expect(await ActivityLog.countDocuments()).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("GET /api/admin/earnings/monthly", () => {
  it("returns all 12 months, summing confirmed and completed bookings by start month", async () => {
    freezeTime("2030-06-15T12:00:00Z");
    await booking(new Date("2030-01-15T12:00:00Z"), { totalPrice: 10000 });
    await booking(new Date("2030-01-20T12:00:00Z"), { totalPrice: 5000, status: "completed" });
    await booking(new Date("2030-03-10T12:00:00Z"), { totalPrice: 7000 });

    const res = await as(admin).get("/api/admin/earnings/monthly");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data[0]).toMatchObject({ totalEarnings: 15000, bookingCount: 2 });
    expect(res.body.data[1]).toMatchObject({ totalEarnings: 0, bookingCount: 0 });
    expect(res.body.data[2]).toMatchObject({ totalEarnings: 7000, bookingCount: 1 });
    expect(res.body.data.every((m) => typeof m.month === "string" && m.month.length > 0)).toBe(true);
  });

  it("ignores cancelled and unpaid bookings and other years", async () => {
    freezeTime("2030-06-15T12:00:00Z");
    await booking(new Date("2030-02-10T12:00:00Z"), { status: "cancelled" });
    await booking(new Date("2030-02-11T12:00:00Z"), { status: "pending_deposit" });
    await booking(new Date("2029-02-10T12:00:00Z"));
    await booking(new Date("2031-02-10T12:00:00Z"));

    const res = await as(admin).get("/api/admin/earnings/monthly");
    expect(res.body.data.every((m) => m.totalEarnings === 0 && m.bookingCount === 0)).toBe(true);
  });

  it("is all zeros when there are no bookings", async () => {
    const res = await as(admin).get("/api/admin/earnings/monthly");
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data.every((m) => m.totalEarnings === 0)).toBe(true);
  });

  it("is admin only", async () => {
    expect((await as(owner).get("/api/admin/earnings/monthly")).status).toBe(403);
    expect((await as(null).get("/api/admin/earnings/monthly")).status).toBe(401);
  });

  it("answers 500 with a generic message when the database fails", async () => {
    jest.spyOn(Booking, "aggregate").mockImplementation(() => {
      throw new Error("DB error");
    });
    const res = await as(admin).get("/api/admin/earnings/monthly");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).not.toContain("DB error");
  });
});
