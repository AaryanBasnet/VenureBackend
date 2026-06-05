const mongoose = require('mongoose');

const CONNECTION_STRING = process.env.DB_URL;

/* ========================
   VALIDATE CONFIG
======================== */
if (!CONNECTION_STRING){
  console.error("DB_URL is not defined in environment variables");
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
    console.error("MongoDB Connection failed: ", err);
    process.exit(1);
  }
};


/* ========================
   HANDLE CONNECTION EVENTS
======================== */
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
  logger.info("🔄 MongoDB reconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB runtime error:", err);
});

module.exports = connectDB;
