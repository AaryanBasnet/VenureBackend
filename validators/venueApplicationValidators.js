const { z } = require("zod");
const { VENUE_TYPES } = require("../model/venueApplication");
const { VENUE_CATEGORIES } = require("../model/venue");
const { strongPassword } = require("./authValidators");

// Multipart bodies arrive as strings, so the structured fields come in as JSON text.
const json = (val) => {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
};

// Only real Google Maps addresses: the host is checked, not just how the text starts.
const isGoogleMapsLink = (text) => {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (/^(www\.)?google\.(com|com\.np|co\.in|[a-z]{2})$/.test(host)) return url.pathname.startsWith("/maps");
  if (/^maps\.google\.(com|com\.np|co\.in|[a-z]{2})$/.test(host)) return true;
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return url.pathname.startsWith("/maps");
  return false;
};

const hall = z.object({
  name: z.string().trim().min(1, "Name every hall").max(80),
  capacity: z.coerce.number().int().min(1, "A hall must hold at least 1 guest").max(100000),
});

const submitApplicationSchema = z.object({
  venueName: z.string().trim().min(2, "Enter the venue name").max(80),
  venueType: z.enum(VENUE_TYPES, { message: "Choose the kind of venue" }),
  about: z.string().trim().max(500).optional().default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => {
      const digits = v.replace(/\D/g, "").replace(/^977/, "");
      return digits.length >= 7 && digits.length <= 10 && /^[\d\s+-]+$/.test(v);
    }, "Enter a valid phone number"),
  contactName: z.string().trim().min(2, "Enter the contact person").max(80),
  province: z.string().trim().min(1, "Choose the province").max(60),
  city: z.string().trim().min(1, "Enter the city").max(80),
  area: z.string().trim().min(3, "Enter the street or landmark").max(160),
  mapLink: z
    .string()
    .trim()
    .max(500)
    .optional()
    .default("")
    .refine((v) => v === "" || isGoogleMapsLink(v), "That does not look like a Google Maps link"),
  coordinates: z.preprocess(json, z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish()),
  halls: z.preprocess(json, z.array(hall).min(1, "Add at least one hall").max(6)),
  panNumber: z.string().trim().regex(/^\d{9}$/, "A PAN number has 9 digits"),
});

const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(5, "Tell the applicant why").max(1000),
});

// The category the venue is listed under on the site, chosen by the reviewer
const approveApplicationSchema = z.object({
  category: z.enum(VENUE_CATEGORIES, { message: "Choose a category for the site" }),
});

const listApplicationsSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const setupPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: strongPassword,
});

module.exports = {
  submitApplicationSchema,
  rejectApplicationSchema,
  approveApplicationSchema,
  listApplicationsSchema,
  setupPasswordSchema,
};
