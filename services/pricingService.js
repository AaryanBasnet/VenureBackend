const AppError = require("../utils/AppError");

/* =========================================================================
   ADD-ON CATALOG (server-owned)
   Prices are NPR. Clients only send add-on ids; prices sent by the client are ignored.
   Keep ids in sync with the booking UI.
========================================================================= */
const ADDON_CATALOG = {
  "premium-decoration": { name: "Premium Decoration", price: 15000, perPerson: false },
  "professional-photography": { name: "Photography", price: 25000, perPerson: false },
  "premium-catering": { name: "Catering", price: 800, perPerson: true },
  "dj-sound-system": { name: "DJ & Sound", price: 12000, perPerson: false },
  "guest-transportation": { name: "Transportation", price: 8000, perPerson: false },
};

const HOUR_MS = 60 * 60 * 1000;
const MAX_BOOKING_HOURS = 24;

/**
 * Accepts add-ons as ids or { id } objects and returns trusted catalog entries.
 */
const resolveAddons = (addons = []) => {
  const ids = [...new Set(addons.map((a) => (typeof a === "string" ? a : a?.id)))];
  return ids.map((id) => {
    const addon = ADDON_CATALOG[id];
    if (!addon) throw new AppError(`Unknown add-on: ${id}`, 400);
    return { id, ...addon };
  });
};

/**
 * Validates the requested slot against the venue and returns the trusted price breakdown.
 */
const quoteBooking = ({ venue, startTime, endTime, numberOfGuests, addons }) => {
  if (!venue || venue.isDeleted || venue.status !== "approved") {
    throw new AppError("Venue is not currently available", 400);
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError("Invalid booking time range", 400);
  }
  if (start.getTime() <= Date.now()) {
    throw new AppError("Bookings must start in the future", 400);
  }

  const hoursBooked = Math.ceil((end - start) / HOUR_MS);
  if (hoursBooked > MAX_BOOKING_HOURS) {
    throw new AppError(`Bookings cannot be longer than ${MAX_BOOKING_HOURS} hours`, 400);
  }

  if (venue.capacity && numberOfGuests > venue.capacity) {
    throw new AppError(`Maximum capacity is ${venue.capacity}`, 400);
  }
  if (typeof venue.pricePerHour !== "number") {
    throw new AppError("Venue has no price configured", 400);
  }

  const selectedAddons = resolveAddons(addons);
  const basePrice = hoursBooked * venue.pricePerHour;
  const addonsPrice = selectedAddons.reduce(
    (sum, addon) => sum + (addon.perPerson ? addon.price * numberOfGuests : addon.price),
    0
  );

  return {
    start,
    end,
    hoursBooked,
    selectedAddons,
    totalPrice: basePrice + addonsPrice, // NPR
  };
};

/* =========================================================================
   CURRENCY
   Venue prices are NPR; Stripe charges USD.
========================================================================= */
const nprToUsdCents = (amountNPR) => {
  const rate = Number(process.env.USD_NPR_RATE) || 132;
  return Math.round((amountNPR / rate) * 100);
};

module.exports = {
  ADDON_CATALOG,
  resolveAddons,
  quoteBooking,
  nprToUsdCents,
};
