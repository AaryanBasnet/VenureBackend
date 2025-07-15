// controller/contactController.js
const Contact = require("../model/contact");

const submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ success: false, message: "Name and message are required" });
    }

    const contact = new Contact({ name, email, phone, message });
    await contact.save();

    res.status(201).json({ success: true, message: "Contact form submitted successfully" });
  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const getAllContactSubmissions = async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 }); // latest first
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    console.error("Failed to fetch contact submissions:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

module.exports = { submitContactForm, getAllContactSubmissions};
