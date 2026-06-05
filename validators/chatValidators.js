const { z } = require("zod");

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ID");

const createChatSchema = z.object({
  participantId: objectIdSchema,
  venueId: objectIdSchema,
});

const chatIdParamSchema = z.object({
  chatId: objectIdSchema,
});

module.exports = { createChatSchema, chatIdParamSchema };