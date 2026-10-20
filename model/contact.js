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
    // Demo data (see services/demoScope.js): a demo admin only sees records with this flag
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Enterprise Optimization: Index for fast Admin sorting
contactSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Contact || mongoose.model("Contact", contactSchema);