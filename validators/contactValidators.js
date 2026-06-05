const { z } = require("zod");

const submitContactSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100, "Name is too long"),
  
  // Accepts a valid email OR an empty string if they leave it blank
  email: z.union([z.string().email("Invalid email address"), z.literal("")]).optional(),
  
  phone: z.string().max(20, "Phone number is too long").optional(),
  
  message: z.string()
    .min(10, "Message must be at least 10 characters")
    .max(2000, "Message cannot exceed 2000 characters"),
});

module.exports = { submitContactSchema };