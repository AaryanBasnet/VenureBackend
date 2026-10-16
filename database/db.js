const mongoose = require('mongoose');
const logger = require("../utils/logger")

const CONNECTION_STRING = process.env.DB_URL;

/* ========================
   VALIDATE CONFIG
======================== */
if (!CONNECTION_STRING){
  logger.error("DB_URL is not defined in environment variables");
  process.exit(1);
}

/* ========================
   CONNECTION OPTIONS
======================== */
const options = {
  serverSelectionTimeoutMS: 10000, // fail fast if DB unreachable
  // One request often runs 2-4 queries in parallel; with 50 requests in flight a pool of 10 queues them behind
  // each other (see docs/PERFORMANCE.md). Override with MONGO_MAX_POOL.
  maxPoolSize: Number(process.env.MONGO_MAX_POOL) || 30,
  minPoolSize: Number(process.env.MONGO_MIN_POOL) || 5, // keep warm connections: no handshake on the first burst
  maxIdleTimeMS: 60000,
  // AUTO_INDEX=0 stops Mongoose building indexes at every start-up (recommended in production: run
  // `node scripts/ensure-indexes.js` as a release step instead). Default unchanged: on.
  autoIndex: process.env.AUTO_INDEX !== "0",
};

/* ========================
   CONNECT FUNCTION
======================== */
const connectDB = async () => {
  try {
    logger.info(" Connecting to MongoDB...");

    await mongoose.connect(CONNECTION_STRING, options);

    logger.info("MongoDB Connected Successfully");
  } catch (err) {
    logger.error({ message: "MongoDB Connection failed", error: err.message });
    process.exit(1);
  }
};


/* ========================
   HANDLE CONNECTION EVENTS
======================== */
mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
  logger.info("🔄 MongoDB reconnected");
});

mongoose.connection.on("error", (err) => {
  logger.error({ message: "MongoDB runtime error", error: err.message });
});

module.exports = connectDB;
