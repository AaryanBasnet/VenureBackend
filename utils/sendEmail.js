const nodemailer = require("nodemailer");
const logger = require("./logger");

// Two ways to send, chosen by the environment:
//   BREVO_API_KEY set  -> Brevo's HTTPS API (port 443). Use this on Render: its free plan blocks the SMTP ports
//                         (25, 465, 587) that Gmail needs, so Gmail cannot work there.
//   otherwise          -> Gmail over SMTP with GMAIL_USER / GMAIL_PASS (fine on a laptop or a paid host).
// The sender address is MAIL_FROM_EMAIL (for Brevo it must be a sender you verified in Brevo), falling back to GMAIL_USER.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 10000; // a mail service that does not answer must not hold a request open for minutes

const fromEmail = () => process.env.MAIL_FROM_EMAIL || process.env.GMAIL_USER;
const fromName = () => process.env.MAIL_FROM_NAME || "Venure Support";

const sendViaBrevo = async ({ to, subject, html }) => {
  const sender = fromEmail();
  if (!sender) throw new Error("No sender address: set MAIL_FROM_EMAIL to a sender verified in Brevo");

  const response = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: fromName(), email: sender }, to: [{ email: to }], subject, htmlContent: html }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Brevo explains itself in a JSON body ({ code, message }); the key is never part of it
    const detail = await response.json().then((b) => b?.message, () => undefined);
    throw new Error(`Brevo refused the email (HTTP ${response.status}${detail ? `: ${detail}` : ""})`);
  }
  const body = await response.json().catch(() => ({}));
  return body.messageId;
};

const sendViaGmail = async ({ to, subject, html }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 15000,
  });
  const info = await transporter.sendMail({ from: `"${fromName()}" <${fromEmail()}>`, to, subject, html });
  return info.messageId;
};

const sendEmail = async ({ to, subject, html }) => {
  const provider = process.env.BREVO_API_KEY ? "brevo" : "gmail";
  try {
    const messageId = await (provider === "brevo" ? sendViaBrevo : sendViaGmail)({ to, subject, html });
    logger.info({ message: "Email sent", provider, messageId, to });
  } catch (error) {
    // A timeout from fetch is a DOMException, not an Error with a useful message of its own
    const reason = error.name === "TimeoutError" ? `no answer from ${provider} within ${TIMEOUT_MS / 1000}s` : error.message;
    logger.error({ message: "Email sending failed", provider, error: reason, to });
    throw error; // callers decide whether a failed email matters (an application does not fail because of it)
  }
};

module.exports = sendEmail;
