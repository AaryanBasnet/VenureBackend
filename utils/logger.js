const fs = require("fs");
const winston = require("winston");

// Define base formatting for files (Structured JSON)
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Log files are for local development. In production (Docker, Render, PM2...) the platform collects stdout, so files
// are off unless LOG_TO_FILES=1. A log folder that cannot be created or written must never stop the server from starting.
const fileTransports = () => {
  const wanted = process.env.NODE_ENV !== "production" || process.env.LOG_TO_FILES === "1";
  if (!wanted) return [];
  try {
    fs.mkdirSync("logs", { recursive: true });
    fs.accessSync("logs", fs.constants.W_OK);
  } catch (err) {
    console.warn(`Log files disabled (cannot write to ./logs: ${err.code || err.message}); logging to the console only.`);
    return [];
  }
  return [
    // Error logs file
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    // Combined logs file
    new winston.transports.File({ filename: "logs/combined.log" }),
  ];
};

const logger = winston.createLogger({
  // Capture "info" level and above in production; "debug" during development/testing
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: baseFormat,
  transports: fileTransports(),
});

// Configure Console Transport depending on environment
if (process.env.NODE_ENV !== "production") {
  // Local Development: Human-readable, colorized, simple string logs
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
} else {
  // Production Environment: Standard JSON console logs for system aggregators (Docker/PM2/AWS CloudWatch)
  logger.add(
    new winston.transports.Console({
      format: baseFormat,
    })
  );
}

module.exports = logger;