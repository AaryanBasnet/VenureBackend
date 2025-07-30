const mongoose = require('mongoose');

const CONNECTION_STRING = process.env.DB_URL;

const connectDB = async () => {
  try {
    await mongoose.connect(CONNECTION_STRING);
    console.log(`MongoDB Connected to ${CONNECTION_STRING}`);
  } catch (err) {
    console.error('DB error:', err);
    process.exit(1);
  }
};

module.exports = connectDB;
