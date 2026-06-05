const { z } = require("zod");

/* ========================
   REGISTER VALIDATION
======================== */
const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(8),
  password: z.string().min(6),
  role: z.string().optional(),
});

/* ========================
   LOGIN VALIDATION
======================== */
const loginSchema = z.object({
  email: z.string().email(),
  password: z
  .string()
  .min(8)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
});

/* ========================
   FORGOT PASSWORD
======================== */
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

/* ========================
   RESET PASSWORD
======================== */
const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  password: z.string().min(6),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};