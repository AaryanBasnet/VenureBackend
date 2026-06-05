const AppError = require("../utils/AppError");

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    // Map all errors into a readable format (e.g., "email: Invalid email, password: Too short")
    const errorMessages = result.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join(", ");
      
    return next(new AppError(`Validation Error - ${errorMessages}`, 400));
  }

  // Assign the sanitized data back to req.body (strips out unknown fields)
  req.body = result.data; 
  next();
};

module.exports = validate;