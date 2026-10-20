// The booking and inquiry lists come a page at a time, filtered by tab on the server, with the size of every tab.
const Inquiry = require("../model/inquiry");
const Booking = require("../model/booking");
const { as, makeSpace } = require("./helpers/api");
const { world, start, stop, reset } = require("./helpers/bookingWorld");

beforeAll(() => start());
afterAll(stop);
beforeEach(reset);

const DAY = 24 * 60 * 60 * 1000;
const inquiry = (extra = {}) =>
  Inquiry.create({
    customer: world.customer._id, venue: world.venue._id, preferredDate: new Date(Date.now() + 30 * DAY), numberOfGuests: 50,
    eventType: "Wedding", contactName: "Jane", phoneNumber: "9800000000", ...extra,
  });

let hall;
let counter = 0;
const booking = async (status, daysFromNow) => {
  hall ??= await makeSpace(world.venue);
  const startTime = new Date(Date.now() + daysFromNow * DAY + counter++ * 3600 * 1000);
  return Booking.create({
    customer: world.customer._id, venue: world.venue._id, space: hall._id, eventDate: startTime, shift: "day", startTime,
    endTime: new Date(startTime.getTime() + 3600 * 1000), numberOfGuests: 50, eventType: "Wedding", contactName: "J", phoneNumber: "9800000000",
    totalPrice: 100000, depositAmount: 20000, balanceAmount: 80000, status,
  });
};

describe("inquiry lists", () => {
  it("pages newest first, filters by tab and reports every tab's size", async () => {
    for (let i = 0; i < 5; i++) await inquiry();
    await inquiry({ status: "quoted" });
    await inquiry({ status: "declined" });
    await inquiry({ status: "accepted" });

    const first = await as(world.owner).get("/api/inquiries/owner?page=1&limit=3");
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(3);
    expect(first.body.data).toMatchObject({ total: 8, pages: 3, page: 1 });
    expect(first.body.data.counts).toMatchObject({ all: 8, pending: 5, quoted: 2, closed: 1, booked: 0 });

    const last = await as(world.owner).get("/api/inquiries/owner?page=3&limit=3");
    expect(last.body.data.items).toHaveLength(2);

    const quoted = await as(world.owner).get("/api/inquiries/owner?group=quoted");
    expect(quoted.body.data.items.map((q) => q.status).sort()).toEqual(["accepted", "quoted"]);
    expect(quoted.body.data.total).toBe(2);
  });

  it("a request that became a booking is 'booked', whatever its status", async () => {
    const b = await booking("confirmed", 20);
    await inquiry({ status: "accepted", booking: b._id });
    await inquiry();
    const res = await as(world.customer).get("/api/inquiries/my?group=booked");
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.counts).toMatchObject({ all: 2, booked: 1, pending: 1, quoted: 0 });
  });

  it("the customer sees only their own, can narrow to one venue, and an unknown tab is a 400", async () => {
    await inquiry();
    expect((await as(world.owner).get("/api/inquiries/my?page=1")).status).toBe(403);
    const mine = await as(world.customer).get(`/api/inquiries/my?group=open&venue=${world.venue._id}`);
    expect(mine.body.data.total).toBe(1);
    const other = await as(world.customer).get("/api/inquiries/my?group=open&venue=000000000000000000000000");
    expect(other.body.data.total).toBe(0);
    expect((await as(world.customer).get("/api/inquiries/my?group=nonsense")).status).toBe(400);
  });

  it("without page or group it is still the plain list", async () => {
    await inquiry();
    const res = await as(world.customer).get("/api/inquiries/my");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("limit is capped at 50", async () => {
    const res = await as(world.owner).get("/api/inquiries/owner?page=1&limit=9999");
    expect(res.status).toBe(200);
  });
});

describe("booking lists", () => {
  it("the owner's tabs: upcoming soonest first, completed and cancelled newest first", async () => {
    await booking("confirmed", 10);
    await booking("pending_deposit", 5);
    await booking("completed", -3);
    await booking("completed", -9);
    await booking("cancelled", 2);

    const up = await as(world.owner).get("/api/bookings/owner-bookings?group=upcoming");
    expect(up.body.data.counts).toMatchObject({ all: 5, upcoming: 2, completed: 2, cancelled: 1 });
    const times = up.body.data.items.map((b) => new Date(b.startTime).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const done = await as(world.owner).get("/api/bookings/owner-bookings?group=completed&limit=1&page=2");
    expect(done.body.data).toMatchObject({ total: 2, pages: 2 });
    expect(done.body.data.items).toHaveLength(1);
  });

  it("the customer's tabs: a date that has passed is 'past', not 'upcoming'", async () => {
    await booking("confirmed", 7);
    await booking("completed", -4);
    await booking("cancelled", 3);
    const res = await as(world.customer).get("/api/bookings/my-bookings?group=past");
    expect(res.body.data.counts).toMatchObject({ all: 3, upcoming: 1, past: 1, cancelled: 1 });
    expect(res.body.data.items).toHaveLength(1);
    expect((await as(world.owner).get("/api/bookings/my-bookings?page=1")).status).toBe(403);
  });

  it("without page or group it is still the plain list", async () => {
    await booking("confirmed", 7);
    expect(Array.isArray((await as(world.customer).get("/api/bookings/my-bookings")).body.data)).toBe(true);
  });
});
