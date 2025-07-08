const mongoose = require("mongoose");

const CONNECTION_STRING = process.env.DB_URL;

const connectDB = async() => {
    try {
        await mongoose.connect(CONNECTION_STRING);
        console.log("MongoDb Connected")


    } catch (err) {
        console.log("DB error", err);

    }
}

module.exports = connectDB;