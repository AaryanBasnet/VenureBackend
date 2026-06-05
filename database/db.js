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
  maxPoolSize: 10, // better connection pooling
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
