require("dotenv").config();
const express = require("express");
const connectDB = require("./database/db");
const authRoutes = require("./route/authRoutes")

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

connectDB();

app.use("/api/auth", authRoutes)

app.listen(PORT, () => {
  console.log(`server runnning on port ${PORT}`);
});
