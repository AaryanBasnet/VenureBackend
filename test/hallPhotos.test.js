// Photos of a hall: the owner adds up to 6 and removes them; strangers cannot. No network: the file store is faked.
jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));

const Space = require("../model/space");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { startDb, stopDb, clearDb, makeUser, makeVenue, makeSpace, as, objectId } = require("./helpers/api");

let owner, otherOwner, customer, space, destroy;
const png = Buffer.from("89504e470d0a1a0a", "hex");

const upload = (user, id, names) => {
  let req = as(user).multipart("post", `/api/spaces/${id}/images`);
  for (const name of names) req = req.attach("spaceImages", png, { filename: name, contentType: "image/png" });
  return req;
};
const photos = async () => (await Space.findById(space._id).lean()).spaceImages;

beforeAll(async () => {
  await startDb();
  destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
});
afterAll(async () => {
  destroy.mockRestore();
  await stopDb();
});
beforeEach(async () => {
  await clearDb();
  destroy.mockClear();
  owner = await makeUser("VenueOwner");
  otherOwner = await makeUser("VenueOwner");
  customer = await makeUser("Customer");
  space = await makeSpace(await makeVenue(owner), { spaceType: "garden-estates" });
});

describe("adding photos", () => {
  it("lets the owner add photos, and the public hall list shows them", async () => {
    const res = await upload(owner, space._id, ["a.png", "b.png"]);
    expect(res.status).toBe(201);
    expect(res.body.data.spaceImages).toHaveLength(2);
    expect(res.body.data.spaceImages[0]).toMatchObject({ url: expect.stringContaining("a.png"), filename: expect.stringContaining("a.png") });

    const list = await as(null).get(`/api/venues/${space.venue}/spaces`);
    expect(list.body.data[0].spaceImages).toHaveLength(2);
  });

  it("stops at 6 photos in total, whether in one request or across several", async () => {
    expect((await upload(owner, space._id, ["1", "2", "3", "4", "5", "6", "7"].map((n) => `${n}.png`))).status).toBe(400); // more than 6 at once
    expect((await upload(owner, space._id, ["1", "2", "3", "4"].map((n) => `${n}.png`))).status).toBe(201);
    expect((await upload(owner, space._id, ["5.png", "6.png", "7.png"])).status).toBe(409); // would make 7: refused, files removed again
    expect(destroy).toHaveBeenCalledTimes(3);
    expect((await upload(owner, space._id, ["5.png", "6.png"])).status).toBe(201);
    expect((await upload(owner, space._id, ["7.png"])).status).toBe(400);
    expect(await photos()).toHaveLength(6);
  });

  it("never lets parallel uploads go past 6", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(owner, space._id, [`p${i}.png`])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    expect(await photos()).toHaveLength(6);
  });

  it("refuses files that are not images, and an empty request", async () => {
    const pdf = await as(owner).multipart("post", `/api/spaces/${space._id}/images`).attach("spaceImages", Buffer.from("%PDF"), { filename: "m.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(400);
    expect((await as(owner).multipart("post", `/api/spaces/${space._id}/images`)).status).toBe(400);
    expect(await photos()).toHaveLength(0);
  });

  it("is only for the venue's owner, and only for a hall that is still offered", async () => {
    expect((await upload(otherOwner, space._id, ["a.png"])).status).toBe(404);
    expect((await upload(customer, space._id, ["a.png"])).status).toBe(403);
    expect((await upload(null, space._id, ["a.png"])).status).toBe(401);
    expect((await upload(owner, objectId(), ["a.png"])).status).toBe(404);
    await Space.updateOne({ _id: space._id }, { isActive: false });
    expect((await upload(owner, space._id, ["a.png"])).status).toBe(404);
    expect(await photos()).toHaveLength(0);
  });
});

describe("removing a photo", () => {
  let filename;
  beforeEach(async () => {
    const res = await upload(owner, space._id, ["keep.png", "drop.png"]);
    filename = res.body.data.spaceImages.find((i) => i.url.includes("drop.png")).filename;
  });

  it("removes it from the hall and from the file store", async () => {
    const res = await as(owner).delete(`/api/spaces/${space._id}/images`).send({ filename });
    expect(res.status).toBe(200);
    expect(res.body.data.spaceImages).toHaveLength(1);
    expect(destroy).toHaveBeenCalledWith(filename);
  });

  it("is only for the owner, and 404 for a photo that is not on the hall", async () => {
    expect((await as(otherOwner).delete(`/api/spaces/${space._id}/images`).send({ filename })).status).toBe(404);
    expect((await as(customer).delete(`/api/spaces/${space._id}/images`).send({ filename })).status).toBe(403);
    expect((await as(owner).delete(`/api/spaces/${space._id}/images`).send({ filename: "venure/spaces/nothing" })).status).toBe(404);
    expect((await as(owner).delete(`/api/spaces/${space._id}/images`).send({})).status).toBe(400);
    expect(await photos()).toHaveLength(2);
    expect(destroy).not.toHaveBeenCalled();
  });
});
