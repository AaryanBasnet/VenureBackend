const { z } = require("zod");
const { SHIFT_NAMES } = require("../model/space");

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format");

const lineItemSchema = z.object({
  label: z.string().min(1, "Line item needs a label"),
  description: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().min(0, "Price cannot be negative"),
  perGuest: z.boolean().default(false),
});

// Deposit range/bounds (percentage 10-50%, fixed 0 < value < totalPrice) are
// enforced server-side in quotationService.computeDepositAmount, since
// totalPrice isn't known until the line items are resolved.
const createQuotationSchema = z.object({
  space: objectIdSchema,
  eventDate: z.string().datetime({ message: "Invalid date. Must be ISO 8601 format." }),
  shift: z.enum(SHIFT_NAMES),
  numberOfGuests: z.number().int().positive("Number of guests must be at least 1"),
  lineItems: z.array(lineItemSchema).min(1, "A quotation needs at least one line item"),
  depositType: z.enum(["percentage", "fixed"]),
  depositValue: z.number().positive("Deposit value must be positive"),
  notes: z.string().max(1000).optional(),
});

module.exports = { createQuotationSchema };
