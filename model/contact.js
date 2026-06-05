const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: String,
    phone: String,
    message: {
      type: String,
      required: true,
      maxlength: 2000, // DB-level fallback protection
    },
  },
  { timestamps: true }
);

// Enterprise Optimization: Index for fast Admin sorting
contactSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Contact || mongoose.model("Contact", contactSchema);