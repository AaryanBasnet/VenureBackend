require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./database/db");
const authRoutes = require("./route/authRoutes");
const venueRoutes = require("./route/venueOwnerRoutes/venueRoutes");
const adminUserRoutes = require("./route/admin/adminUserRoute");
const bookingRoutes = require("./route/bookingRoutes");
const adminVenueRoutes = require("./route/admin/venueApprovalRoutes");
const userVenueRoutes = require("./route/user/userVenueRoute");
const http = require("http");
const setupSocket = require("./socket/socket");
const chatRoutes = require("./route/chatRoutes");
const messageRoutes = require("./route/messageRoutes");
const favoritesRoutes = require("./route/user/favorites");
const path = require("path");
const app = express();
const PORT = process.env.PORT;

const corsOption = {
  origin: true,
  credential: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOption));

app.use(express.json());

connectDB();
const server = http.createServer(app);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/venueOwner/venues", venueRoutes);
app.use("/api/admin/user", adminUserRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin/venues", adminVenueRoutes);

app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);

app.use("/api/user/venues", userVenueRoutes);

app.use("/api/user/favorites", favoritesRoutes);
const startServer = async () => {
  try {
    await connectDB();
    setupSocket(server); // ✅ initialize socket.io with http server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.log("Server startup error:", err);
  }
};

startServer();
