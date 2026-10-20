// Public (signed-out) venue endpoints: list and filters, featured, category counts, detail, spaces, availability.
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const Space = require("../model/space");
const { startDb, stopDb, makeUser, as, makeVenue, makeSpace, objectId, location } = require("./helpers/api");

let owner;
let customer;

beforeAll(async () => {
  await startDb();
  await Venue.init();
  owner = await makeUser("VenueOwner", { name: "Hall Owner", email: "private-owner@venue.test", phone: "9800000099" });
  customer = await makeUser("Customer");
});

afterAll(stopDb);

beforeEach(async () => {
  await Promise.all([Venue.deleteMany({}), Space.deleteMany({}), Booking.deleteMany({})]);
});

const list = (query = "") => as(null).get(`/api/venues${query}`);
const names = async (query) => (await list(query)).body.data.map((v) => v.venueName);

describe("GET /api/venues (list)", () => {
  it("returns approved venues only, with paging info and no internal fields", async () => {
    await makeVenue(owner, { venueName: "Live Hall", drinkOptions: [{ name: "Bar", items: ["Beer"] }], packages: [{ name: "Basic", pricePerPlate: 1000 }] });
    await makeVenue(owner, { venueName: "Waiting Hall", status: "pending" });
    await makeVenue(owner, { venueName: "Refused Hall", status: "rejected" });
    await makeVenue(owner, { venueName: "Deleted Hall", isDeleted: true });

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((v) => v.venueName)).toEqual(["Live Hall"]);
    expect(res.body.total).toBe(1);
    expect(res.body.pages).toBe(1);
    const [venue] = res.body.data;
    expect(venue).toMatchObject({ minPricePerPlate: 1000, maxCapacity: 0, spaceCount: 0 });
    expect(venue).not.toHaveProperty("priceSortKey");
    expect(venue).not.toHaveProperty("drinkOptions"); // detail page only
  });

  it("is empty, not an error, when nothing matches", async () => {
    const res = await list("?search=zzzz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: [], total: 0, pages: 0 });
  });

  it("paginates (default page size 6) and the pages do not overlap", async () => {
    for (let i = 1; i <= 8; i++) await makeVenue(owner, { venueName: `Hall ${i}` });

    const first = await list();
    expect(first.body.data).toHaveLength(6);
    expect(first.body).toMatchObject({ total: 8, pages: 2 });

    const second = await list("?page=2");
    expect(second.body.data).toHaveLength(2);

    const ids = [...first.body.data, ...second.body.data].map((v) => v._id);
    expect(new Set(ids).size).toBe(8);
    expect(first.body.data[0].venueName).toBe("Hall 8"); // newest first by default
  });

  it("honours limit, and caps it at 50", async () => {
    for (let i = 0; i < 3; i++) await makeVenue(owner, { venueName: `H${i}` });
    expect((await list("?limit=2")).body).toMatchObject({ total: 3, pages: 2 });
    expect((await list("?limit=2")).body.data).toHaveLength(2);
    const huge = await list("?limit=5000");
    expect(huge.status).toBe(200);
    expect(huge.body.pages).toBe(1);
  });

  it("searches by name, case-insensitively and literally (regex characters are escaped)", async () => {
    await makeVenue(owner, { venueName: "Royal Palace" });
    await makeVenue(owner, { venueName: "Garden View" });
    expect(await names("?search=royal")).toEqual(["Royal Palace"]);
    expect(await names("?search=.*")).toEqual([]);
  });

  it("filters by city and by venue type", async () => {
    await makeVenue(owner, { venueName: "KTM Banquet", category: "banquet-party-palace" });
    await makeVenue(owner, { venueName: "Pokhara Banquet", category: "banquet-party-palace", location: { ...location, city: "Pokhara" } });
    await makeVenue(owner, { venueName: "KTM Hotel", category: "hotel-resort" });

    expect((await names("?city=Pokhara"))).toEqual(["Pokhara Banquet"]);
    expect((await names("?category=hotel-resort"))).toEqual(["KTM Hotel"]);
    expect((await names("?category=banquet-party-palace&city=Kathmandu"))).toEqual(["KTM Banquet"]);
  });

  it("filters by the kind of space a venue has, and combines it with the venue type", async () => {
    const garden = await makeVenue(owner, { venueName: "Garden Hotel", category: "hotel-resort" });
    const both = await makeVenue(owner, { venueName: "Palace", category: "banquet-party-palace" });
    await makeVenue(owner, { venueName: "No Spaces", category: "hotel-resort" });
    await makeSpace(garden, { name: "Lawn", spaceType: "garden-estates" });
    await makeSpace(both, { name: "Lawn", spaceType: "garden-estates" });
    await makeSpace(both, { name: "Roof", spaceType: "rooftop-terraces" });
    // an inactive space does not count
    await makeSpace(garden, { name: "Old Roof", spaceType: "rooftop-terraces", isActive: false });

    expect(new Set(await names("?spaceType=garden-estates"))).toEqual(new Set(["Garden Hotel", "Palace"]));
    expect(await names("?spaceType=rooftop-terraces")).toEqual(["Palace"]);
    expect(await names("?spaceType=intimate-halls")).toEqual([]);
    expect(await names("?spaceType=garden-estates&category=hotel-resort")).toEqual(["Garden Hotel"]);
  });

  it("rejects an unknown venue type, space type or a malformed query with 400", async () => {
    const res = await list("?category=castles");
    expect(res.status).toBe(400);
    expect((await list("?category=garden-estates")).status).toBe(400); // an old label is no venue type now
    expect((await list("?spaceType=castles")).status).toBe(400);
    expect((await list("?spaceType=hotel-resort")).status).toBe(400);
    expect(res.body.success).toBe(false);
    expect((await list("?sort=cheapest")).status).toBe(400);
    expect((await list("?guests=-5")).status).toBe(400);
  });

  it("filters by guests: some space must hold that many", async () => {
    const small = await makeVenue(owner, { venueName: "Small" });
    const big = await makeVenue(owner, { venueName: "Big" });
    await makeSpace(small, { capacity: 80 });
    await makeSpace(big, { capacity: 400 });
    await makeSpace(big, { name: "Terrace", capacity: 120 });

    expect(await names("?guests=200")).toEqual(["Big"]);
    expect((await names("?guests=50")).sort()).toEqual(["Big", "Small"]);
    expect(await names("?guests=1000")).toEqual([]);
    const card = (await list("?guests=200")).body.data[0];
    expect(card).toMatchObject({ maxCapacity: 400, spaceCount: 2 });
  });

  it("requires every amenity asked for", async () => {
    await makeVenue(owner, { venueName: "Wifi Only", amenities: ["Wifi"] });
    await makeVenue(owner, { venueName: "Wifi Parking", amenities: ["Wifi", "Parking"] });
    expect(await names("?amenities=Wifi")).toHaveLength(2);
    expect(await names("?amenities=Wifi,Parking")).toEqual(["Wifi Parking"]);
  });

  it("filters by package price range and sorts by price, venues without packages last", async () => {
    await makeVenue(owner, { venueName: "Budget", packages: [{ name: "A", pricePerPlate: 800 }] });
    await makeVenue(owner, { venueName: "Premium", packages: [{ name: "B", pricePerPlate: 5000 }] });
    await makeVenue(owner, { venueName: "No Menu" });

    expect(await names("?minPrice=1000")).toEqual(["Premium"]);
    expect(await names("?maxPrice=1000")).toEqual(["Budget"]);
    expect(await names("?sort=price_asc")).toEqual(["Budget", "Premium", "No Menu"]);
    expect((await names("?sort=price_desc"))[0]).toBe("Premium");
  });

  it("sorts by rating and by popularity", async () => {
    await makeVenue(owner, { venueName: "Loved", averageRating: 5, totalReviews: 3 });
    await makeVenue(owner, { venueName: "Talked About", averageRating: 3, totalReviews: 30 });
    await makeVenue(owner, { venueName: "Unknown" });
    expect(await names("?sort=rating")).toEqual(["Loved", "Talked About", "Unknown"]);
    expect(await names("?sort=popular")).toEqual(["Talked About", "Loved", "Unknown"]);
  });

  it("finds venues near a point (radius in miles)", async () => {
    await makeVenue(owner, { venueName: "Near", geoCoordinates: { type: "Point", coordinates: [85.324, 27.7172] } });
    await makeVenue(owner, { venueName: "Far", geoCoordinates: { type: "Point", coordinates: [83.9856, 28.2096] } }); // Pokhara, ~100 miles away
    const res = await list("?lng=85.32&lat=27.71&radius=10");
    expect(res.status).toBe(200);
    expect(res.body.data.map((v) => v.venueName)).toEqual(["Near"]);
    expect(res.body.total).toBe(1);
  });

  it("works without a session and does not need cookies", async () => {
    await makeVenue(owner, { venueName: "Open To All" });
    expect((await as(customer).get("/api/venues")).status).toBe(200);
    expect((await list()).status).toBe(200);
  });
});

describe("GET /api/venues/featured and /api/venues/categories/counts", () => {
  it("shows featured, approved venues only (at most 3, newest first)", async () => {
    for (let i = 1; i <= 4; i++) await makeVenue(owner, { venueName: `Featured ${i}`, isFeatured: true });
    await makeVenue(owner, { venueName: "Plain" });
    await makeVenue(owner, { venueName: "Featured But Pending", isFeatured: true, status: "pending" });
    await makeVenue(owner, { venueName: "Featured But Deleted", isFeatured: true, isDeleted: true });

    const res = await as(null).get("/api/venues/featured");
    expect(res.status).toBe(200);
    expect(res.body.data.map((v) => v.venueName)).toEqual(["Featured 4", "Featured 3", "Featured 2"]);
    expect(res.body.data[0]).toHaveProperty("maxCapacity");
    expect(res.body.data[0]).not.toHaveProperty("priceSortKey");
  });

  it("is an empty list when nothing is featured (and not mistaken for a venue id)", async () => {
    const res = await as(null).get("/api/venues/featured");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it("counts approved venues per venue type and per kind of space", async () => {
    const a = await makeVenue(owner, { category: "hotel-resort" });
    const b = await makeVenue(owner, { category: "hotel-resort" });
    const c = await makeVenue(owner, { category: "heritage-traditional" });
    const pending = await makeVenue(owner, { category: "heritage-traditional", status: "pending" });
    const deleted = await makeVenue(owner, { category: "banquet-party-palace", isDeleted: true });
    await makeVenue(owner, {}); // no category
    await makeSpace(a, { name: "Lawn", spaceType: "garden-estates" });
    await makeSpace(a, { name: "Roof", spaceType: "rooftop-terraces" });
    await makeSpace(b, { name: "Lawn", spaceType: "garden-estates" });
    await makeSpace(c, { name: "Court", spaceType: "heritage-courtyards" });
    await makeSpace(pending, { name: "Court", spaceType: "heritage-courtyards" });
    await makeSpace(deleted, { name: "Lawn", spaceType: "garden-estates" });

    const res = await as(null).get("/api/venues/categories/counts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        categories: { "hotel-resort": 2, "heritage-traditional": 1 },
        spaceTypes: { "garden-estates": 2, "rooftop-terraces": 1, "heritage-courtyards": 1 },
      },
    });
  });
});

describe("GET /api/venues/:id", () => {
  it("returns the venue with the owner's public name and avatar, never the contact details", async () => {
    const venue = await makeVenue(owner, {
      venueName: "Detail Hall",
      description: "Lovely",
      contactPhone: "+977 9800000000",
      packages: [{ name: "Gold", pricePerPlate: 2850, minPlates: 60, highlights: ["Sekuwa"] }],
      drinkOptions: [{ name: "Hard drinks", items: ["Beer", "Whisky"] }],
    });

    const res = await as(null).get(`/api/venues/${venue._id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data).toMatchObject({ _id: String(venue._id), venueName: "Detail Hall", description: "Lovely", contactPhone: "+977 9800000000" });
    expect(data.packages[0]).toMatchObject({ name: "Gold", pricePerPlate: 2850, minPlates: 60 });
    expect(data.drinkOptions[0].items).toEqual(["Beer", "Whisky"]);
    expect(data.owner).toEqual({ _id: String(owner._id), name: "Hall Owner", avatar: "" });
    expect(JSON.stringify(res.body)).not.toContain("private-owner@venue.test");
    expect(JSON.stringify(res.body)).not.toContain("9800000099");
    expect(data).not.toHaveProperty("priceSortKey");
  });

  it("is a 404 for a pending, rejected, deleted or unknown venue", async () => {
    const pending = await makeVenue(owner, { status: "pending" });
    const rejected = await makeVenue(owner, { status: "rejected" });
    const deleted = await makeVenue(owner, { isDeleted: true });
    for (const id of [pending._id, rejected._id, deleted._id, objectId()]) {
      const res = await as(null).get(`/api/venues/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, message: "Venue not found" });
    }
  });

  it("is a 400 for a malformed id", async () => {
    const res = await as(null).get("/api/venues/not-an-id");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/venues/:venueId/spaces", () => {
  it("lists active spaces by name with the resolved shift hours", async () => {
    const venue = await makeVenue(owner);
    await makeSpace(venue, { name: "Terrace", capacity: 120 });
    await makeSpace(venue, { name: "Banquet", capacity: 300, shiftOverrides: [{ shift: "night", startTime: "18:00", endTime: "23:00" }] });
    await makeSpace(venue, { name: "Closed Wing", capacity: 50, isActive: false });
    const otherVenue = await makeVenue(owner, { venueName: "Elsewhere" });
    await makeSpace(otherVenue, { name: "Not Mine" });

    const res = await as(null).get(`/api/venues/${venue._id}/spaces`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.name)).toEqual(["Banquet", "Terrace"]);
    const [banquet, terrace] = res.body.data;
    expect(banquet.resolvedShifts.night).toEqual({ startTime: "18:00", endTime: "23:00" });
    expect(Object.keys(banquet.resolvedShifts).sort()).toEqual(["day", "full_day", "night"]);
    expect(terrace.resolvedShifts.night).not.toEqual({ startTime: "18:00", endTime: "23:00" });
  });

  it("is an empty list for a venue without spaces", async () => {
    const venue = await makeVenue(owner);
    expect((await as(null).get(`/api/venues/${venue._id}/spaces`)).body).toEqual({ success: true, data: [] });
  });
});

describe("GET /api/venues/:venueId/availability", () => {
  const DAY = 86400000;
  const from = new Date("2030-06-01T00:00:00Z");
  const to = new Date("2030-06-30T00:00:00Z");
  const query = (venue, f = from, t = to) => `/api/venues/${venue._id}/availability?from=${f.toISOString()}&to=${t.toISOString()}`;

  const book = (venue, space, start, status = "confirmed", extra = {}) =>
    Booking.create({
      customer: customer._id,
      venue: venue._id,
      space: space._id,
      startTime: start,
      endTime: new Date(start.getTime() + 4 * 3600000),
      numberOfGuests: 50,
      eventType: "Wedding",
      contactName: "Secret Guest",
      phoneNumber: "9811111111",
      totalPrice: 100000,
      depositAmount: 20000,
      balanceAmount: 80000,
      status,
      ...extra,
    });

  it("returns booked ranges per space and no personal details", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    await book(venue, space, new Date("2030-06-10T06:00:00Z"));
    await book(venue, space, new Date("2030-06-20T06:00:00Z"), "completed");

    const res = await as(null).get(query(venue));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({ space: String(space._id), startTime: "2030-06-10T06:00:00.000Z", endTime: "2030-06-10T10:00:00.000Z" });
    expect(JSON.stringify(res.body)).not.toContain("Secret Guest");
    expect(JSON.stringify(res.body)).not.toContain("9811111111");
  });

  it("leaves out cancelled bookings, expired holds, bookings outside the window and other venues", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue);
    const other = await makeVenue(owner, { venueName: "Other" });
    const otherSpace = await makeSpace(other);
    await book(venue, space, new Date("2030-06-05T06:00:00Z"), "cancelled");
    await book(venue, space, new Date("2030-06-06T06:00:00Z"), "pending_deposit", { holdClaimExpiresAt: new Date("2020-01-01T00:00:00Z") });
    await book(venue, space, new Date("2030-07-15T06:00:00Z")); // after the window
    await book(other, otherSpace, new Date("2030-06-07T06:00:00Z"));
    const live = await book(venue, space, new Date("2030-06-08T06:00:00Z"), "pending_deposit", { holdClaimExpiresAt: new Date("2999-01-01T00:00:00Z") });

    const res = await as(null).get(query(venue));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].startTime).toBe(live.startTime.toISOString());
  });

  it("ignores spaces that were removed", async () => {
    const venue = await makeVenue(owner);
    const space = await makeSpace(venue, { isActive: false });
    await book(venue, space, new Date("2030-06-10T06:00:00Z"));
    expect((await as(null).get(query(venue))).body.data).toEqual([]);
  });

  it.each([
    ["no dates", (v) => `/api/venues/${v._id}/availability`],
    ["an invalid date", (v) => `/api/venues/${v._id}/availability?from=soon&to=later`],
    ["an end before the start", (v) => query(v, to, from)],
    ["a window longer than three months", (v) => query(v, from, new Date(from.getTime() + 94 * DAY))],
  ])("answers 400 for %s", async (_label, makeUrl) => {
    const venue = await makeVenue(owner);
    const res = await as(null).get(makeUrl(venue));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("answers 404 for a venue that is not live", async () => {
    const pending = await makeVenue(owner, { status: "pending" });
    expect((await as(null).get(query(pending))).status).toBe(404);
    expect((await as(null).get(query({ _id: objectId() }))).status).toBe(404);
  });
});
