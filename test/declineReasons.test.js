// Reasons: the venue must say why it declines; the customer may say why they cancel or turn a quotation down.
const request = require("supertest");
const Inquiry = require("../model/inquiry");
const Notification = require("../model/notification");
const { app, as, cookieFor } = require("./helpers/api");
const { world, start, stop, reset, acceptedQuotation } = require("./helpers/bookingWorld");

beforeAll(() => start());
afterAll(stop);
beforeEach(reset);

const DAY = 24 * 60 * 60 * 1000;
const open = (extra = {}) =>
  Inquiry.create({
    customer: world.customer._id, venue: world.venue._id, preferredDate: new Date(Date.now() + 30 * DAY), numberOfGuests: 50,
    eventType: "Wedding", contactName: "Jane", phoneNumber: "9800000000", ...extra,
  });
const noteTo = async (user) => (await Notification.find({ recipient: user._id }).sort("-createdAt").lean()).map((n) => n.message).join(" | ");

describe("the venue declines a request", () => {
  it("must give a reason, and the customer is told it", async () => {
    const inquiry = await open();
    const bare = await as(world.owner).put(`/api/inquiries/${inquiry._id}/decline`, {});
    expect(bare.status).toBe(400);
    expect(bare.body.message).toMatch(/Tell the customer why/);
    expect((await as(world.owner).put(`/api/inquiries/${inquiry._id}/decline`, { reason: "  " })).status).toBe(400);
    expect((await as(world.owner).put(`/api/inquiries/${inquiry._id}/decline`, { reason: "x".repeat(301) })).status).toBe(400);
    expect((await Inquiry.findById(inquiry._id)).status).toBe("pending");

    const res = await as(world.owner).put(`/api/inquiries/${inquiry._id}/decline`, { reason: "  That date is already taken.  " });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "declined", declineReason: "That date is already taken." });
    expect(await noteTo(world.customer)).toContain("was declined: That date is already taken.");

    // The customer can read it on the request
    const seen = await as(world.customer).get(`/api/inquiries/${inquiry._id}`);
    expect(seen.body.data.declineReason).toBe("That date is already taken.");
  });

  it("is still only for that venue's owner", async () => {
    const inquiry = await open();
    expect((await as(world.otherOwner).put(`/api/inquiries/${inquiry._id}/decline`, { reason: "Not mine" })).status).toBe(404);
    expect((await as(world.customer).put(`/api/inquiries/${inquiry._id}/decline`, { reason: "No" })).status).toBe(403);
    expect((await Inquiry.findById(inquiry._id)).status).toBe("pending");
  });
});

describe("the customer cancels", () => {
  it("with no reason, or with one the venue can read", async () => {
    const a = await open();
    expect((await as(world.customer).put(`/api/inquiries/${a._id}/cancel`)).status).toBe(200);
    expect((await Inquiry.findById(a._id)).customerReason).toBeUndefined();

    const b = await open();
    const res = await as(world.customer).put(`/api/inquiries/${b._id}/cancel`, { reason: "We changed the date" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "cancelled", customerReason: "We changed the date" });
    expect((await as(world.owner).get(`/api/inquiries/${b._id}`)).body.data.customerReason).toBe("We changed the date");
    expect((await as(world.customer).put(`/api/inquiries/${(await open())._id}/cancel`, { reason: "x".repeat(301) })).status).toBe(400);
  });
});

describe("the customer turns a quotation down", () => {
  const sent = async () => {
    const { inquiry, quotation } = await acceptedQuotation({ status: "sent" });
    await Inquiry.updateOne({ _id: inquiry._id }, { status: "quoted" });
    return { inquiry, quotation };
  };

  it("with a reason the venue is told and can read, and it is cleared when the venue replies again", async () => {
    const { inquiry, quotation } = await sent();
    const res = await as(world.customer).put(`/api/quotations/${quotation._id}/reject`, { reason: "Too expensive for our budget" });
    expect(res.status).toBe(200);
    expect(await noteTo(world.owner)).toContain("was declined by the customer: Too expensive for our budget");
    const after = await Inquiry.findById(inquiry._id);
    expect(after).toMatchObject({ status: "pending", customerReason: "Too expensive for our budget" });

    // a new quotation from the venue clears the old note
    const quotationService = require("../services/quotationService");
    const { nepalNoon } = require("./helpers/bookingWorld");
    await quotationService.createQuotation(
      inquiry._id,
      world.owner._id,
      { space: world.space._id, eventDate: nepalNoon(30), shift: "day", numberOfGuests: 50, lineItems: [{ label: "Venue hire", unitPrice: 90000, quantity: 1 }], depositType: "percentage", depositValue: 20 },
      null
    );
    const requoted = await Inquiry.findById(inquiry._id);
    expect(requoted.status).toBe("quoted");
    expect(requoted.customerReason).toBeUndefined();
  });

  it("works without a reason, and refuses one that is too long", async () => {
    const { quotation } = await sent();
    expect((await as(world.customer).put(`/api/quotations/${quotation._id}/reject`, { reason: "y".repeat(301) })).status).toBe(400);
    expect((await as(world.customer).put(`/api/quotations/${quotation._id}/reject`)).status).toBe(200);
    expect(await noteTo(world.owner)).toContain("was declined by the customer.");
  });
});

void request;
void cookieFor;
