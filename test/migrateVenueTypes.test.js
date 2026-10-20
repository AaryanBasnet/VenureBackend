// scripts/migrate-venue-types.js: the old five categories become the type of each space, and venues are filed under
// one of the three new venue types.
const mongoose = require("mongoose");
const Venue = require("../model/venue");
const Space = require("../model/space");
const { run, OLD_TO_NEW } = require("../scripts/migrate-venue-types");
const { startDb, stopDb, clearDb, makeUser, location } = require("./helpers/api");

let owner;

beforeAll(async () => {
  await startDb();
  owner = await makeUser("VenueOwner");
});
afterAll(stopDb);
beforeEach(clearDb);

// Written straight into the collection: the model would refuse an old category now, exactly as it did not before the change
const oldVenue = async (venueName, category, spaces = [{ name: "Main Hall", capacity: 100 }]) => {
  const _id = new mongoose.Types.ObjectId();
  await Venue.collection.insertOne({ _id, owner: owner._id, venueName, category, location, status: "approved", isDeleted: false, createdAt: new Date(), updatedAt: new Date() });
  for (const s of spaces) await Space.collection.insertOne({ venue: _id, isActive: true, amenities: [], createdAt: new Date(), updatedAt: new Date(), ...s });
  return _id;
};

describe("migrate-venue-types", () => {
  it("files every old category under the nearest venue type and gives its spaces the old category as their type", async () => {
    const ids = {};
    for (const old of Object.keys(OLD_TO_NEW)) ids[old] = await oldVenue(`Venue ${old}`, old);

    const report = await run();
    expect(report).toMatchObject({ venues: 5, spaces: 5 });

    for (const [old, now] of Object.entries(OLD_TO_NEW)) {
      const venue = await Venue.findById(ids[old]).lean();
      expect(venue.category).toBe(now);
      expect(venue.spaceTypes).toEqual([old]);
      expect((await Space.find({ venue: ids[old] }).lean()).map((s) => s.spaceType)).toEqual([old]);
    }
    expect(OLD_TO_NEW).toEqual({
      "heritage-courtyards": "heritage-traditional",
      "garden-estates": "banquet-party-palace",
      "intimate-halls": "banquet-party-palace",
      "mountain-retreats": "hotel-resort",
      "rooftop-terraces": "hotel-resort",
    });
  });

  it("keeps the capacity summary right and leaves a space that already has a type alone", async () => {
    const id = await oldVenue("Mixed", "garden-estates", [
      { name: "Untyped", capacity: 80 },
      { name: "Typed", capacity: 400, spaceType: "rooftop-terraces" },
    ]);
    await run();
    const venue = await Venue.findById(id).lean();
    expect(venue).toMatchObject({ category: "banquet-party-palace", maxCapacity: 400, spaceCount: 2 });
    expect(venue.spaceTypes).toEqual(["garden-estates", "rooftop-terraces"]);
    const spaces = Object.fromEntries((await Space.find({ venue: id }).lean()).map((s) => [s.name, s.spaceType]));
    expect(spaces).toEqual({ Untyped: "garden-estates", Typed: "rooftop-terraces" });
  });

  it("is safe to run twice, and does not touch a venue already on a new type", async () => {
    await oldVenue("Old", "intimate-halls");
    const already = await Venue.create({ owner: owner._id, venueName: "New", category: "hotel-resort", location, status: "approved" });
    await Space.create({ venue: already._id, name: "Lawn", capacity: 50, spaceType: "garden-estates" });

    expect(await run()).toMatchObject({ venues: 1 });
    expect(await run()).toMatchObject({ venues: 0, spaces: 0 });
    expect(await Venue.findById(already._id).lean()).toMatchObject({ category: "hotel-resort", spaceTypes: ["garden-estates"] });
  });

  it("changes nothing in a dry run", async () => {
    const id = await oldVenue("Dry", "mountain-retreats");
    const report = await run({ dryRun: true });
    expect(report).toMatchObject({ venues: 1, spaces: 1 });
    expect((await Venue.findById(id).lean()).category).toBe("mountain-retreats");
    expect((await Space.findOne({ venue: id }).lean()).spaceType).toBeUndefined();
  });

  it("makes the migrated venues show up under the new filters", async () => {
    await oldVenue("Courtyard House", "heritage-courtyards");
    await run();
    const app = require("../app");
    const request = require("supertest");
    const byType = await request(app).get("/api/venues?category=heritage-traditional");
    expect(byType.body.data.map((v) => v.venueName)).toEqual(["Courtyard House"]);
    const bySpace = await request(app).get("/api/venues?spaceType=heritage-courtyards");
    expect(bySpace.body.data.map((v) => v.venueName)).toEqual(["Courtyard House"]);
  });

  describe("the saved home page copy", () => {
    const LandingContent = require("../model/landingContent");
    const oldIntro = { eyebrow: "Venue types", title: "Find your", accent: "perfect space", description: "Five distinct categories of Nepal's finest heritage venues, each with its own character and atmosphere." };

    it("is renamed to Spaces when it still has the old wording, and left alone when an admin changed it", async () => {
      await LandingContent.create({ key: "home", content: { venueTypesIntro: oldIntro } });
      expect(await run({ dryRun: true })).toMatchObject({ landingCopy: true }); // reported, not applied
      expect((await LandingContent.findOne({ key: "home" }).lean()).content.venueTypesIntro.eyebrow).toBe("Venue types");

      expect(await run()).toMatchObject({ landingCopy: true });
      const intro = (await LandingContent.findOne({ key: "home" }).lean()).content.venueTypesIntro;
      expect(intro).toMatchObject({ eyebrow: "Spaces", title: "Find your", accent: "perfect space" });
      expect(intro.description).toMatch(/^Five kinds of space/);
      expect(await run()).not.toHaveProperty("landingCopy"); // second run: nothing to do

      await LandingContent.updateOne({ key: "home" }, { $set: { "content.venueTypesIntro": { ...oldIntro, description: "Our own words." } } });
      expect(await run()).not.toHaveProperty("landingCopy");
      expect((await LandingContent.findOne({ key: "home" }).lean()).content.venueTypesIntro.eyebrow).toBe("Venue types");
    });
  });
});
