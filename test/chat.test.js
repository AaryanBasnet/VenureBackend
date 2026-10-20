const Chat = require("../model/chat");
const Message = require("../model/message");
const Notification = require("../model/notification");
const chatService = require("../services/chatService");
const { startDb, stopDb, makeUser, as, makeVenue, objectId } = require("./helpers/api");

let owner;
let customer;
let stranger;
let venue;

beforeAll(startDb);
afterAll(stopDb);

beforeEach(async () => {
  await Promise.all([Chat, Message, Notification].map((m) => m.deleteMany({})));
  owner = await makeUser("VenueOwner");
  customer = await makeUser("Customer");
  stranger = await makeUser("Customer");
  venue = await makeVenue(owner, { venueName: "Chat Hall" });
});

const startChat = (user, participant, venueId = venue._id) =>
  as(user).post("/api/chats", { participantId: String(participant._id), venueId: String(venueId) });

describe("starting a chat", () => {
  it("a customer starts a chat with the venue owner", async () => {
    const res = await startChat(customer, owner);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const chat = res.body.data;
    expect(chat.participants.map((p) => p._id).sort()).toEqual([String(customer._id), String(owner._id)].sort());
    expect(chat.venueId).toMatchObject({ _id: String(venue._id), venueName: "Chat Hall" });
    // participants carry only public fields
    expect(chat.participants[0]).not.toHaveProperty("email");
    expect(chat.participants[0]).not.toHaveProperty("password");
  });

  it("returns the same chat when asked again, from either side", async () => {
    const first = await startChat(customer, owner);
    const again = await startChat(customer, owner);
    const fromOwner = await startChat(owner, customer);
    expect(again.body.data._id).toBe(first.body.data._id);
    expect(fromOwner.body.data._id).toBe(first.body.data._id);
    expect(await Chat.countDocuments()).toBe(1);
  });

  it("keeps a separate chat per venue", async () => {
    const second = await makeVenue(owner, { venueName: "Second Hall" });
    const a = await startChat(customer, owner);
    const b = await startChat(customer, owner, second._id);
    expect(a.body.data._id).not.toBe(b.body.data._id);
  });

  it("refuses a chat with yourself", async () => {
    const res = await startChat(owner, owner);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/);
  });

  it("refuses a chat between two people who are not the venue owner (403)", async () => {
    const res = await startChat(customer, stranger);
    expect(res.status).toBe(403);
    expect(await Chat.countDocuments()).toBe(0);
  });

  it("404 for an unknown or deleted venue, and for a deactivated participant", async () => {
    expect((await startChat(customer, owner, objectId())).status).toBe(404);
    const gone = await makeVenue(owner, { isDeleted: true });
    expect((await startChat(customer, owner, gone._id)).status).toBe(404);

    const deactivated = await makeUser("VenueOwner", { isDeleted: true });
    const theirVenue = await makeVenue(deactivated);
    expect((await startChat(customer, deactivated, theirVenue._id)).status).toBe(404);
  });

  it("validates the body", async () => {
    const res = await as(customer).post("/api/chats", { participantId: "x", venueId: String(venue._id) });
    expect(res.status).toBe(400);
    expect((await as(customer).post("/api/chats", {})).status).toBe(400);
  });

  it("requires a session", async () => {
    const res = await startChat(null, owner);
    expect(res.status).toBe(401);
  });
});

describe("conversation list", () => {
  it("is empty at first and needs a session", async () => {
    const res = await as(customer).get("/api/chats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect((await as(null).get("/api/chats")).status).toBe(401);
  });

  it("shows my chats with the latest message and my unread count", async () => {
    const { body } = await startChat(customer, owner);
    const chatId = body.data._id;
    await chatService.saveMessage(chatId, String(customer._id), "hello owner");
    await chatService.saveMessage(chatId, String(owner._id), "hello customer");
    await chatService.saveMessage(chatId, String(owner._id), "are you free in May?");

    const mine = await as(customer).get("/api/chats");
    expect(mine.body.data).toHaveLength(1);
    const chat = mine.body.data[0];
    expect(chat.lastMessage.text).toBe("are you free in May?");
    expect(chat.unreadCount).toBe(2); // the two owner messages are unread by the customer
    expect(chat.venueId.venueName).toBe("Chat Hall");

    const theirs = await as(owner).get("/api/chats");
    expect(theirs.body.data[0].unreadCount).toBe(1);
  });

  it("does not show other people's chats", async () => {
    await startChat(customer, owner);
    const res = await as(stranger).get("/api/chats");
    expect(res.body.data).toEqual([]);
  });

  it("orders by the most recent activity", async () => {
    const second = await makeVenue(owner, { venueName: "Second Hall" });
    const a = (await startChat(customer, owner)).body.data._id;
    const b = (await startChat(customer, owner, second._id)).body.data._id;
    await new Promise((resolve) => setTimeout(resolve, 20)); // make sure the message is newer than both chats
    await chatService.saveMessage(a, String(customer._id), "ping");
    const res = await as(customer).get("/api/chats");
    expect(res.body.data.map((c) => c._id)).toEqual([a, b]);
  });

  it("can be filtered by venue", async () => {
    const second = await makeVenue(owner, { venueName: "Second Hall" });
    await startChat(customer, owner);
    const b = (await startChat(customer, owner, second._id)).body.data._id;
    const res = await as(customer).get(`/api/chats?venueId=${second._id}`);
    expect(res.body.data.map((c) => c._id)).toEqual([b]);
  });

  it("falls back to the newest message for a chat that predates the lastMessage field", async () => {
    const chat = await Chat.create({ participants: [customer._id, owner._id], venueId: venue._id });
    await Message.create({ chatId: chat._id, sender: owner._id, receiver: customer._id, text: "old news", createdAt: new Date("2030-01-01T00:00:00Z") });
    await Message.create({ chatId: chat._id, sender: owner._id, receiver: customer._id, text: "newer news", createdAt: new Date("2030-01-02T00:00:00Z") });
    const res = await as(customer).get("/api/chats");
    expect(res.body.data[0].lastMessage.text).toBe("newer news");
    expect(res.body.data[0].unreadCount).toBe(2);
  });
});

describe("messages in a chat", () => {
  it("returns the conversation oldest first with sender and receiver names", async () => {
    const chatId = (await startChat(customer, owner)).body.data._id;
    await chatService.saveMessage(chatId, String(customer._id), "one");
    await chatService.saveMessage(chatId, String(owner._id), "two");

    const res = await as(customer).get(`/api/chats/${chatId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.text)).toEqual(["one", "two"]);
    expect(res.body.data[0].sender).toMatchObject({ _id: String(customer._id), name: customer.name });
    expect(res.body.data[0].receiver._id).toBe(String(owner._id));
    expect(res.body.data[0].sender).not.toHaveProperty("email");
  });

  it("both participants can read it, nobody else can (403)", async () => {
    const chatId = (await startChat(customer, owner)).body.data._id;
    expect((await as(owner).get(`/api/chats/${chatId}/messages`)).status).toBe(200);
    const denied = await as(stranger).get(`/api/chats/${chatId}/messages`);
    expect(denied.status).toBe(403);
    expect(denied.body.success).toBe(false);
  });

  it("403 for an unknown chat, 400 for a malformed id, 401 when signed out", async () => {
    expect((await as(customer).get(`/api/chats/${objectId()}/messages`)).status).toBe(403);
    expect((await as(customer).get("/api/chats/nope/messages")).status).toBe(400);
    expect((await as(null).get(`/api/chats/${objectId()}/messages`)).status).toBe(401);
  });

  it("returns only the newest 200 messages of a long chat, still oldest first", async () => {
    const chatId = (await startChat(customer, owner)).body.data._id;
    await Message.insertMany(
      Array.from({ length: 205 }, (_, i) => ({
        chatId,
        sender: customer._id,
        receiver: owner._id,
        text: `m${i}`,
        createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)),
      }))
    );
    const res = await as(customer).get(`/api/chats/${chatId}/messages`);
    expect(res.body.data).toHaveLength(200);
    expect(res.body.data[0].text).toBe("m5");
    expect(res.body.data[199].text).toBe("m204");
  });
});

describe("unread count", () => {
  it("counts messages waiting for me across all chats", async () => {
    const second = await makeVenue(owner, { venueName: "Second Hall" });
    const a = (await startChat(customer, owner)).body.data._id;
    const b = (await startChat(customer, owner, second._id)).body.data._id;
    await chatService.saveMessage(a, String(owner._id), "x");
    await chatService.saveMessage(b, String(owner._id), "y");
    await chatService.saveMessage(b, String(customer._id), "mine, does not count for me");

    const res = await as(customer).get("/api/chats/unread-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { unreadCount: 2 } });
    expect((await as(owner).get("/api/chats/unread-count")).body.data.unreadCount).toBe(1);
    expect((await as(stranger).get("/api/chats/unread-count")).body.data.unreadCount).toBe(0);
  });

  it("needs a session", async () => {
    expect((await as(null).get("/api/chats/unread-count")).status).toBe(401);
  });
});

describe("saving a message (what the socket handler calls)", () => {
  it("takes the receiver from the chat, notifies them and bumps the preview", async () => {
    const chatId = (await startChat(customer, owner)).body.data._id;
    const saved = await chatService.saveMessage(chatId, String(customer._id), "Is the hall free?");

    expect(saved.receiverId).toBe(String(owner._id));
    expect(saved.messagePayload).toMatchObject({ chatId, text: "Is the hall free?", seen: false, senderUsername: customer.name });
    const note = await Notification.findOne({ recipient: owner._id });
    expect(note).toMatchObject({ type: "chat", link: `/chat/${chatId}` });
    expect(note.message).toContain(customer.name);
    const chat = await Chat.findById(chatId).lean();
    expect(chat.lastMessage.text).toBe("Is the hall free?");
  });

  it("refuses a sender who is not in the chat, or a bad chat id", async () => {
    const chatId = (await startChat(customer, owner)).body.data._id;
    await expect(chatService.saveMessage(chatId, String(stranger._id), "hi")).rejects.toMatchObject({ statusCode: 403 });
    await expect(chatService.saveMessage("nope", String(customer._id), "hi")).rejects.toMatchObject({ statusCode: 403 });
    expect(await Message.countDocuments()).toBe(0);
    expect(await Notification.countDocuments()).toBe(0);
  });
});

describe("marking a conversation as seen (what the socket handler calls)", () => {
  it("clears my unread messages in that chat only, and says who to tell", async () => {
    const second = await makeVenue(owner, { venueName: "Other Hall" });
    const a = (await startChat(customer, owner)).body.data._id;
    const b = (await startChat(customer, owner, second._id)).body.data._id;
    await chatService.saveMessage(a, String(owner._id), "one");
    await chatService.saveMessage(a, String(owner._id), "two");
    await chatService.saveMessage(b, String(owner._id), "elsewhere");

    const result = await chatService.markChatSeen(a, customer._id);
    expect(result).toEqual({ changed: 2, otherUserId: String(owner._id) });
    expect((await as(customer).get("/api/chats/unread-count")).body.data.unreadCount).toBe(1);
    expect((await chatService.markChatSeen(a, customer._id)).changed).toBe(0);
  });

  it("never marks the other person's messages, and refuses a stranger or a bad id", async () => {
    const a = (await startChat(customer, owner)).body.data._id;
    await chatService.saveMessage(a, String(customer._id), "to the owner");
    await chatService.markChatSeen(a, customer._id);
    expect((await as(owner).get("/api/chats/unread-count")).body.data.unreadCount).toBe(1);
    await expect(chatService.markChatSeen(a, stranger._id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(chatService.markChatSeen("nope", customer._id)).rejects.toMatchObject({ statusCode: 403 });
  });
});
