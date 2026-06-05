const { z } = require("zod");

const toggleFavoriteSchema = z.object({
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID"),
});

module.exports = { toggleFavoriteSchema };