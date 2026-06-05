// middleware/validateMiddleware.js
const AppError = require("../utils/AppError");

// Added target parameter (defaults to "body")
const validate = (schema, target = "body") => (req, res, next) => {
  const result = schema.safeParse(req[target]);

  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join(", ");
      
    return next(new AppError(`Validation Error - ${errorMessages}`, 400));
  }

  // Assign the sanitized data back to the targeted request object
  req[target] = result.data; 
  next();
};

module.exports = validate;