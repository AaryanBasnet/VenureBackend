// A stand-in for eSewa's "transaction status" API so the payment-verification race can be driven over real HTTP.
//   node k6/esewa-stub.js 5099
// Start the load backend with ESEWA_STATUS_URL=http://127.0.0.1:5099/ . It answers COMPLETE for every payment
// and echoes the transaction_uuid / total_amount it was asked about (like the real API does), after a small
// delay so concurrent verifications really overlap.
const http = require("http");
const port = Number(process.argv[2] || 5099);
const delayMs = Number(process.env.STUB_DELAY_MS || 25);

http
  .createServer((req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        product_code: q.get("product_code"), transaction_uuid: q.get("transaction_uuid"), total_amount: Number(q.get("total_amount")),
        status: "COMPLETE", ref_id: `STUB-${q.get("transaction_uuid")}`,
      }));
    }, delayMs);
  })
  .listen(port, "127.0.0.1", () => console.log(`eSewa status stub on ${port}`));
