const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const { toggleFavorite, getFavoriteVenues } = require("../services/favoriteService");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("favorite venues", () => {
  it("come back with the largest space and the number of spaces, like the venue list", async () => {
    const owner = await User.create({ name: "Owner", email: "fav-owner@test.dev", password: "hashedpassword", role: "VenueOwner" });
    const user = await User.create({ name: "Guest", email: "fav-guest@test.dev", password: "hashedpassword", role: "Customer" });
    const venue = await Venue.create({
      owner: owner._id,
      venueName: "Fav Hall",
      location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
      status: "approved",
    });
    await Space.create({ venue: venue._id, name: "Small", capacity: 60 });
    await Space.create({ venue: venue._id, name: "Large", capacity: 250 });

    await toggleFavorite(user._id, venue._id);
    const [fav] = await getFavoriteVenues(user._id);

    expect(fav.venueName).toBe("Fav Hall");
    expect(fav.maxCapacity).toBe(250);
    expect(fav.spaceCount).toBe(2);
  });

  it("skips venues that are not approved", async () => {
    const owner = await User.create({ name: "Owner2", email: "fav-owner2@test.dev", password: "hashedpassword", role: "VenueOwner" });
    const user = await User.create({ name: "Guest2", email: "fav-guest2@test.dev", password: "hashedpassword", role: "Customer" });
    const venue = await Venue.create({
      owner: owner._id,
      venueName: "Pending Hall",
      location: { address: "2 Test St", city: "Pokhara", state: "Gandaki", country: "Nepal" },
      status: "pending",
    });
    await toggleFavorite(user._id, venue._id);
    expect(await getFavoriteVenues(user._id)).toHaveLength(0);
  });
});
