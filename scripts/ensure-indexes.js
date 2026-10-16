/* eslint-disable no-console */
// Creates every index the API's real query shapes need. Run it on deploy (it is idempotent):
//
//   node scripts/ensure-indexes.js            # uses DB_URL from the environment / .env
//
// 1. Indexes declared on the Mongoose schemas (Model.createIndexes: never drops anything).
// 2. EXTRA indexes for collections whose models belong to the booking/quotation/inquiry/payment code. They are
//    created straight on the collections so this script does not depend on those model files; if the models later
//    declare the same keys MongoDB simply sees the index already exists.
//
// In production set AUTO_INDEX=0 (see database/db.js) so a deploy never builds indexes implicitly at start-up,
// and run this script as a release step instead.
const mongoose = require("mongoose");
require("dotenv").config();

const EXTRA = {
  bookings: [
    // my bookings (newest first), owner bookings by venue, venue-delete guard, earnings/count aggregations
    [{ customer: 1, createdAt: -1 }],
    [{ venue: 1, createdAt: -1 }],
    [{ venue: 1, status: 1, startTime: 1 }],
    [{ status: 1, startTime: 1 }],
    [{ quotation: 1, status: 1 }],
    [{ venue: 1, status: 1, endTime: 1 }],
  ],
  inquiries: [
    [{ customer: 1, createdAt: -1 }],
    [{ venue: 1, createdAt: -1 }],
    [{ venue: 1, status: 1, createdAt: -1 }],
  ],
  quotations: [[{ owner: 1, createdAt: -1 }], [{ inquiry: 1, status: 1, createdAt: -1 }]],
  activitylogs: [[{ createdAt: -1 }]],
};

const run = async () => {
  const models = [
    "../model/user", "../model/venue", "../model/space", "../model/review", "../model/notification",
    "../model/chat", "../model/message", "../model/booking", "../model/inquiry", "../model/quotation",
    "../model/payment", "../model/paymentAttempt", "../model/refreshToken", "../model/activityLog",
  ].map((m) => require(m));

  await mongoose.connect(process.env.DB_URL);
  console.log("Ensuring indexes on", mongoose.connection.name);
  for (const model of models) {
    if (model && model.createIndexes) {
      await model.createIndexes();
      console.log("  schema indexes:", model.collection.collectionName);
    }
  }
  for (const [collection, specs] of Object.entries(EXTRA)) {
    for (const [keys, options] of specs) {
      const name = await mongoose.connection.collection(collection).createIndex(keys, options || {});
      console.log("  extra index:", collection, name);
    }
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, EXTRA };
