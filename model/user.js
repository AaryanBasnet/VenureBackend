const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
      name: {
        type: String,
        required: true,
        trim: true// removes white space
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ["Customer", "VenueOwner", "Admin"],
        default: "Customer"
    },
    phone: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});


const User= mongoose.model("User", userSchema);
module.exports = User;