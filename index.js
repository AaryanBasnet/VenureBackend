require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./database/db");
const authRoutes = require("./route/authRoutes");
const venueRoutes = require("./route/venueOwnerRoutes/venueRoutes");
const adminUserRoutes = require("./route/admin/adminUserRoute");
const bookingRoutes = require("./route/bookingRoutes");

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

app.use("/api/auth", authRoutes);
app.use("/api/venueOwner/venues", venueRoutes);
app.use("/api/admin/user", adminUserRoutes);
app.use("/api/bookings", bookingRoutes);

app.listen(PORT, () => {
  console.log(`server runnning on port ${PORT}`);
});
