const Booking = require("../model/booking");

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const convertNprToUsdCents = (nprAmount) => {
  const exchangeRate = 132;
  // Convert NPR to USD, then to cents (Stripe expects smallest currency unit)
  return Math.round((nprAmount / exchangeRate) * 100);
};
exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount, venueId, bookingDate, timeSlot } = req.body;

    const conflict = await Booking.findOne({
      venue: venueId,
      bookingDate: new Date(bookingDate),
      timeSlot,
      status: { $in: ["booked", "approved"] },
    });

    if (conflict) {
      return res
        .status(400)
        .json({ success: false, message: "Slot already booked." });
    }

    const amountInUsdCents = convertNprToUsdCents(amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInUsdCents,
      currency: "usd",
      metadata: { venueId, bookingDate, timeSlot },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id, // ✅ return this to client
    });
  } catch (err) {
    console.error("Payment Intent error", err);
    res.status(500).json({ error: err.message });
  }
};