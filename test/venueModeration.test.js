const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../model/user");
const Venue = require("../model/venue");
const { updateVenueStatus, toggleFeatured } = require("../services/venueService");

let mongod;
let owner;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  owner = await User.create({ name: "Owner", email: "mod-owner@test.dev", password: "hashedpassword", role: "VenueOwner" });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

const makeVenue = (name) =>
  Venue.create({
    owner: owner._id,
    venueName: name,
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
  });

describe("venue moderation", () => {
  it("un-features a venue when it is rejected, so it cannot reappear on the landing page if re-approved later", async () => {
    const venue = await makeVenue("Featured Hall");
    await toggleFeatured(venue._id);
    expect((await Venue.findById(venue._id)).isFeatured).toBe(true);

    await updateVenueStatus(venue._id, "rejected", null);
    const rejected = await Venue.findById(venue._id);
    expect(rejected.status).toBe("rejected");
    expect(rejected.isFeatured).toBe(false);

    await updateVenueStatus(venue._id, "approved", null);
    expect((await Venue.findById(venue._id)).isFeatured).toBe(false);
  });

  it("keeps the featured flag when a venue is approved again without being rejected", async () => {
    const venue = await makeVenue("Stays Featured");
    await toggleFeatured(venue._id);
    await updateVenueStatus(venue._id, "approved", null);
    expect((await Venue.findById(venue._id)).isFeatured).toBe(true);
  });

  it("rejects an unknown status", async () => {
    const venue = await makeVenue("Bad Status");
    await expect(updateVenueStatus(venue._id, "banana", null)).rejects.toMatchObject({ statusCode: 400 });
  });
});
