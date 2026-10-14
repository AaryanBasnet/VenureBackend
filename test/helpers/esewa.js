// Plays the part of eSewa in tests: signs the redirect the customer's browser would carry back
// and answers the server-side status check.
const esewa = require("../../utils/esewa");

// formData is what paymentService.initiateDeposit returned for the browser to post.
const callbackFor = (formData, { status = "COMPLETE", totalAmount = formData.total_amount } = {}) => {
  const { secretKey } = esewa.getConfig();
  const body = {
    transaction_code: `TC${formData.transaction_uuid.slice(-6)}`,
    status,
    total_amount: String(totalAmount),
    transaction_uuid: formData.transaction_uuid,
    product_code: formData.product_code,
    signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names",
  };
  body.signature = esewa.sign(body, body.signed_field_names, secretKey);
  return Buffer.from(JSON.stringify(body)).toString("base64");
};

// eSewa's own status API: every payment is reported with the given status.
const mockStatusApi = (status = "COMPLETE") => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ status, ref_id: "REF123" }) }));
};

module.exports = { callbackFor, mockStatusApi };
