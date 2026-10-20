// utils/sendEmail.js: Brevo over HTTPS when BREVO_API_KEY is set, Gmail over SMTP otherwise. No network is used.
jest.mock("nodemailer", () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: "gmail-1" });
  return { createTransport: jest.fn(() => ({ sendMail })), __sendMail: sendMail };
});

const nodemailer = require("nodemailer");
const sendEmail = require("../utils/sendEmail");

const message = { to: "owner@example.com", subject: "Your venue is approved", html: "<p>Hello</p>" };
const ENV_KEYS = ["BREVO_API_KEY", "MAIL_FROM_EMAIL", "MAIL_FROM_NAME", "GMAIL_USER", "GMAIL_PASS"];
let saved;
let fetchMock;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<brevo-1>" }) });
  nodemailer.__sendMail.mockClear();
  nodemailer.createTransport.mockClear();
});
afterEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  fetchMock.mockRestore();
});

describe("with a Brevo key", () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = "xkeysib-test-key";
    process.env.MAIL_FROM_EMAIL = "no-reply@venure.test";
  });

  it("posts the message to Brevo's API over HTTPS with the key in a header, and never touches SMTP", async () => {
    await sendEmail(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options.method).toBe("POST");
    expect(options.headers["api-key"]).toBe("xkeysib-test-key");
    expect(JSON.parse(options.body)).toEqual({
      sender: { name: "Venure Support", email: "no-reply@venure.test" },
      to: [{ email: "owner@example.com" }],
      subject: "Your venue is approved",
      htmlContent: "<p>Hello</p>",
    });
    expect(options.body).not.toContain("xkeysib"); // the key travels in the header only
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it("uses the sender name from MAIL_FROM_NAME, and falls back to GMAIL_USER for the address", async () => {
    process.env.MAIL_FROM_NAME = "Venure Team";
    delete process.env.MAIL_FROM_EMAIL;
    process.env.GMAIL_USER = "hello@venure.test";
    await sendEmail(message);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender).toEqual({ name: "Venure Team", email: "hello@venure.test" });
  });

  it("throws, saying why, when Brevo refuses (for example a sender that is not verified)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: "invalid_parameter", message: "Sender is not valid" }) });
    await expect(sendEmail(message)).rejects.toThrow("Brevo refused the email (HTTP 400: Sender is not valid)");
  });

  it("throws on a bad key (401) even when the error body is not JSON, and never repeats the key", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => { throw new Error("not json"); } });
    const error = await sendEmail(message).catch((e) => e);
    expect(error.message).toBe("Brevo refused the email (HTTP 401)");
    expect(error.message).not.toContain("xkeysib");
  });

  it("throws when the network fails or Brevo does not answer in time", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(sendEmail(message)).rejects.toThrow("fetch failed");
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    await expect(sendEmail(message)).rejects.toThrow(/timeout/);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); // a timeout is always set
  });

  it("refuses to send without a sender address", async () => {
    delete process.env.MAIL_FROM_EMAIL;
    await expect(sendEmail(message)).rejects.toThrow(/No sender address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("without a Brevo key", () => {
  it("sends through Gmail as before, and never calls Brevo", async () => {
    process.env.GMAIL_USER = "venure@gmail.test";
    process.env.GMAIL_PASS = "app-password";
    await sendEmail(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ service: "gmail", auth: { user: "venure@gmail.test", pass: "app-password" }, connectionTimeout: 10000 }));
    expect(nodemailer.__sendMail).toHaveBeenCalledWith({ from: '"Venure Support" <venure@gmail.test>', to: "owner@example.com", subject: "Your venue is approved", html: "<p>Hello</p>" });
  });

  it("still rejects when Gmail does", async () => {
    process.env.GMAIL_USER = "venure@gmail.test";
    nodemailer.__sendMail.mockRejectedValueOnce(new Error("Connection timeout"));
    await expect(sendEmail(message)).rejects.toThrow("Connection timeout");
  });
});
