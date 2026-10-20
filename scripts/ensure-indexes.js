/* eslint-disable no-console */
// Optional: builds every index the models declare, right now. The server already does this when it starts (Mongoose
// autoIndex, on unless AUTO_INDEX=0), so on a normal setup there is nothing to run. Use this if you set AUTO_INDEX=0
// to keep large databases from re-checking indexes at every start, or to check a database by hand. Idempotent; it
// never drops or changes data.
//
//   node scripts/ensure-indexes.js            # uses DB_URL from the environment / .env
const mongoose = require("mongoose");
require("dotenv").config();

const run = async () => {
  const models = [
    "../model/user", "../model/venue", "../model/space", "../model/review", "../model/notification",
    "../model/chat", "../model/message", "../model/booking", "../model/inquiry", "../model/quotation",
    "../model/payment", "../model/paymentAttempt", "../model/venueApplication", "../model/refreshToken", "../model/activityLog",
  ].map((m) => require(m));

  await mongoose.connect(process.env.DB_URL);
  console.log("Ensuring indexes on", mongoose.connection.name);
  for (const model of models) {
    if (model && model.createIndexes) {
      await model.createIndexes();
      console.log("  schema indexes:", model.collection.collectionName);
    }
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
