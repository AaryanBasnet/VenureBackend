const { z } = require("zod");

/* =========================================================================
   UTILITIES
========================================================================= */
// Regex to strictly validate 24-character hex strings for MongoDB ObjectIds
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ID format");

/* =========================================================================
   CREATE BOOKING PAYLOAD
========================================================================= */
const createBookingSchema = z.object({
  venue: objectIdSchema,
  
  // Enforces strict ISO 8601 formatting (e.g., "2026-06-05T10:00:00.000Z")
  startTime: z.string().datetime({ message: "Invalid start time. Must be ISO 8601 format." }),
  endTime: z.string().datetime({ message: "Invalid end time. Must be ISO 8601 format." }),
  
  numberOfGuests: z.number().int().positive("Number of guests must be at least 1"),
  eventType: z.string().min(2, "Event type must be at least 2 characters"),
  specialRequirements: z.string().optional(),
  
  contactName: z.string().min(2, "Contact name is required"),
  phoneNumber: z.string().min(7, "Valid phone number is required"),
  
  selectedAddons: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number().nonnegative(),
      perPerson: z.boolean(),
    })
  ).optional(),
  
  totalPrice: z.number().nonnegative("Total price cannot be negative"),
  
  // Payment ID can be passed at the root or nested inside paymentDetails
  paymentIntentId: z.string().optional(),
  paymentDetails: z.object({
    paymentIntentId: z.string().min(1, "Payment Intent ID cannot be empty if object is provided"),
  }).optional()

})
// Cross-field validation: Ensure payment intent exists in at least one location
.refine(
  (data) => data.paymentIntentId || (data.paymentDetails && data.paymentDetails.paymentIntentId),
  {
    message: "A valid PaymentIntentId must be provided either at the root or within paymentDetails",
    path: ["paymentIntentId"],
  }
)
// Cross-field validation: Ensure chronological order
.refine(
  (data) => new Date(data.startTime) < new Date(data.endTime),
  {
    message: "End time must be strictly after the start time",
    path: ["endTime"],
  }
);

/* =========================================================================
   QUERY VALIDATIONS
========================================================================= */
// Used for validating req.query in the getVenueAvailability route
const getAvailabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be strictly in YYYY-MM-DD format"),
});

/* =========================================================================
   BULK PAYLOAD VALIDATIONS
========================================================================= */
// Used for validating req.body in the getApprovedBookingsForVenue route
const bulkVenueBookingsSchema = z.object({
  venueIds: z.array(objectIdSchema).min(1, "At least one venue ID must be provided"),
});

module.exports = {
  createBookingSchema,
  getAvailabilitySchema,
  bulkVenueBookingsSchema,
};