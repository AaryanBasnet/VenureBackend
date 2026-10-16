const { z } = require("zod");
const { VENUE_CATEGORIES } = require("../model/venue");

// Utility to parse JSON strings coming from multipart/form-data
const parseJsonString = (val) => {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
};

const packageInput = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(80).optional(),
  pricePerPlate: z.coerce.number().min(0),
  minPlates: z.coerce.number().int().min(1).optional(),
  highlights: z.array(z.string().trim().min(1).max(140)).max(8).optional(),
});

const drinkOptionInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(140).optional(),
  items: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
});

// Nepali numbers: 98XXXXXXXX, +977 98XXXXXXXX, landlines with area code. Empty string clears it.
const contactPhoneInput = z.string().trim().regex(/^(\+?[\d\s-]{7,16})?$/, "Enter a valid phone number");

const createVenueSchema = z.object({
  venueName: z.string().min(2, "Venue name must be at least 2 characters"),
  category: z.enum(VENUE_CATEGORIES, { message: "Select a venue category" }),
  description: z.string().optional(),
  // capacity/pricePerHour moved to Space — see validators/spaceValidators.js

  // Zod preprocess intercepts the stringified array and converts it
  amenities: z.preprocess(parseJsonString, z.array(z.string()).default([])),
  packages: z.preprocess(parseJsonString, z.array(packageInput).max(6).default([])),
  drinkOptions: z.preprocess(parseJsonString, z.array(drinkOptionInput).max(6).default([])),
  contactPhone: contactPhoneInput.optional(),
  
  location: z.preprocess(parseJsonString, z.object({
    address: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
  })),

  // Prep for Maps integration (Optional on creation, updated later via map click)
  geoCoordinates: z.preprocess(parseJsonString, z.object({
    longitude: z.number(),
    latitude: z.number(),
  }).optional()),
});

// Maps Integration: Upgraded User Search
const searchVenuesSchema = z.object({
  search: z.string().optional(),
  city: z.string().optional(),
  category: z.enum(VENUE_CATEGORIES).optional(),
  lng: z.coerce.number().optional(), // For Maps
  lat: z.coerce.number().optional(), // For Maps
  radius: z.coerce.number().default(10), // Miles
  guests: z.coerce.number().int().positive().optional(), // needs a space that holds at least this many
  amenities: z.string().max(300).optional(), // comma separated; a venue must have all of them
  minPrice: z.coerce.number().int().min(0).optional(), // NPR per plate: some package must cost at least this
  maxPrice: z.coerce.number().int().min(0).optional(), // ...and some package at most this
  sort: z.enum(["newest", "rating", "price_asc", "price_desc", "popular"]).optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(6),
});

const updateVenueSchema = z.object({
  venueName: z.string().min(2, "Venue name must be at least 2 characters").optional(),
  category: z.enum(VENUE_CATEGORIES).optional(),
  description: z.string().optional(),
  // capacity/pricePerHour moved to Space — see validators/spaceValidators.js
  amenities: z.preprocess(parseJsonString, z.array(z.string()).optional()),
  packages: z.preprocess(parseJsonString, z.array(packageInput).max(6).optional()),
  drinkOptions: z.preprocess(parseJsonString, z.array(drinkOptionInput).max(6).optional()),
  contactPhone: contactPhoneInput.optional(),
  location: z.preprocess(parseJsonString, z.object({
    address: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
  }).optional()),
  geoCoordinates: z.preprocess(parseJsonString, z.object({
    longitude: z.number(),
    latitude: z.number(),
  }).optional()),
});

module.exports = { createVenueSchema, searchVenuesSchema, updateVenueSchema };