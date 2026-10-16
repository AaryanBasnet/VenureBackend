// Backfills the denormalised fields: Venue.minPricePerPlate / priceSortKey / maxCapacity / spaceCount and Chat.lastMessage.
// Safe to re-run. Usage: DB_URL=... node scripts/backfill-venue-derived.js
const mongoose = require("mongoose");
const Venue = require("../model/venue");
const Space = require("../model/space");
const { derivePriceFields } = require("../model/venue");

const backfill = async () => {
  const caps = await Space.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$venue", maxCapacity: { $max: "$capacity" }, spaceCount: { $sum: 1 } } },
  ]);
  const capById = new Map(caps.map((c) => [String(c._id), c]));
  const ops = [];
  let n = 0;
  for await (const v of Venue.find({}).select("+priceSortKey packages").lean()) {
    const c = capById.get(String(v._id));
    ops.push({
      updateOne: {
        filter: { _id: v._id },
        update: { $set: { ...derivePriceFields(v.packages), maxCapacity: c?.maxCapacity ?? 0, spaceCount: c?.spaceCount ?? 0 } },
      },
    });
    if (ops.length >= 1000) { n += ops.length; await Venue.bulkWrite(ops.splice(0), { timestamps: false, ordered: false }); }
  }
  if (ops.length) { n += ops.length; await Venue.bulkWrite(ops, { timestamps: false, ordered: false }); }

  // Chats: store the newest message on the chat (read by the conversation list)
  const Message = require("../model/message");
  const Chat = require("../model/chat");
  const lasts = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$chatId", text: { $first: "$text" }, timestamp: { $first: "$createdAt" } } },
  ]).allowDiskUse(true);
  if (lasts.length) {
    await Chat.bulkWrite(
      lasts.map((m) => ({ updateOne: { filter: { _id: m._id }, update: { $set: { lastMessage: { text: m.text, timestamp: m.timestamp } } } } })),
      { timestamps: false, ordered: false }
    );
  }
  return n;
};

module.exports = backfill;

if (require.main === module) {
  require("dotenv").config();
  (async () => {
    await mongoose.connect(process.env.DB_URL);
    console.log("backfilled venues:", await backfill(), "on", mongoose.connection.name);
    await mongoose.disconnect();
  })().catch((e) => { console.error(e); process.exit(1); });
}
