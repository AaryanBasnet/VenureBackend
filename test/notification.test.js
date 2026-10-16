const Notification = require("../model/notification");
const { startDb, stopDb, makeUser, as, objectId } = require("./helpers/api");

let user;
let other;

beforeAll(startDb);
afterAll(stopDb);

beforeEach(async () => {
  await Notification.deleteMany({});
  user = await makeUser("Customer");
  other = await makeUser("VenueOwner");
});

const note = (recipient, message, extra = {}) => Notification.create({ recipient: recipient._id, type: "system", message, ...extra });

describe("notifications API", () => {
  describe("list", () => {
    it("returns only my notifications, newest first, with the read flag", async () => {
      await note(user, "oldest", { createdAt: new Date("2030-01-01T00:00:00Z") });
      await note(user, "newest", { createdAt: new Date("2030-01-03T00:00:00Z"), read: true });
      await note(user, "middle", { createdAt: new Date("2030-01-02T00:00:00Z") });
      await note(other, "someone else's");

      const res = await as(user).get("/api/notification");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((n) => n.message)).toEqual(["newest", "middle", "oldest"]);
      expect(res.body.data[0]).toMatchObject({ read: true, type: "system", recipient: String(user._id) });
      expect(res.body.data[1].read).toBe(false);
    });

    it("is empty for a user with nothing", async () => {
      const res = await as(user).get("/api/notification");
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it("caps the list at the 50 newest", async () => {
      await Notification.insertMany(
        Array.from({ length: 55 }, (_, i) => ({
          recipient: user._id,
          type: "system",
          message: `n${i}`,
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)),
        }))
      );
      const res = await as(user).get("/api/notification");
      expect(res.body.data).toHaveLength(50);
      expect(res.body.data[0].message).toBe("n54");
      expect(res.body.data[49].message).toBe("n5");
    });

    it("requires a session", async () => {
      const res = await as(null).get("/api/notification");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("mark one as read", () => {
    it("marks my notification read and returns it", async () => {
      const n = await note(user, "hello");
      const res = await as(user).patch(`/api/notification/${n._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ _id: String(n._id), read: true });
      expect((await Notification.findById(n._id)).read).toBe(true);
    });

    it("is idempotent", async () => {
      const n = await note(user, "hello", { read: true });
      const res = await as(user).patch(`/api/notification/${n._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.data.read).toBe(true);
    });

    it("cannot touch someone else's notification (404, and it stays unread)", async () => {
      const n = await note(other, "private");
      const res = await as(user).patch(`/api/notification/${n._id}/read`);
      expect(res.status).toBe(404);
      expect((await Notification.findById(n._id)).read).toBe(false);
    });

    it("404 for an unknown id, 400 for a malformed one, 401 when signed out", async () => {
      expect((await as(user).patch(`/api/notification/${objectId()}/read`)).status).toBe(404);
      const bad = await as(user).patch("/api/notification/nope/read");
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/Invalid Notification ID/);
      expect((await as(null).patch(`/api/notification/${objectId()}/read`)).status).toBe(401);
    });
  });

  describe("mark all as read", () => {
    it("marks every unread notification of mine and nobody else's", async () => {
      await note(user, "a");
      await note(user, "b");
      await note(user, "c", { read: true });
      const theirs = await note(other, "theirs");

      const res = await as(user).patch("/api/notification/read-all");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: "All notifications marked as read" });
      expect(await Notification.countDocuments({ recipient: user._id, read: false })).toBe(0);
      expect((await Notification.findById(theirs._id)).read).toBe(false);
    });

    it("succeeds when there is nothing to mark, and needs a session", async () => {
      expect((await as(user).patch("/api/notification/read-all")).status).toBe(200);
      expect((await as(null).patch("/api/notification/read-all")).status).toBe(401);
    });

    it("is not mistaken for an id (the static route wins over /:id/read)", async () => {
      const res = await as(user).patch("/api/notification/read-all");
      expect(res.status).not.toBe(400);
    });
  });

  describe("delete", () => {
    it("deletes my notification", async () => {
      const n = await note(user, "bye");
      const res = await as(user).delete(`/api/notification/${n._id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: "Notification deleted" });
      expect(await Notification.findById(n._id)).toBeNull();
    });

    it("cannot delete someone else's notification", async () => {
      const n = await note(other, "theirs");
      expect((await as(user).delete(`/api/notification/${n._id}`)).status).toBe(404);
      expect(await Notification.findById(n._id)).not.toBeNull();
    });

    it("requires a session and a valid id", async () => {
      expect((await as(null).delete(`/api/notification/${objectId()}`)).status).toBe(401);
      expect((await as(user).delete("/api/notification/nope")).status).toBe(400);
    });
  });
});
