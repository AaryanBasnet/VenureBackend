const { z } = require("zod");

// Validates the req.params.id
const notificationIdSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Notification ID"),
});

module.exports = { notificationIdSchema };