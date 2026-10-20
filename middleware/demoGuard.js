// Demo accounts can look at everything they are shown, but change almost nothing.
// Runs inside protectRoute, so it covers every route, including ones added later.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The only writes a demo account may make: the demo customer may send a request (the service limits it to demo venues)
const ALLOWED_WRITES = { Customer: [{ method: "POST", path: "/api/inquiries" }] };

const demoBlockMessage = (req, user) => {
  if (READ_METHODS.has(req.method)) return null;
  const path = (req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
  const allowed = (ALLOWED_WRITES[user.role] || []).some((rule) => rule.method === req.method && rule.path === path);
  if (allowed) return null;
  return "This is a demo account, so changes are turned off. You can look at everything, and the demo customer can send a request.";
};

module.exports = { demoBlockMessage };
