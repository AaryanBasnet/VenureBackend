/* eslint-disable no-console */
// Runs the write-path race scenarios against the load backend and checks the invariants in the database.
//
//   # backend must point at the LOAD database and at the eSewa stub:
//   ESEWA_STATUS_URL=http://127.0.0.1:5099/ DISABLE_RATE_LIMITS=1 DB_URL=mongodb://127.0.0.1:27017/venure-load PORT=5053 \
//     FRONTEND_URL=http://localhost:5175 node server.js
//   DB_URL=mongodb://127.0.0.1:27017/venure-load node k6/run-race.js --label before --port 5053 [--n 50]
//
// Output: k6/results/<label>/race.json (verdict per scenario) and a markdown table on stdout.
if (!process.env.LOAD_PASSWORD) {
  console.error("Set LOAD_PASSWORD to the password the load database was seeded with (see docs/PERFORMANCE.md).");
  process.exit(1);
}

const { spawn, spawnSync } = require("child_process");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const label = arg("label", "race");
const port = arg("port", "5053");
const N = Number(arg("n", 50));
const uri = process.env.DB_URL || "";
if (!/(127\.0\.0\.1|localhost)/.test(uri) || !(uri.split("/").pop() || "").toLowerCase().includes("load")) {
  console.error("Refusing to run: DB_URL must be a local database whose name contains 'load'.");
  process.exit(1);
}
const root = path.join(__dirname, "..");
const outDir = path.join(__dirname, "results", label);
fs.mkdirSync(outDir, { recursive: true });

const k6 = (scenario, env = {}) => {
  const out = path.join(outDir, `race-${scenario}.json`).split(path.sep).join("/");
  const args = ["run", "--quiet", "-e", `PASSWORD=${process.env.LOAD_PASSWORD}`, "-e", `BASE=http://localhost:${port}`, "-e", `SCENARIO=${scenario}`, "-e", `N=${env.N || N}`, "-e", `OUT=${out}`];
  Object.entries(env).forEach(([k, v]) => args.push("-e", `${k}=${v}`));
  args.push(path.join(__dirname, "race.js"));
  const r = spawnSync("k6", args, { cwd: root, encoding: "utf8" });
  if (!fs.existsSync(out)) throw new Error(`k6 failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(fs.readFileSync(out, "utf8")).statusCodes;
};
const prep = (n) => {
  const r = spawnSync("node", [path.join(__dirname, "prep-race.js"), String(n)], { cwd: root, encoding: "utf8", env: process.env });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(path.join(__dirname, "results", "race-fixture.json"), "utf8"));
};

(async () => {
  const stub = spawn("node", [path.join(__dirname, "esewa-stub.js"), "5099"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const ACTIVE = ["pending_deposit", "confirmed", "completed"];
  const results = [];
  const record = (name, ok, detail) => { results.push({ scenario: name, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`); };

  try {
    // 1. N customers pay for the same slot at the same instant
    let fx = prep(N);
    let codes = k6("book");
    const live = await db.collection("bookings").countDocuments({ space: new mongoose.Types.ObjectId(fx.space), startTime: new Date(fx.startTime), status: { $in: ACTIVE } });
    const stuck = await db.collection("bookings").countDocuments({ space: new mongoose.Types.ObjectId(fx.space), startTime: new Date(fx.startTime), status: "pending_deposit" });
    const refunds = await db.collection("paymentattempts").countDocuments({ quotation: { $in: (await db.collection("quotations").find({ space: new mongoose.Types.ObjectId(fx.space), startTime: new Date(fx.startTime) }).toArray()).map((q) => q._id) }, status: "refund_due" });
    record(`${N} customers book one slot`, live <= 1, { liveBookings: live, stuckHolds: stuck, refundsDue: refunds, httpStatus: codes });

    // 2. one customer's payment callback replayed in parallel
    fx = prep(N);
    codes = k6("replay", { N: 20 });
    const q0 = new mongoose.Types.ObjectId(fx.fixture[0].quotationId);
    const b = await db.collection("bookings").countDocuments({ quotation: q0, status: { $in: ACTIVE } });
    const pays = await db.collection("payments").countDocuments({ booking: { $in: (await db.collection("bookings").find({ quotation: q0 }).toArray()).map((x) => x._id) } });
    record("one payment callback replayed 20x in parallel", b === 1 && pays <= 1, { bookings: b, paymentRows: pays, httpStatus: codes });

    // 3. one user toggles one venue from N parallel requests
    const email = "load-customer-300@load.test";
    await db.collection("users").updateOne({ email }, { $set: { favorites: [] } });
    const venue = new mongoose.Types.ObjectId(JSON.parse(fs.readFileSync(path.join(__dirname, "results", "race-fixture.json"), "utf8")).venue);
    codes = k6("favorites", { N: 51 });
    const user = await db.collection("users").findOne({ email });
    const copies = user.favorites.filter((f) => String(f) === String(venue)).length;
    record("51 parallel favorite toggles of one venue", copies === 1, { copiesStored: copies, favorites: user.favorites.length, httpStatus: codes });

    // 4. duplicate registration
    const dupEmail = `race-dup-${Date.now()}@load.test`;
    codes = k6("register", { N: 30, EMAIL: dupEmail });
    const accounts = await db.collection("users").countDocuments({ email: dupEmail });
    record("30 parallel sign-ups with one email", accounts === 1, { accounts, httpStatus: codes });
  } finally {
    stub.kill();
    await mongoose.disconnect();
  }
  fs.writeFileSync(path.join(outDir, "race.json"), JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
