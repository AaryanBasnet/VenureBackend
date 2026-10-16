const { z } = require("zod");

const createReviewSchema = z.object({
  bookingId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid booking ID"),
  rating: z.number().int().min(1).max(5, "Rating must be between 1 and 5"),
  title: z.string().max(100, "Title cannot exceed 100 characters").optional(),
  comment: z.string().max(1000, "Comment cannot exceed 1000 characters"),
});

const adminReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  featured: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(100).optional(),
});

module.exports = { createReviewSchema, adminReviewQuerySchema };