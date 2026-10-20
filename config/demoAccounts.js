// The one-click demo accounts (see services/demoScope.js and middleware/demoGuard.js for what they may do).
// They have no usable password: scripts/seed-demo.js gives them a random one nobody knows, and the only way in is
// POST /api/auth/demo. The addresses use the reserved ".invalid" ending, so they can never receive real mail.
const DEMO_ACCOUNTS = {
  customer: { role: "Customer", name: "Demo Customer", email: "demo.customer@demo.venure.invalid" },
  owner: { role: "VenueOwner", name: "Demo Venue Owner", email: "demo.owner@demo.venure.invalid" },
  admin: { role: "Admin", name: "Demo Admin", email: "demo.admin@demo.venure.invalid" },
};

// What the demo customer may do on top of reading: send requests, only to demo venues, a few at a time
const DEMO_INQUIRY_LIMIT_PER_DAY = 5;
const DEMO_INQUIRY_TTL_MS = 24 * 60 * 60 * 1000;

module.exports = { DEMO_ACCOUNTS, DEMO_INQUIRY_LIMIT_PER_DAY, DEMO_INQUIRY_TTL_MS };
