const asyncHandler = require("../utils/asyncHandler");
const bookingService = require("../services/bookingService");

/* ========================
   CREATE BOOKING
======================== */
const createBooking = asyncHandler(async (req, res) => {
  // req.body is already perfectly formatted and validated by Zod at this point
  const newBooking = await bookingService.createBooking(req.body, req.user._id);

  res.status(201).json({
    success: true,
    message: "Booking created successfully",
    data: newBooking,
  });
});

/* ========================
   CUSTOMER ENDPOINTS
======================== */
const getBookingsForCustomer = asyncHandler(async (req, res) => {
  const bookings = await bookingService.getCustomerBookings(req.user._id);

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
  const bookings = await bookingService.getBookingsForOwner(req.user._id);

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

/* ========================
   STATUS MODIFICATIONS
======================== */
const approveBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.modifyBookingStatus(req.params.id, "approved");

  res.status(200).json({
    success: true,
    message: "Booking approved successfully",
    data: booking,
  });
});

const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.modifyBookingStatus(req.params.id, "cancelled");

  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
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
  createBooking,
  getBookingsForCustomer,
  getCustomerBookingCount,
  getBookingsForOwner,
  getMonthlyEarningsForOwner,
  getTotalBookingsForOwner,
  approveBooking,
  cancelBooking,
  getTotalBookings,
  getTopVenuesByBooking,
};