const dotenv = require("dotenv");
dotenv.config({
  path: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
});

const http = require("http");
const app = require("./app");
const connectDB = require("./database/db");
const setupSocket = require("./socket/socket");
const logger = require("./utils/logger"); 

const PORT = process.env.PORT || 5050;
const server = http.createServer(app);

// Socket Setup
const io = setupSocket(server);
app.set("io", io);

// Validate Crucial Env Vars
// server.js
const requiredEnv = [
  "DB_URL", 
  "JWT_SECRET", 
  "FRONTEND_URL",
  "CLOUDINARY_CLOUD_NAME", 
  "CLOUDINARY_API_KEY",    
  "CLOUDINARY_API_SECRET"  
];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`❌ Missing critical environment variable: ${key}`);
    process.exit(1);
  }
});

const startServer = async () => {
  try {
    await connectDB();
    logger.info(" Database connected successfully.");
    
    server.listen(PORT, () => {
      logger.info(`🚀 Enterprise Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  } catch (err) {
    logger.error("💥 Server startup failed: ", err);
    process.exit(1);
  }
};

startServer();

// Graceful Shutdown Mechanics
const shutdown = (signal) => {
  logger.warn(` Received ${signal}. Terminating connections gracefully...`);

  server.close(async () => {
    logger.info("HTTP server closed.");
    // Close DB 
    process.exit(0);
  });

  setTimeout(() => {
    logger.error(" Forced shutdown initiated due to timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  logger.error(" Unhandled Promise Rejection:", err);
  server.close(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
  logger.error(" Uncaught Exception thrown:", err);
  process.exit(1);
});