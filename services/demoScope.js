// Demo accounts are safe to hand to anyone, so a demo admin must never read real people's data.
// A demo admin only sees records flagged isDemo (and bookings or reviews of demo venues).
const Venue = require("../model/venue");

const isDemoAdmin = (user) => Boolean(user?.isDemo && user.role === "Admin");

// Ids of the demo venues, for the collections that reach a venue only through a reference
const demoVenueIds = () => Venue.find({ isDemo: true }).distinct("_id");

// An admin may open any request or quotation by its id, except that a demo admin may only open demo ones
const adminMayView = (user, venue) => user.role === "Admin" && (!user.isDemo || Boolean(venue?.isDemo));

module.exports = { isDemoAdmin, demoVenueIds, adminMayView };
