const { z } = require("zod");

const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5, "Rating must be between 1 and 5"),
  title: z.string().max(100, "Title cannot exceed 100 characters").optional(),
  comment: z.string().max(1000, "Comment cannot exceed 1000 characters"),
});

module.exports = { createReviewSchema };