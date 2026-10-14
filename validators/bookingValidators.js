const { z } = require("zod");

/* =========================================================================
   UTILITIES
========================================================================= */
// Regex to strictly validate 24-character hex strings for MongoDB ObjectIds
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ID format");

/* =========================================================================
   SETTLE BALANCE (owner records the offline payment)
========================================================================= */
const settleBalanceSchema = z.object({
  method: z.string().min(2, "Describe how the balance was paid, e.g. cash, bank transfer"),
  note: z.string().max(500).optional(),
});

module.exports = {
  settleBalanceSchema,
};
