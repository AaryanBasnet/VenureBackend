const AppError = require("../utils/AppError");

const validate = (schema, target = "body") => (req, res, next) => {
  const result = schema.safeParse(req[target] ?? {});

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join(", ");

    return next(new AppError(`Validation Error - ${errorMessages}`, 400));
  }

  // Express 5 exposes req.query as a getter, so plain assignment is silently ignored.
  // Shadow it on the request instance so handlers receive the parsed/coerced data.
  Object.defineProperty(req, target, {
    value: result.data,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  next();
};

module.exports = validate;
