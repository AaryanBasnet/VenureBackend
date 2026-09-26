// Escapes user input so it is matched literally inside a MongoDB $regex (prevents ReDoS / wildcard scans)
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = escapeRegex;
