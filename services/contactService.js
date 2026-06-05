const Contact = require("../model/contact");

const submitContact = async (payload) => {
  const contact = await Contact.create(payload);
  
  // Future Enterprise Feature: 
  // can trigger an email to the Admin here using Nodemailer or SendGrid:
  // await emailService.sendAdminNotification(`New contact from ${payload.name}`);

  return contact;
};

const getAllContacts = async () => {
  return await Contact.find().sort("-createdAt"); 
};

module.exports = {
  submitContact,
  getAllContacts,
};