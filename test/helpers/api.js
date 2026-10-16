// Shared set-up for the HTTP-level suites (venues, favorites, chat, contact, profile, admin users...):
// an in-memory MongoDB, users that are signed in through the same HttpOnly cookie the app uses, and a tiny
// supertest wrapper. Users are created directly (no bcrypt) so suites stay fast; the real register/login
// flow is covered by auth.test.js.
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../../app");
const User = require("../../model/user");
const Venue = require("../../model/venue");
const Space = require("../../model/space");

let mongod;
const location = { address: "1 Test St", city: "Kathmandu", state: "Bagmati", country: "Nepal" };

const startDb = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
};

const stopDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
};

const clearDb = async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
};

let counter = 0;
const makeUser = (role = "Customer", overrides = {}) => {
  counter += 1;
  return User.create({
    name: `${role} ${counter}`,
    email: `${role.toLowerCase()}${counter}@api.test`,
    password: "hashedpassword",
    role,
    ...overrides,
  });
};

const tokenFor = (user, expiresIn = "1h") => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn });
const cookieFor = (user) => `accessToken=${tokenFor(user)}`;

// as(user).get("/api/x"): sends the user's session cookie. as(null) is a signed-out visitor.
const as = (user) => {
  const withCookie = (req) => (user ? req.set("Cookie", cookieFor(user)) : req);
  return {
    get: (path) => withCookie(request(app).get(path)),
    post: (path, body) => withCookie(request(app).post(path)).send(body),
    put: (path, body) => withCookie(request(app).put(path)).send(body),
    patch: (path, body) => withCookie(request(app).patch(path)).send(body),
    delete: (path) => withCookie(request(app).delete(path)),
    // multipart upload with extra text fields
    multipart: (method, path) => withCookie(request(app)[method](path)),
  };
};

const makeVenue = async (owner, overrides = {}) =>
  Venue.create({ owner: owner._id, venueName: "Test Hall", location, status: "approved", ...overrides });

const makeSpace = (venue, overrides = {}) =>
  Space.create({ venue: venue._id, name: "Main Hall", capacity: 100, ...overrides });

const objectId = () => new mongoose.Types.ObjectId();

module.exports = { app, request, startDb, stopDb, clearDb, makeUser, tokenFor, cookieFor, as, makeVenue, makeSpace, location, objectId };
