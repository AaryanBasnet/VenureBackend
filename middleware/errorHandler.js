const mongoose = require("mongoose");
const multer = require("multer");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger"); // Injecting our enterprise logger

const handleCastErrorDB = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = Object.values(err.keyValue)[0];
  return new AppError(`The ${field} '${value}' is already taken.`, 400);
};

const handleValidationErrorDB = (err) => {
  const messages = Object.values(err.errors).map(el => el.message);
  return new AppError(`Invalid input data: ${messages.join(". ")}`, 400);
};

const handleJWTError = () =>
  new AppError("Invalid token. Please log in again.", 401);

const handleJWTExpired = () =>
  new AppError("Token expired", 401);

const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // Log the raw error internally, but send a generic message to the client
  logger.error(`💥 FATAL ERROR: ${err.message}\nStack: ${err.stack}`);

  return res.status(500).json({
    success: false,
    message: "An unexpected error occurred. Our engineers have been notified.",
  });
};

const errorHandler = (err, req, res, next) => {
  // Create a copy of the error to avoid mutating the original
  let error = Object.assign(err);

  // --- MONGOOSE ERRORS ---
  if (error.name === "CastError") error = handleCastErrorDB(error);
  if (error.code === 11000) error = handleDuplicateFieldsDB(error);
  if (error.name === "ValidationError") error = handleValidationErrorDB(error);

  // --- MULTER ERRORS ---
  if (error instanceof multer.MulterError) {
    error = new AppError(`Upload error: ${error.message}`, 400);
  }
  if (error.message?.includes("Only image files are allowed")) {
    error = new AppError(error.message, 400);
  }

  // --- JWT ERRORS ---
  if (error.name === "JsonWebTokenError") error = handleJWTError();
  if (error.name === "TokenExpiredError") error = handleJWTExpired();

  // --- ENVIRONMENT HANDLING ---
  if (process.env.NODE_ENV === "development") {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

module.exports = errorHandler;