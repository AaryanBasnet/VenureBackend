const Stripe = require("stripe");

let client = null;

// Created lazily so the server (and tests) can start without Stripe configured;
// only payment calls fail when the key is missing.
const getStripe = () => {
  if (client) return client;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set. Payments are unavailable.");
  }
  client = Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
};

module.exports = { getStripe };
