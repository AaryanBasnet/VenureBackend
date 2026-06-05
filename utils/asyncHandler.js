const logger = require("./logger");

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error({
      message: err.message,
      method: req.method,
      url: req.originalUrl,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
    next(err);
  });
};

module.exports = asyncHandler;
