require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");

const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit")

const authRoutes = require("./route/authRoutes");
const venueRoutes = require("./route/venueOwnerRoutes/venueRoutes");
const adminUserRoutes = require("./route/admin/adminUserRoute");
const bookingRoutes = require("./route/bookingRoutes");
const adminVenueRoutes = require("./route/admin/venueApprovalRoutes");
const userVenueRoutes = require("./route/user/userVenueRoute");
const userRoutes = require("./route/user/userRoutes");
const chatRoutes = require("./route/chatRoutes");
const messageRoutes = require("./route/messageRoutes");
const favoritesRoutes = require("./route/user/favorites");
const activityRoutes = require("./route/admin/dashboardRoutes");
const notificationRoutes = require("./route/notification");
const reviewRoutes = require("./route/reviewRoutes");
const testimonialRoutes = require("./route/testimonialRoutes");
const contactRoutes = require("./route/contactRoutes");
const paymentRoutes = require("./route/paymentRoutes");

const errorHandler = require("./middleware/errorHandler")

const app = express();

/* ========================
   TRUST PROXY (important for deployment)
======================== */
app.set("trust proxy", 1);

/* ========================
   SECURITY MIDDLEWARE
======================== */
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(mongoSanitize());

/* ========================
   REQUEST COMPRESSION
======================== */
app.use(compression());//reduce size of data sent to server to frontend

/* ========================
   REQUEST LOGGING
======================== */
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

/* ========================
   BODY LIMIT (security)
======================== */
app.use(express.json({ limit: "10kb" }));

/* ========================
   STATIC FILES
======================== */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ========================
   GLOBAL RATE LIMITER
   (basic protection layer)
======================== */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200, // limit each IP
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

app.use(limiter);


/* ========================
   TEST ROUTES
======================== */
if (process.env.NODE_ENV === "test") {
  const testRoutes = require("./route/testRoutes");
  app.use("/test", testRoutes);
}


/* ========================
   API ROUTES
======================== */
app.use("/api/auth", authRoutes);
app.use("/api/venueOwner/venues", venueRoutes);
app.use("/api/admin/user", adminUserRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin/venues", adminVenueRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/user/venues", userVenueRoutes);
app.use("/api/user/favorites", favoritesRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", activityRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api", reviewRoutes);
app.use("/api/testimonials", testimonialRoutes);
app.use("/api/contact", contactRoutes);

/* ========================
   HEALTH CHECK
======================== */
app.get("/health", (req,res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy",
  })
})

/* ========================
   404 HANDLER
======================== */
app.all("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
  });
});

/* ========================
   GLOBAL ERROR HANDLER
======================== */
app.use(errorHandler);

module.exports = app;

