const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

let mongod;
let User;
let loginWithGoogle;

const payload = (overrides = {}) => ({
  sub: "google-sub-1",
  email: "concierge@example.com",
  email_verified: true,
  name: "Concierge Guest",
  picture: "https://example.com/avatar.png",
  ...overrides,
});

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id"; // must be set before authService is required
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  User = require("../model/user");
  ({ loginWithGoogle } = require("../services/authService"));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  mockVerifyIdToken.mockReset();
});

const okToken = (overrides) => {
  mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload(overrides) });
};

describe("loginWithGoogle", () => {
  it("creates a new user on first sign-in, with no password", async () => {
    okToken();
    const result = await loginWithGoogle("id-token", "jest", "127.0.0.1");

    expect(result.user.email).toBe("concierge@example.com");
    expect(result.accessToken).toEqual(expect.any(String));

    const stored = await User.findOne({ email: "concierge@example.com" }).select("+password");
    expect(stored.googleId).toBe("google-sub-1");
    expect(stored.password).toBeUndefined();
    expect(stored.role).toBe("Customer");
  });

  it("logs the same person in again without creating a duplicate", async () => {
    okToken();
    await loginWithGoogle("id-token", "jest", "127.0.0.1");
    await loginWithGoogle("id-token", "jest", "127.0.0.1");

    expect(await User.countDocuments({ email: "concierge@example.com" })).toBe(1);
  });

  it("links Google to an existing password account with the same email", async () => {
    const existing = await User.create({
      name: "Concierge Guest",
      email: "concierge@example.com",
      password: "hashed-password-not-used-here",
    });

    okToken();
    const result = await loginWithGoogle("id-token", "jest", "127.0.0.1");

    expect(result.user._id.toString()).toBe(existing._id.toString());
    const stored = await User.findById(existing._id).select("+password");
    expect(stored.googleId).toBe("google-sub-1");
    expect(stored.password).toBe("hashed-password-not-used-here"); // untouched
  });

  it("rejects an unverified Google email", async () => {
    okToken({ email_verified: false });
    await expect(loginWithGoogle("id-token", "jest", "127.0.0.1")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token that fails verification", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("bad signature"));
    await expect(loginWithGoogle("id-token", "jest", "127.0.0.1")).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
