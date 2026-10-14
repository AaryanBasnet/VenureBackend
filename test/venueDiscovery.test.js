const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const Chat = require("../model/chat");
const Message = require("../model/message");
const venueService = require("../services/venueService");
const chatService = require("../services/chatService");

let mongod;
let owner;
let customer;
let small;
let large;
let smallSpace;

const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  owner = await User.create({ name: "Owner", email: "owner@disc.test", password: "hashedpassword", role: "VenueOwner" });
  customer = await User.create({ name: "Customer", email: "customer@disc.test", password: "hashedpassword", role: "Customer" });

  small = await Venue.create({ owner: owner._id, venueName: "Small Garden", location, status: "approved", amenities: ["Wifi", "Garden"], averageRating: 3 });
  large = await Venue.create({ owner: owner._id, venueName: "Large Palace", location, status: "approved", amenities: ["Wifi", "Parking"], averageRating: 5, totalReviews: 4 });
  smallSpace = await Space.create({ venue: small._id, name: "Lawn", capacity: 80 });
  await Space.create({ venue: large._id, name: "Grand Hall", capacity: 400 });
  await Space.create({ venue: large._id, name: "Terrace", capacity: 120 });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

describe("venue list", () => {
  it("attaches the largest space and the space count to every venue", async () => {
    const { venues } = await venueService.getApprovedVenues({});
    const palace = venues.find((v) => v.venueName === "Large Palace");
    expect(palace.maxCapacity).toBe(400);
    expect(palace.spaceCount).toBe(2);
  });

  it("filters by the number of guests a venue can hold", async () => {
    const { venues } = await venueService.getApprovedVenues({ guests: 200 });
    expect(venues.map((v) => v.venueName)).toEqual(["Large Palace"]);
  });

  it("requires every amenity that was asked for", async () => {
    const { venues } = await venueService.getApprovedVenues({ amenities: "Wifi,Garden" });
    expect(venues.map((v) => v.venueName)).toEqual(["Small Garden"]);
  });

  it("can sort by rating", async () => {
    const { venues } = await venueService.getApprovedVenues({ sort: "rating" });
    expect(venues[0].venueName).toBe("Large Palace");
  });
});

describe("availability", () => {
  it("returns the booked time ranges in a window and nothing personal", async () => {
    const start = new Date(Date.now() + 10 * 86400000);
    const end = new Date(start.getTime() + 5 * 3600000);
    await Booking.create({
      customer: customer._id, venue: small._id, space: smallSpace._id, startTime: start, endTime: end,
      numberOfGuests: 50, eventType: "Wedding", contactName: "Private Name", phoneNumber: "9800000000",
      totalPrice: 100000, depositAmount: 20000, balanceAmount: 80000, status: "confirmed",
    });

    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 30 * 86400000).toISOString();
    const booked = await venueService.getVenueAvailability(String(small._id), { from, to });

    expect(booked).toHaveLength(1);
    expect(Object.keys(booked[0]).sort()).toEqual(["endTime", "space", "startTime"]);
  });

  it("ignores cancelled bookings", async () => {
    await Booking.updateMany({}, { status: "cancelled" });
    const booked = await venueService.getVenueAvailability(String(small._id), {
      from: new Date().toISOString(),
      to: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    expect(booked).toHaveLength(0);
  });

  it("rejects an invalid or oversized window", async () => {
    await expect(venueService.getVenueAvailability(String(small._id), { from: "nope", to: "also nope" })).rejects.toThrow();
    await expect(
      venueService.getVenueAvailability(String(small._id), { from: new Date().toISOString(), to: new Date(Date.now() + 200 * 86400000).toISOString() })
    ).rejects.toThrow();
  });
});

describe("chat list", () => {
  it("includes the last message and how many are unread by the viewer", async () => {
    const chat = await Chat.create({ participants: [customer._id, owner._id], venueId: small._id });
    await Message.create({ chatId: chat._id, sender: customer._id, receiver: owner._id, text: "First question" });
    await Message.create({ chatId: chat._id, sender: owner._id, receiver: customer._id, text: "Yes, that date is open" });

    const forCustomer = await chatService.getUserChats(customer._id, null);
    expect(forCustomer[0].lastMessage.text).toBe("Yes, that date is open");
    expect(forCustomer[0].unreadCount).toBe(1);

    const forOwner = await chatService.getUserChats(owner._id, null);
    expect(forOwner[0].unreadCount).toBe(1);
  });
});
