const { z } = require("zod");

const initiateDepositSchema = z.object({
  quotationId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Quotation ID"),
  provider: z.literal("esewa").optional(),
});

const verifyEsewaSchema = z.object({
  data: z.string().min(10, "Missing eSewa response"),
});

module.exports = { initiateDepositSchema, verifyEsewaSchema };
