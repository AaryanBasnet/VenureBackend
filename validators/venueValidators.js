const { z } = require("zod");

// Utility to parse JSON strings coming from multipart/form-data
const parseJsonString = (val) => {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
};

const createVenueSchema = z.object({
  venueName: z.string().min(2, "Venue name must be at least 2 characters"),
  capacity: z.coerce.number().min(1, "Capacity must be at least 1"),
  description: z.string().optional(),
  pricePerHour: z.coerce.number().min(0, "Price cannot be negative"),
  
  // Zod preprocess intercepts the stringified array and converts it
  amenities: z.preprocess(parseJsonString, z.array(z.string()).default([])),
  
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
  lng: z.coerce.number().optional(), // For Maps
  lat: z.coerce.number().optional(), // For Maps
  radius: z.coerce.number().default(10), // Miles
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(6),
});

const updateVenueSchema = z.object({
  venueName: z.string().min(2, "Venue name must be at least 2 characters").optional(),
  capacity: z.coerce.number().min(1, "Capacity must be at least 1").optional(),
  description: z.string().optional(),
  pricePerHour: z.coerce.number().min(0, "Price cannot be negative").optional(),
  amenities: z.preprocess(parseJsonString, z.array(z.string()).optional()),
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