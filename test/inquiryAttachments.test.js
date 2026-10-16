// No network: Cloudinary's storage engine is replaced by an in-process one with the same contract.
jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));

const Inquiry = require("../model/inquiry");
const { cloudinary } = require("../middleware/uploadMiddleware");
const { startDb, stopDb, clearDb, makeUser, makeVenue, as, objectId } = require("./helpers/api");

let owner, otherOwner, customer, stranger, admin, venue, destroy;

const DAY = 24 * 60 * 60 * 1000;
const pdf = Buffer.from("%PDF-1.4 test menu");
const png = Buffer.from("89504e470d0a1a0a", "hex");
const PDF = "application/pdf";

const makeInquiry = (overrides = {}) =>
  Inquiry.create({
    customer: customer._id,
    venue: venue._id,
    preferredDate: new Date(Date.now() + 30 * DAY),
    numberOfGuests: 50,
    eventType: "Wedding",
    contactName: "Jane",
    phoneNumber: "9800000000",
    ...overrides,
  });

const upload = (user, inquiry, files) => {
  let req = as(user).multipart("post", `/api/inquiries/${inquiry._id}/attachments`);
  for (const [name, buf, type] of files) req = req.attach("attachments", buf, { filename: name, contentType: type });
  return req;
};

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
  stranger = await makeUser("Customer");
  admin = await makeUser("Admin");
  venue = await makeVenue(owner);
});

describe("adding files to an inquiry", () => {
  it("lets the customer attach a PDF and an image", async () => {
    const inquiry = await makeInquiry();
    const res = await upload(customer, inquiry, [["menu.pdf", pdf, PDF], ["card.png", png, "image/png"]]);
    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(2);
    expect(res.body.data.attachments[0]).toMatchObject({ originalName: "menu.pdf", mimeType: PDF });
    expect(res.body.data.attachments[0]).not.toHaveProperty("publicId");
  });

  it("never exposes the stored id when the inquiry is read", async () => {
    const inquiry = await makeInquiry();
    await upload(customer, inquiry, [["menu.pdf", pdf, PDF]]);
    const res = await as(owner).get(`/api/inquiries/${inquiry._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("publicId");
  });

  it("rejects file types that are not PDF, JPG, PNG or WebP", async () => {
    const inquiry = await makeInquiry();
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    for (const [name, type] of [["run.exe", "application/octet-stream"], ["page.html", "text/html"], ["doc.docx", docx], ["clip.gif", "image/gif"]]) {
      const res = await upload(customer, inquiry, [[name, Buffer.from("x"), type]]);
      expect(res.status).toBe(400);
    }
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it("rejects a file over 5 MB", async () => {
    const inquiry = await makeInquiry();
    const res = await upload(customer, inquiry, [["big.pdf", Buffer.alloc(5 * 1024 * 1024 + 10), PDF]]);
    expect(res.status).toBe(400);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it("rejects more than 3 files in one request", async () => {
    const inquiry = await makeInquiry();
    const res = await upload(customer, inquiry, [1, 2, 3, 4].map((n) => [`m${n}.pdf`, pdf, PDF]));
    expect(res.status).toBe(400);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it("stops at 3 files in total across requests", async () => {
    const inquiry = await makeInquiry();
    expect((await upload(customer, inquiry, [["a.pdf", pdf, PDF], ["b.pdf", pdf, PDF]])).status).toBe(201);
    // two more would make four: refused, and what was uploaded is removed again
    const over = await upload(customer, inquiry, [["c.pdf", pdf, PDF], ["d.pdf", pdf, PDF]]);
    expect(over.status).toBe(409);
    expect((await upload(customer, inquiry, [["c.pdf", pdf, PDF]])).status).toBe(201);
    const full = await upload(customer, inquiry, [["d.pdf", pdf, PDF]]);
    expect(full.status).toBe(400);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(3);
  });

  it("never lets parallel uploads go past 3", async () => {
    const inquiry = await makeInquiry();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => upload(customer, inquiry, [[`m${n}.pdf`, pdf, PDF]])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(3);
    // a file that lost the race is removed from storage
    const rejectedAfterUpload = results.filter((r) => r.status === 409).length;
    expect(destroy).toHaveBeenCalledTimes(rejectedAfterUpload);
  });

  it("answers 400 (not 500) when the file store cannot read a file, and stores nothing", async () => {
    const inquiry = await makeInquiry();
    const res = await upload(customer, inquiry, [["corrupt.pdf", pdf, PDF]]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/could not be processed/);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it("refuses an empty request", async () => {
    const inquiry = await makeInquiry();
    const res = await as(customer).multipart("post", `/api/inquiries/${inquiry._id}/attachments`);
    expect(res.status).toBe(400);
  });

  it("is only for the customer who made the inquiry", async () => {
    const inquiry = await makeInquiry();
    expect((await upload(stranger, inquiry, [["a.pdf", pdf, PDF]])).status).toBe(404);
    expect((await upload(owner, inquiry, [["a.pdf", pdf, PDF]])).status).toBe(403);
    expect((await upload(null, inquiry, [["a.pdf", pdf, PDF]])).status).toBe(401);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(0);
  });

  it.each(["accepted", "declined", "cancelled", "expired"])("is closed once the inquiry is %s", async (status) => {
    const inquiry = await makeInquiry({ status });
    const res = await upload(customer, inquiry, [["a.pdf", pdf, PDF]]);
    expect(res.status).toBe(400);
  });

  it("is allowed while the inquiry is quoted", async () => {
    const inquiry = await makeInquiry({ status: "quoted" });
    expect((await upload(customer, inquiry, [["a.pdf", pdf, PDF]])).status).toBe(201);
  });

  it("answers 404 for an unknown inquiry", async () => {
    const res = await as(customer)
      .multipart("post", `/api/inquiries/${objectId()}/attachments`)
      .attach("attachments", pdf, { filename: "a.pdf", contentType: PDF });
    expect(res.status).toBe(404);
  });
});

describe("opening and removing a file", () => {
  let inquiry, fileId;
  beforeEach(async () => {
    inquiry = await makeInquiry();
    const res = await upload(customer, inquiry, [["menu.pdf", pdf, PDF]]);
    fileId = res.body.data.attachments[0]._id;
  });
  const link = (user, id = fileId) => as(user).get(`/api/inquiries/${inquiry._id}/attachments/${id}/link`);

  it("gives the customer, the venue owner and an admin a signed, expiring link", async () => {
    for (const user of [customer, owner, admin]) {
      const res = await link(user);
      expect(res.status).toBe(200);
      expect(res.body.data.url).toMatch(/^https:\/\/api\.cloudinary\.com\//);
      expect(res.body.data.url).toContain("signature=");
      expect(res.body.data.url).toContain("expires_at=");
      expect(res.body.data.url).toContain("authenticated");
    }
  });

  it("refuses everyone else", async () => {
    expect((await link(stranger)).status).toBe(403);
    expect((await link(otherOwner)).status).toBe(403);
    expect((await link(null)).status).toBe(401);
  });

  it("answers 404 for a file that is not on this inquiry", async () => {
    expect((await link(customer, objectId())).status).toBe(404);
  });

  it("lets the customer remove a file, and deletes it from storage", async () => {
    const res = await as(customer).delete(`/api/inquiries/${inquiry._id}/attachments/${fileId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(0);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy.mock.calls[0][1]).toMatchObject({ type: "authenticated" });
  });

  it("does not let anyone else remove it", async () => {
    expect((await as(owner).delete(`/api/inquiries/${inquiry._id}/attachments/${fileId}`)).status).toBe(403);
    expect((await as(stranger).delete(`/api/inquiries/${inquiry._id}/attachments/${fileId}`)).status).toBe(404);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(1);
  });

  it("cannot be removed once the inquiry is closed", async () => {
    await Inquiry.updateOne({ _id: inquiry._id }, { status: "accepted" });
    const res = await as(customer).delete(`/api/inquiries/${inquiry._id}/attachments/${fileId}`);
    expect(res.status).toBe(404);
    expect((await Inquiry.findById(inquiry._id)).attachments).toHaveLength(1);
  });
});
