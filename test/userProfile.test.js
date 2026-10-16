// No network: Cloudinary's storage engine is replaced by an in-process one with the same contract.
jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));

const User = require("../model/user");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { startDb, stopDb, makeUser, as } = require("./helpers/api");

let user;
let destroy;

beforeAll(async () => {
  await startDb();
  destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
});

afterAll(async () => {
  destroy.mockRestore();
  await stopDb();
});

beforeEach(async () => {
  destroy.mockClear();
  user = await makeUser("Customer", { name: "Test User", phone: "9812345678", address: "Old Address" });
});

const png = Buffer.from("89504e470d0a1a0a", "hex");

describe("GET /api/user/profile", () => {
  it("returns my profile without secrets", async () => {
    const res = await as(user).get("/api/user/profile");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({ _id: String(user._id), name: "Test User", email: user.email, phone: "9812345678", address: "Old Address", role: "Customer" });
    expect(res.body.user).not.toHaveProperty("password");
    expect(res.body.user).not.toHaveProperty("resetPasswordToken");
    expect(res.body.user).not.toHaveProperty("isDeleted");
  });

  it("only ever returns the signed-in user", async () => {
    const other = await makeUser("VenueOwner", { name: "Someone Else" });
    const res = await as(other).get("/api/user/profile");
    expect(res.body.user.name).toBe("Someone Else");
    expect(res.body.user.role).toBe("VenueOwner");
  });

  it("needs a session", async () => {
    const res = await as(null).get("/api/user/profile");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("stops working as soon as the account is deactivated, even with a valid token", async () => {
    await User.updateOne({ _id: user._id }, { isDeleted: true });
    const res = await as(user).get("/api/user/profile");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/user/profile", () => {
  it("updates name, phone and address", async () => {
    const res = await as(user).put("/api/user/profile", { name: "Updated Name", phone: "9800000001", address: "New Address" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Profile updated successfully" });
    expect(res.body.user).toMatchObject({ name: "Updated Name", phone: "9800000001", address: "New Address" });

    const stored = await User.findById(user._id).lean();
    expect(stored).toMatchObject({ name: "Updated Name", phone: "9800000001", address: "New Address" });
  });

  it("changes only what was sent", async () => {
    const res = await as(user).put("/api/user/profile", { phone: "9800000002" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "Test User", phone: "9800000002", address: "Old Address" });
  });

  it("accepts an empty update and changes nothing", async () => {
    const res = await as(user).put("/api/user/profile", {});
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Test User");
  });

  it("cannot be used to change role, email, favorites or password (unknown fields are dropped)", async () => {
    const res = await as(user).put("/api/user/profile", { name: "Still Me", role: "Admin", email: "hijack@example.com", password: "newpass123", isDeleted: true });
    expect(res.status).toBe(200);

    const stored = await User.findById(user._id).select("+password +isDeleted").lean();
    expect(stored.role).toBe("Customer");
    expect(stored.email).toBe(user.email);
    expect(stored.password).toBe("hashedpassword");
    expect(stored.isDeleted).toBe(false);
    expect(stored.name).toBe("Still Me");
  });

  it.each([
    ["a one letter name", { name: "A" }, /Name must be at least 2/],
    ["a name over 50 characters", { name: "x".repeat(51) }, /Name is too long/],
    ["a phone number over 20 characters", { phone: "9".repeat(21) }, /Phone number is too long/],
    ["an address over 150 characters", { address: "x".repeat(151) }, /Address is too long/],
  ])("rejects %s with 400 and keeps the old profile", async (_label, body, pattern) => {
    const res = await as(user).put("/api/user/profile", body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect((await User.findById(user._id)).name).toBe("Test User");
  });

  it("needs a session", async () => {
    const res = await as(null).put("/api/user/profile", { name: "No Auth" });
    expect(res.status).toBe(401);
  });

  describe("avatar upload (storage mocked)", () => {
    it("stores the uploaded image's URL on the profile, together with text fields", async () => {
      const res = await as(user)
        .multipart("put", "/api/user/profile")
        .field("name", "With Avatar")
        .attach("profileImage", png, { filename: "me.png", contentType: "image/png" });

      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe("With Avatar");
      expect(res.body.user.avatar).toBe("https://res.cloudinary.com/test/profileImage/me.png");
      expect((await User.findById(user._id)).avatar).toBe(res.body.user.avatar);
      expect(destroy).not.toHaveBeenCalled(); // nothing to clean up on a first upload
    });

    it("removes the previous Cloudinary avatar when it is replaced", async () => {
      await User.updateOne({ _id: user._id }, { avatar: "https://res.cloudinary.com/demo/image/upload/v1/venure/users/oldpic.webp" });
      const res = await as(user).multipart("put", "/api/user/profile").attach("profileImage", png, { filename: "new.png", contentType: "image/png" });

      expect(res.status).toBe(200);
      expect(destroy).toHaveBeenCalledWith("venure/users/oldpic");
      expect(res.body.user.avatar).toContain("new.png");
    });

    it("does not touch a non-Cloudinary avatar (for example a Google profile picture)", async () => {
      await User.updateOne({ _id: user._id }, { avatar: "https://lh3.googleusercontent.com/a/photo" });
      await as(user).multipart("put", "/api/user/profile").attach("profileImage", png, { filename: "new.png", contentType: "image/png" });
      expect(destroy).not.toHaveBeenCalled();
    });

    it("still saves the profile when deleting the old picture fails", async () => {
      await User.updateOne({ _id: user._id }, { avatar: "https://res.cloudinary.com/demo/image/upload/v1/venure/users/oldpic.webp" });
      destroy.mockRejectedValueOnce(new Error("cloudinary is down"));
      const res = await as(user).multipart("put", "/api/user/profile").attach("profileImage", png, { filename: "new.png", contentType: "image/png" });
      expect(res.status).toBe(200);
      expect(res.body.user.avatar).toContain("new.png");
    });

    it("rejects a file that is not an image with 400 and leaves the avatar alone", async () => {
      const res = await as(user)
        .multipart("put", "/api/user/profile")
        .field("name", "Should Not Apply")
        .attach("profileImage", Buffer.from("just text"), { filename: "notes.txt", contentType: "text/plain" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Only image files are allowed");
      const stored = await User.findById(user._id).lean();
      expect(stored.avatar).toBe("");
      expect(stored.name).toBe("Test User");
    });

    it("rejects an image over 10 MB with 400", async () => {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1);
      const res = await as(user).multipart("put", "/api/user/profile").attach("profileImage", big, { filename: "big.png", contentType: "image/png" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Upload error/);
    });

    it("needs a session before anything is uploaded", async () => {
      const res = await as(null).multipart("put", "/api/user/profile").attach("profileImage", png, { filename: "me.png", contentType: "image/png" });
      expect(res.status).toBe(401);
    });
  });
});
