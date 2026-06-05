// require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const cookieParser = require("cookie-parser");


const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit")

const authRoutes = require("./route/authRoutes");
const passwordRoutes = require("./route/passwordRoutes")
const venueRoutes = require("./route/venueRoutes");
const bookingRoutes = require("./route/bookingRoutes");
const userRoutes = require("./route/userRoutes");
const chatRoutes = require("./route/chatRoutes");
const favoritesRoutes = require("./route/favorites");
const activityRoutes = require("./route/adminDashboardRoutes");
const notificationRoutes = require("./route/notificationRoutes");
const reviewRoutes = require("./route/reviewRoutes");
const contactRoutes = require("./route/contactRoutes");
const paymentRoutes = require("./route/paymentRoutes");

const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");

const app = express();

/* ========================
   TRUST PROXY (important for deployment)
======================== */
app.set("trust proxy", 1);

/* ========================
   SECURITY MIDDLEWARE
======================== */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://js.stripe.com"],
        frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
        connectSrc: ["'self'", process.env.FRONTEND_URL || "http://localhost:5173"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

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
} else {
  app.use(morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  }));
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

app.use(cookieParser());


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
app.use("/api/password", passwordRoutes)
app.use("/api/venues", venueRoutes);
// app.use("/api/admin/user", adminUserRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/bookings", bookingRoutes);
// app.use("/api/admin/venues", adminVenueRoutes);
app.use("/api/chats", chatRoutes);
// app.use("/api/messages", messageRoutes);
// app.use("/api/user/venues", userVenueRoutes);
app.use("/api/user/favorites", favoritesRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", activityRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api", reviewRoutes);
// app.use("/api/testimonials", testimonialRoutes);
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
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.originalUrl}`,
  });
});

/* ========================
   GLOBAL ERROR HANDLER
   Must be last — after all routes and 404 handler
======================== */
app.use(errorHandler);

module.exports = app;

