const { z } = require("zod");
const { SHIFT_NAMES } = require("../model/space");

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format");

const createInquirySchema = z.object({
  venue: objectIdSchema,
  space: objectIdSchema.optional(), // customer may leave this to the owner to recommend
  preferredDate: z.string().datetime({ message: "Invalid date. Must be ISO 8601 format." }),
  preferredShift: z.enum(SHIFT_NAMES).optional(),
  numberOfGuests: z.number().int().positive("Number of guests must be at least 1").max(100000),
  eventType: z.string().min(2, "Event type must be at least 2 characters"),
  message: z.string().max(1000).optional(),
  contactName: z.string().min(2, "Contact name is required"),
  phoneNumber: z.string().min(7, "Valid phone number is required"),
});

module.exports = { createInquirySchema };
