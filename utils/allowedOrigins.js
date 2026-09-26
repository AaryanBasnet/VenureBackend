// Browser origins allowed to call the API and open sockets.
// FRONTEND_URL may hold several comma-separated origins (e.g. production + preview).
// Outside production, any http://localhost:<port> origin is also allowed for local dev.
const normalize = (origin) => origin.trim().replace(/\/$/, "");

const configured = (process.env.FRONTEND_URL || "")
  .split(",")
  .map(normalize)
  .filter(Boolean);

const isLocalDevOrigin = (origin) =>
  process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin);

const isAllowedOrigin = (origin) => configured.includes(origin) || isLocalDevOrigin(origin);

module.exports = { configured, isAllowedOrigin };
