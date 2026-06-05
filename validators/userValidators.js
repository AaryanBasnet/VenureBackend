const { z } = require("zod");

const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50, "Name is too long").optional(),
  phone: z.string().max(20, "Phone number is too long").optional(),
  address: z.string().max(150, "Address is too long").optional(),
});

const adminUserQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  role: z.enum(["Customer", "VenueOwner", "Admin"]).optional(),
});

module.exports = { updateUserSchema, adminUserQuerySchema };