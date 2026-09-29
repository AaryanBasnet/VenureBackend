const { z } = require("zod");

/* ========================
   SHARED RULES
======================== */
// Single source of truth for password strength — register and reset must match
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[0-9]/, "Password must contain a number");

const email = z.string().trim().toLowerCase().email("Invalid email address");

/* ========================
   REGISTER VALIDATION
======================== */
const registerSchema = z.object({
  name: z.string().trim().min(2).max(50),
  email,
  phone: z.string().trim().min(8).max(20),
  password: strongPassword,
  // Admin accounts can never be self-registered
  role: z.enum(["Customer", "VenueOwner"]).default("Customer"),
});

/* ========================
   LOGIN VALIDATION
======================== */
// No strength rules here: login only checks the credentials match
const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(128),
});

/* ========================
   FORGOT PASSWORD
======================== */
const forgotPasswordSchema = z.object({
  email,
});

/* ========================
   VERIFY RESET CODE
======================== */
const verifyResetCodeSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

/* ========================
   RESET PASSWORD
======================== */
const resetPasswordSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  password: strongPassword,
});

/* ========================
   VERIFY CURRENT PASSWORD
======================== */
const verifyPasswordSchema = z.object({
  password: z.string().min(1, "Password is required").max(128),
});

/* ========================
   GOOGLE SIGN-IN
======================== */
// `credential` is the ID token JWT from Google Identity Services; verified server-side
const googleAuthSchema = z.object({
  credential: z.string().min(20, "Missing Google credential"),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  verifyPasswordSchema,
  googleAuthSchema,
};
