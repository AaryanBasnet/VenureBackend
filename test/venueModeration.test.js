const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../model/user");
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const Space = require("../model/space");
const { updateVenueStatus, toggleFeatured, softDeleteVenue } = require("../services/venueService");

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

// A live venue always has a hall (an admin cannot approve one without)
const makeVenue = async (name) => {
  const venue = await Venue.create({
    owner: owner._id,
    venueName: name,
    location: { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" },
    status: "approved",
  });
  await require("../model/space").create({ venue: venue._id, name: "Main Hall", capacity: 100 });
  return venue;
};

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

  it("refuses to feature a venue that is pending or rejected, but always lets one be un-featured", async () => {
    const venue = await makeVenue("Not Live Yet");
    await Venue.updateOne({ _id: venue._id }, { status: "pending" });
    await expect(toggleFeatured(venue._id)).rejects.toMatchObject({ statusCode: 400 });
    await Venue.updateOne({ _id: venue._id }, { status: "rejected" });
    await expect(toggleFeatured(venue._id)).rejects.toMatchObject({ statusCode: 400 });
    expect((await Venue.findById(venue._id)).isFeatured).toBe(false);

    // A venue that is somehow featured and no longer approved can still be taken off the landing page
    await Venue.updateOne({ _id: venue._id }, { isFeatured: true });
    expect((await toggleFeatured(venue._id)).isFeatured).toBe(false);
  });

  describe("deleting a venue that has bookings", () => {
    const bookingFor = async (venue, { status = "confirmed", daysFromNow = 10 } = {}) => {
      const space = await Space.create({ venue: venue._id, name: `Hall ${Math.random()}`, capacity: 100 });
      const startTime = new Date(Date.now() + daysFromNow * 86400000);
      return Booking.create({
        customer: new mongoose.Types.ObjectId(),
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

    it("is refused while an upcoming booking is confirmed, and leaves the venue listed", async () => {
      const venue = await makeVenue("Has Bookings");
      await bookingFor(venue);
      await expect(softDeleteVenue(venue._id, owner._id, "VenueOwner")).rejects.toMatchObject({ statusCode: 409 });
      await expect(softDeleteVenue(venue._id, owner._id, "Admin")).rejects.toMatchObject({ statusCode: 409 });
      expect((await Venue.findById(venue._id)).isDeleted).toBe(false);
    });

    it("is allowed once the bookings are cancelled, completed or in the past", async () => {
      const venue = await makeVenue("No Live Bookings");
      await bookingFor(venue, { status: "cancelled" });
      await bookingFor(venue, { status: "completed", daysFromNow: -5 });
      await bookingFor(venue, { status: "confirmed", daysFromNow: -2 });
      const deleted = await softDeleteVenue(venue._id, owner._id, "VenueOwner");
      expect(deleted.isDeleted).toBe(true);
    });
  });

  it("rejects an unknown status", async () => {
    const venue = await makeVenue("Bad Status");
    await expect(updateVenueStatus(venue._id, "banana", null)).rejects.toMatchObject({ statusCode: 400 });
  });
});
