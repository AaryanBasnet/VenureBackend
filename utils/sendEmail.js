const nodemailer = require("nodemailer");
const logger = require("./logger");

const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
      // A mail server that does not answer must not hold a request open for minutes
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const info = await transporter.sendMail({
      from: `"Venure Support" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });

    logger.info({ message: "Email sent", messageId: info.messageId, to });
  } catch (error) {
    logger.error({ message: "Email sending failed", error: error.message, to });
    throw error; // rethrow if you want upstream error handling
  }
};

module.exports = sendEmail;
