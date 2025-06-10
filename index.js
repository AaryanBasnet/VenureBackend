require("dotenv").config();
const express = require("express");
const connectDB = require("./database/db");

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

connectDB();

app.listen(PORT, () => {
  console.log(`server runnning on port ${PORT}`);
});
