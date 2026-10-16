// Write-path race scenarios. Run with k6/run-race.js (it prepares data, stubs eSewa, runs this, then checks the database).
//
//   SCENARIO=book      N customers verify their eSewa payment for the SAME slot at the same instant
//   SCENARIO=replay    ONE customer's callback is replayed R times in parallel (double click / refresh / retry storm)
//   SCENARIO=favorites ONE user toggles the same venue from N parallel requests
//   SCENARIO=register  N parallel sign-ups with the same email
//   SCENARIO=review    (reserved) see test/raceConditions.test.js
//
// Each virtual user fires once, all together (shared start via per-vu-iterations); the verdicts are checked by
// k6/verify-race.js against the database, not by k6, because the invariant is about stored rows.
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:5053";
const SCENARIO = __ENV.SCENARIO || "book";
const N = Number(__ENV.N || 50);
const PASSWORD = "LoadTest#123";
const fixtureFile = JSON.parse(open("./results/race-fixture.json"));
const JSON_HEADERS = { "Content-Type": "application/json" };

// Metrics must be created in the init context, so every status we may see is declared up front
const status = {};
[200, 201, 400, 401, 403, 404, 409, 429, 500, 502, 503, 0].forEach((c) => (status[c] = new Counter(`status_${c}`)));
const counter = (code) => status[code] || status[0];

export const options = {
  scenarios: { race: { executor: "per-vu-iterations", vus: N, iterations: 1, maxDuration: "60s" } },
  summaryTrendStats: ["med", "p(95)", "max"],
};

const login = (email) => {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), { headers: JSON_HEADERS });
  return r.cookies.accessToken[0].value;
};

export function setup() {
  if (SCENARIO === "book") return { tokens: fixtureFile.fixture.slice(0, N).map((f) => login(f.email)) };
  if (SCENARIO === "replay") return { token: login(fixtureFile.fixture[0].email) };
  if (SCENARIO === "favorites") return { token: login("load-customer-300@load.test"), venue: fixtureFile.venue };
  return {};
}

export default function (ctx) {
  const vu = __VU - 1;
  // Each VU pretends to be a different client IP so per-IP rate limiters do not interfere with the race itself
  const ip = { "X-Forwarded-For": `10.20.${Math.floor(vu / 250)}.${(vu % 250) + 1}` };
  let res;
  if (SCENARIO === "book") {
    res = http.post(`${BASE}/api/payment/esewa/verify`, JSON.stringify({ data: fixtureFile.fixture[vu].data }), {
      headers: { ...JSON_HEADERS, ...ip, Cookie: `accessToken=${ctx.tokens[vu]}` },
    });
  } else if (SCENARIO === "replay") {
    res = http.post(`${BASE}/api/payment/esewa/verify`, JSON.stringify({ data: fixtureFile.fixture[0].data }), {
      headers: { ...JSON_HEADERS, ...ip, Cookie: `accessToken=${ctx.token}` },
    });
  } else if (SCENARIO === "favorites") {
    res = http.post(`${BASE}/api/user/favorites/${ctx.venue}`, null, { headers: { ...ip, Cookie: `accessToken=${ctx.token}` } });
  } else if (SCENARIO === "register") {
    res = http.post(`${BASE}/api/auth/register`, JSON.stringify({ name: "Race", email: __ENV.EMAIL || "race-dup@load.test", phone: "9812345678", password: "Test@1234" }), { headers: { ...JSON_HEADERS, ...ip } });
  }
  counter(res.status).add(1);
}

export function handleSummary(data) {
  const codes = {};
  Object.keys(data.metrics).filter((k) => k.startsWith("status_")).forEach((k) => (codes[k.slice(7)] = data.metrics[k].values.count));
  const out = { scenario: SCENARIO, vus: N, statusCodes: codes };
  return { [__ENV.OUT || `k6/results/race-${SCENARIO}.json`]: JSON.stringify(out, null, 2), stdout: `${SCENARIO}: ${JSON.stringify(codes)}\n` };
}
