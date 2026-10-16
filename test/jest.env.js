// Fake, test-only values so the suite runs without a real .env (locally and in CI).
process.env.NODE_ENV = "test";
const defaults = {
  JWT_SECRET: "test-jwt-secret",
  REFRESH_TOKEN_SECRET: "test-refresh-secret",
  DB_URL: "mongodb://127.0.0.1:27017/venure-test",
  FRONTEND_URL: "http://localhost:5173",
  CLOUDINARY_CLOUD_NAME: "test",
  CLOUDINARY_API_KEY: "test",
  CLOUDINARY_API_SECRET: "test",
  ESEWA_MERCHANT_CODE: "EPAYTEST",
  ESEWA_SECRET_KEY: "test",
  GMAIL_USER: "test@example.com",
  GMAIL_PASS: "test",
};
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

// Windows ignores a TZ given on the command line when a process starts; assigning it again inside the process
// applies it. This lets `TZ=America/New_York npx jest ...` prove the date logic does not depend on the host zone.
if (process.env.TZ) process.env.TZ = process.env.TZ;
