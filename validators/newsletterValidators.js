const { z } = require("zod");

const subscribeSchema = z.object({
  email: z.string().email("Invalid email address"),
});

module.exports = { subscribeSchema };
