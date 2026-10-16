const { z } = require("zod");
const { SHIFT_NAMES } = require("../model/space");

const shiftOverrideSchema = z.object({
  shift: z.enum(SHIFT_NAMES),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm format (00:00 to 23:59)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm format (00:00 to 23:59)"),
});

const createSpaceSchema = z.object({
  name: z.string().min(2, "Space name must be at least 2 characters"),
  description: z.string().optional(),
  capacity: z.coerce.number().min(1, "Capacity must be at least 1"),
  amenities: z.array(z.string()).default([]),
  indicativePricePerHour: z.coerce.number().min(0).optional(),
  shiftOverrides: z.array(shiftOverrideSchema).max(SHIFT_NAMES.length).optional(),
  defaultDepositType: z.enum(["percentage", "fixed"]).optional(),
  defaultDepositValue: z.coerce.number().positive().optional(),
});

const updateSpaceSchema = createSpaceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

module.exports = { createSpaceSchema, updateSpaceSchema };
