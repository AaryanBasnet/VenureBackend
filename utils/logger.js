const winston = require("winston");

// Define base formatting for files (Structured JSON)
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  // Capture "info" level and above in production; "debug" during development/testing
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: baseFormat,
  transports: [
    // Error logs file
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    // Combined logs file
    new winston.transports.File({
      filename: "logs/combined.log",
    }),
  ],
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