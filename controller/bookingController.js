const asyncHandler = require("../utils/asyncHandler");
const bookingService = require("../services/bookingService");

/* ========================
   CUSTOMER ENDPOINTS
======================== */
const getBookingsForCustomer = asyncHandler(async (req, res) => {
  const bookings = await bookingService.getCustomerBookings(req.user._id, req.query);

  res.status(200).json({
    success: true,
    data: bookings,
  });
});

const getCustomerBookingCount = asyncHandler(async (req, res) => {
  const count = await bookingService.getCustomerBookingCount(req.user._id);

  res.status(200).json({
    success: true,
    data: count,
  });
});

/* ========================
   VENUE OWNER ENDPOINTS
======================== */
const getBookingsForOwner = asyncHandler(async (req, res) => {
  const bookings = await bookingService.getBookingsForOwner(req.user._id, req.query);

  res.status(200).json({
    success: true,
    data: bookings,
  });
});

const getMonthlyEarningsForOwner = asyncHandler(async (req, res) => {
  const earnings = await bookingService.getMonthlyEarningsForOwner(req.user._id);

  res.status(200).json({
    success: true,
    data: earnings,
  });
});

const getTotalBookingsForOwner = asyncHandler(async (req, res) => {
  const count = await bookingService.getTotalBookingsForOwner(req.user._id);

  res.status(200).json({
    success: true,
    data: count,
  });
});

const settleBalance = asyncHandler(async (req, res) => {
  const booking = await bookingService.settleBalance(req.params.id, req.user._id, req.body);

  res.status(200).json({
    success: true,
    message: "Balance recorded as settled",
    data: booking,
  });
});

/* ========================
   STATUS MODIFICATIONS
======================== */
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBooking(req.params.id, req.user, req.app.get("io"));

  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
    data: booking,
  });
});

const completeBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.completeBooking(req.params.id, req.user);

  res.status(200).json({
    success: true,
    message: "Booking marked as completed",
    data: booking,
  });
});

/* ========================
   GLOBAL / ADMIN ENDPOINTS
======================== */
const getTotalBookings = asyncHandler(async (req, res) => {
  const count = await bookingService.getGlobalTotalBookings();

  res.status(200).json({
    success: true,
    data: count,
  });
});

const getTopVenuesByBooking = asyncHandler(async (req, res) => {
  const topVenues = await bookingService.getTopVenuesByBooking();

  res.status(200).json({
    success: true,
    data: topVenues,
  });
});

module.exports = {
  getBookingsForCustomer,
  getCustomerBookingCount,
  getBookingsForOwner,
  getMonthlyEarningsForOwner,
  getTotalBookingsForOwner,
  settleBalance,
  cancelBooking,
  completeBooking,
  getTotalBookings,
  getTopVenuesByBooking,
};
