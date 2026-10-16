const mongoose = require("mongoose");
const User = require("../model/user");
const { startDb, stopDb, makeUser, as, makeVenue, makeSpace, objectId } = require("./helpers/api");

let owner;
let customer;
let venue;

beforeAll(async () => {
  await startDb();
  owner = await makeUser("VenueOwner");
  venue = await makeVenue(owner, { venueName: "Fav Hall" });
  await makeSpace(venue, { name: "Small", capacity: 60 });
  await makeSpace(venue, { name: "Large", capacity: 250 });
});

afterAll(stopDb);

beforeEach(async () => {
  customer = await makeUser("Customer");
});

const toggle = (user, venueId) => as(user).post(`/api/user/favorites/${venueId}`);

describe("favorites API", () => {
  describe("toggle", () => {
    it("adds a venue, then removes it the second time", async () => {
      const added = await toggle(customer, venue._id);
      expect(added.status).toBe(200);
      expect(added.body).toMatchObject({ success: true, message: "Added to favorites" });
      expect(added.body.data).toEqual([String(venue._id)]);

      const removed = await toggle(customer, venue._id);
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ success: true, message: "Removed from favorites" });
      expect(removed.body.data).toEqual([]);
    });

    it("never stores the same venue twice, even for simultaneous toggles", async () => {
      await Promise.all([1, 2, 3, 4].map(() => toggle(customer, venue._id)));
      const stored = (await User.findById(customer._id).select("favorites").lean()).favorites;
      // an even number of toggles always lands back on "not a favorite"
      expect(stored).toHaveLength(0);
      await toggle(customer, venue._id);
      expect((await User.findById(customer._id).select("favorites").lean()).favorites).toHaveLength(1);
    });

    it("keeps each user's favorites separate", async () => {
      const other = await makeUser("Customer");
      await toggle(customer, venue._id);
      const list = await as(other).get("/api/user/favorites");
      expect(list.body.data).toEqual([]);
    });

    it("works for an Admin account too (any signed-in user)", async () => {
      const admin = await makeUser("Admin");
      const res = await toggle(admin, venue._id);
      expect(res.status).toBe(200);
    });

    it("rejects a malformed venue id with 400", async () => {
      const res = await toggle(customer, "not-an-id");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid Venue ID/);
    });

    it("returns 404 for a venue that does not exist or was deleted", async () => {
      expect((await toggle(customer, objectId())).status).toBe(404);
      const gone = await makeVenue(owner, { venueName: "Gone", isDeleted: true });
      expect((await toggle(customer, gone._id)).status).toBe(404);
    });

    it("requires a session", async () => {
      const res = await toggle(null, venue._id);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("list", () => {
    it("starts empty", async () => {
      const res = await as(customer).get("/api/user/favorites");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it("returns venue cards with the largest space and the number of spaces", async () => {
      await toggle(customer, venue._id);
      const res = await as(customer).get("/api/user/favorites");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const [card] = res.body.data;
      expect(card).toMatchObject({ _id: String(venue._id), venueName: "Fav Hall", maxCapacity: 250, spaceCount: 2 });
      expect(card.location.city).toBe("Kathmandu");
    });

    it("keeps the order the user favourited them in", async () => {
      const a = await makeVenue(owner, { venueName: "Alpha" });
      const b = await makeVenue(owner, { venueName: "Beta" });
      await toggle(customer, b._id);
      await toggle(customer, venue._id);
      await toggle(customer, a._id);
      const res = await as(customer).get("/api/user/favorites");
      expect(res.body.data.map((v) => v.venueName)).toEqual(["Beta", "Fav Hall", "Alpha"]);
    });

    it("hides venues that are no longer approved or were deleted, but keeps them if they come back", async () => {
      const temp = await makeVenue(owner, { venueName: "Temp" });
      await toggle(customer, temp._id);
      await toggle(customer, venue._id);

      await mongoose.model("Venue").updateOne({ _id: temp._id }, { status: "pending" });
      expect((await as(customer).get("/api/user/favorites")).body.data.map((v) => v.venueName)).toEqual(["Fav Hall"]);

      await mongoose.model("Venue").updateOne({ _id: temp._id }, { status: "approved", isDeleted: true });
      expect((await as(customer).get("/api/user/favorites")).body.data.map((v) => v.venueName)).toEqual(["Fav Hall"]);

      await mongoose.model("Venue").updateOne({ _id: temp._id }, { isDeleted: false });
      expect((await as(customer).get("/api/user/favorites")).body.data).toHaveLength(2);
    });

    it("requires a session", async () => {
      expect((await as(null).get("/api/user/favorites")).status).toBe(401);
    });
  });
});
