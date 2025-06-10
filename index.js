require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./database/db");
const authRoutes = require("./route/authRoutes");

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

app.listen(PORT, () => {
  console.log(`server runnning on port ${PORT}`);
});
