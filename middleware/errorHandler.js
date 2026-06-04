const mongoose = require("mongoose");
const multer = require("multer");
const AppError = require("../utils/AppError");

const handleCastErrorDB = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);

const handleDuplicateFieldsDB = (err) => {
  const value = err.keyValue
    ? Object.values(err.keyValue)[0]
    : "duplicate value";

  return new AppError(`Duplicate field value: ${value}`, 400);
};

const handleValidationErrorDB = (err) => {
  const messages = Object.values(err.errors).map(el => el.message);
  return new AppError(messages.join(". "), 400);
};

const handleJWTError = () =>
  new AppError("Invalid token. Please log in again.", 401);

const handleJWTExpired = () =>
  new AppError("Token expired. Please log in again.", 401);

const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  // operational, trusted error
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // programming or unknown error
  console.error("ERROR 💥", err);

  return res.status(500).json({
    success: false,
    message: "Something went wrong",
  });
};

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // --- MONGOOSE ERRORS ---
  if (err instanceof mongoose.Error.CastError)
    error = handleCastErrorDB(err);

  if (err.code === 11000)
    error = handleDuplicateFieldsDB(err);

  if (err instanceof mongoose.Error.ValidationError)
    error = handleValidationErrorDB(err);

  // --- MULTER ERRORS ---
  if (err instanceof multer.MulterError) {
    error = new AppError(err.message, 400);
  }

  if (err.message?.includes("Only image files are allowed")) {
    error = new AppError(err.message, 400);
  }

  // --- JWT ERRORS ---
  if (err.name === "JsonWebTokenError")
    error = handleJWTError();

  if (err.name === "TokenExpiredError")
    error = handleJWTExpired();

  // --- ENVIRONMENT HANDLING ---
  if (process.env.NODE_ENV === "development") {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

module.exports = errorHandler;