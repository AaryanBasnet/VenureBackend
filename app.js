require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

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

const app = express();

// after you create your app

if (process.env.NODE_ENV === "test") {
  const testRoutes = require("./route/testRoutes");
  app.use("/test", testRoutes);
}

const corsOptions = {
  origin: true,
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
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

module.exports = app;
