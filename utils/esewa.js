const crypto = require("crypto");

// eSewa ePay v2. Without ESEWA_* set outside production we fall back to eSewa's
// published sandbox merchant, so local development works with the eSewa test wallet.
const SANDBOX = {
  merchantCode: "EPAYTEST",
  secretKey: "8gBm/:&EnhH.1/q",
  formUrl: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  statusUrl: "https://rc.esewa.com.np/api/epay/transaction/status/",
};

const isProduction = () => process.env.NODE_ENV === "production";

const getConfig = () => {
  const merchantCode = process.env.ESEWA_MERCHANT_CODE || (isProduction() ? null : SANDBOX.merchantCode);
  const secretKey = process.env.ESEWA_SECRET_KEY || (isProduction() ? null : SANDBOX.secretKey);
  if (!merchantCode || !secretKey) {
    throw new Error("ESEWA_MERCHANT_CODE and ESEWA_SECRET_KEY are not set. Payments are unavailable.");
  }
  return {
    merchantCode,
    secretKey,
    formUrl: process.env.ESEWA_FORM_URL || SANDBOX.formUrl,
    statusUrl: process.env.ESEWA_STATUS_URL || SANDBOX.statusUrl,
  };
};

// eSewa signs "name=value,name=value" for the fields listed in signed_field_names.
const sign = (fields, names, secretKey) => {
  const message = names.split(",").map((name) => `${name}=${fields[name]}`).join(",");
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// The success redirect carries ?data=<base64 JSON>. Returns the parsed body if its signature is valid.
const decodeCallback = (encoded) => {
  let body;
  try {
    body = JSON.parse(Buffer.from(String(encoded), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!body || typeof body.signed_field_names !== "string" || !body.signature) return null;
  const { secretKey } = getConfig();
  const names = body.signed_field_names;
  if (names.split(",").some((name) => body[name] === undefined)) return null;
  return safeEqual(sign(body, names, secretKey), body.signature) ? body : null;
};

// Asks eSewa directly whether the payment is complete (the redirect alone is not proof).
const fetchStatus = async ({ transactionUuid, totalAmount }) => {
  const { merchantCode, statusUrl } = getConfig();
  const url = `${statusUrl}?product_code=${encodeURIComponent(merchantCode)}&total_amount=${encodeURIComponent(totalAmount)}&transaction_uuid=${encodeURIComponent(transactionUuid)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`eSewa status check failed (${res.status})`);
  return res.json();
};

module.exports = { getConfig, sign, decodeCallback, fetchStatus };
