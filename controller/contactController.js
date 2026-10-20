const { isDemoAdmin } = require("../services/demoScope");
const asyncHandler = require("../utils/asyncHandler");
const contactService = require("../services/contactService");

exports.submitContactForm = asyncHandler(async (req, res) => {
  // req.body is securely validated by Zod at this point
  await contactService.submitContact(req.body);

  res.status(201).json({ 
    success: true, 
    message: "Thank you! Your message has been received." 
  });
});

exports.getAllContactSubmissions = asyncHandler(async (req, res) => {
  const contacts = await contactService.getAllContacts(isDemoAdmin(req.user));

  res.status(200).json({ 
    success: true, 
    data: contacts 
  });
});