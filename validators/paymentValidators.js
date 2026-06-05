const { z } = require("zod");

const initiatePaymentSchema = z.object({
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID"),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  numberOfGuests: z.number().int().min(1),
  selectedAddons: z.array(z.any()).optional(),
  
  // The frontend must specify how the user wants to pay
  provider: z.enum(["stripe", "esewa", "khalti"]), 
});

module.exports = { initiatePaymentSchema };