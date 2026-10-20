// Read-path load test for Venure. One script, four endpoint groups.
//
//   k6 run -e BASE=http://localhost:5053 -e GROUP=browse -e VUS=50 -e DURATION=30s k6/load.js
//   (add -e ENDPOINT=venues_list to hammer a single endpoint; use k6/run.js to automate runs, CPU/RSS sampling and medians)
//
// GROUP: browse (public) | customer | owner | admin
// Every virtual user loops without think time (closed loop), so latency here is "how long a request waits when
// VUS clients are always busy": it is the saturation behaviour of the server, not a user's perceived latency.
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:5053";
const GROUP = __ENV.GROUP || "browse";
const ONLY = __ENV.ENDPOINT || "";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const PASSWORD = __ENV.PASSWORD || "LoadTest#123";
const USERS = Number(__ENV.USERS || 20); // distinct accounts per role the VUs spread over
const OUT = __ENV.OUT || `k6/results/tmp/${GROUP}.json`;

const CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan", "Biratnagar", "Butwal", "Dharan"];
const CATEGORIES = ["banquet-party-palace", "hotel-resort", "heritage-traditional"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---- endpoint tables: [name, (ctx) => path] ----
const iso = (d) => new Date(d).toISOString();
const ENDPOINTS = {
  browse: [
    ["venues_list", () => "/api/venues?page=1&limit=12"],
    ["venues_filter_city_cat", () => `/api/venues?city=${pick(CITIES)}&category=${pick(CATEGORIES)}&limit=12`],
    ["venues_sort_rating_p3", () => "/api/venues?sort=rating&page=3&limit=12"],
    ["venues_search_name", () => "/api/venues?search=garden&limit=12"],
    ["venues_guests_amenities", () => "/api/venues?guests=300&amenities=Wifi,Parking&limit=12"],
    ["venues_featured", () => "/api/venues/featured"],
    ["venues_category_counts", () => "/api/venues/categories/counts"],
    ["venue_detail", (c) => `/api/venues/${pick(c.venues)}`],
    ["venue_spaces", (c) => `/api/venues/${pick(c.venues)}/spaces`],
    ["venue_availability", (c) => `/api/venues/${pick(c.venues)}/availability?from=${iso(Date.now())}&to=${iso(Date.now() + 60 * 86400000)}`],
    ["venue_reviews", (c) => `/api/venue/${pick(c.venues)}`],
    ["reviews_featured", () => "/api/featured"],
    ...(__ENV.LANDING === "1" ? [["landing", () => "/api/landing"]] : []), // only exists once the landing API is deployed
  ],
  customer: [
    ["auth_me", () => "/api/auth/me"],
    ["my_inquiries", () => "/api/inquiries/my"],
    ["my_bookings", () => "/api/bookings/my-bookings"],
    // What the pages ask for now: the first page of the tab that opens first
    ["my_inquiries_page", () => "/api/inquiries/my?page=1&group=all&limit=10"],
    ["my_bookings_page", () => "/api/bookings/my-bookings?page=1&group=upcoming&limit=10"],
    ["my_booking_count", () => "/api/bookings/my-count"],
    ["favorites", () => "/api/user/favorites"],
    ["notifications", () => "/api/notification"],
    ["chats", () => "/api/chats"],
    ["chat_unread_count", () => "/api/chats/unread-count"],
    ["chat_messages", (c, u) => (u.chatId ? `/api/chats/${u.chatId}/messages` : "/api/chats/unread-count")],
  ],
  owner: [
    ["owner_inquiries", () => "/api/inquiries/owner"],
    ["owner_bookings", () => "/api/bookings/owner-bookings"],
    ["owner_inquiries_page", () => "/api/inquiries/owner?page=1&group=pending&limit=15"],
    ["owner_bookings_page", () => "/api/bookings/owner-bookings?page=1&group=upcoming&limit=10"],
    ["owner_earnings", () => "/api/bookings/owner-earnings"],
    ["owner_booking_count", () => "/api/bookings/owner-count"],
    ["owner_venues", () => "/api/venues/owner/me"],
    ["owner_reviews", () => "/api/owner"],
    ["owner_notifications", () => "/api/notification"],
    ["owner_chats", () => "/api/chats"],
  ],
  admin: [
    ["admin_users", () => "/api/user/admin/all?page=1&limit=10"],
    ["admin_venues", () => "/api/venues/admin/all?page=1&limit=10"],
    ["admin_venues_search", () => "/api/venues/admin/all?search=garden&status=approved&limit=10"],
    ["admin_reviews", () => "/api/admin/reviews?page=1&limit=10"],
    ["admin_reviews_search", () => "/api/admin/reviews?search=garden&page=1&limit=10"],
    ["admin_earnings_monthly", () => "/api/admin/earnings/monthly"],
    ["admin_activity", () => "/api/admin/activity-logs"],
    ["admin_total_bookings", () => "/api/bookings/total"],
    ["admin_customer_total", () => "/api/user/admin/customers/total"],
    ["admin_approved_count", () => "/api/venues/admin/approved-count"],
    ["top_venues", () => "/api/bookings/top-venues"],
  ],
};
const ROLE_EMAIL = {
  browse: null,
  customer: (i) => `load-customer-${i}@load.test`,
  owner: (i) => `load-owner-${i}@load.test`,
  admin: () => "load-admin@load.test",
};

const table = ENDPOINTS[GROUP].filter(([name]) => !ONLY || name === ONLY);
const trends = {};
ENDPOINTS[GROUP].forEach(([name]) => { trends[name] = new Trend(`ep_${name}`, true); });
const failures = new Rate("failed_requests");
const rate = {}; // per-endpoint failure counters via tags are enough for the summary: keep a Rate per endpoint too
ENDPOINTS[GROUP].forEach(([name]) => { rate[name] = new Rate(`fail_${name}`); });
const counts = {};
ENDPOINTS[GROUP].forEach(([name]) => { counts[name] = new Counter(`n_${name}`); });

export const options = {
  scenarios: { load: { executor: "constant-vus", vus: VUS, duration: DURATION } },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

const login = (email) => {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), { headers: { "Content-Type": "application/json" } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${res.body}`);
  return res.cookies.accessToken[0].value;
};

export function setup() {
  const ctx = { venues: [], users: [] };
  const list = http.get(`${BASE}/api/venues?limit=50&sort=rating`);
  ctx.venues = (list.json("data") || []).map((v) => v._id);
  const email = ROLE_EMAIL[GROUP];
  if (email) {
    for (let i = 0; i < (GROUP === "admin" ? 1 : USERS); i++) {
      const token = login(email(i));
      const u = { token };
      if (GROUP === "customer") {
        const chats = http.get(`${BASE}/api/chats`, { headers: { Cookie: `accessToken=${token}` } }).json("data") || [];
        u.chatId = chats.length ? chats[0]._id : null;
      }
      ctx.users.push(u);
    }
  }
  return ctx;
}

export default function (ctx) {
  const [name, path] = table[Math.floor(Math.random() * table.length)];
  const user = ctx.users.length ? ctx.users[__VU % ctx.users.length] : {};
  const params = { headers: user.token ? { Cookie: `accessToken=${user.token}` } : {}, tags: { name } };
  const res = http.get(`${BASE}${path(ctx, user)}`, params);
  trends[name].add(res.timings.duration);
  counts[name].add(1);
  const ok = res.status === 200;
  rate[name].add(!ok);
  failures.add(!ok);
  check(res, { "status 200": () => ok });
}

export function handleSummary(data) {
  const m = data.metrics;
  const secs = data.state.testRunDurationMs / 1000;
  const out = {
    group: GROUP, vus: VUS, duration: DURATION, base: BASE, seconds: secs,
    overall: {
      rps: m.http_reqs.values.rate,
      requests: m.http_reqs.values.count,
      error_rate: m.failed_requests ? m.failed_requests.values.rate : 0,
      p50: m.http_req_duration.values.med, p95: m.http_req_duration.values["p(95)"], p99: m.http_req_duration.values["p(99)"],
      avg: m.http_req_duration.values.avg, bytes_per_req: m.data_received.values.count / m.http_reqs.values.count,
    },
    endpoints: {},
  };
  ENDPOINTS[GROUP].forEach(([name]) => {
    const t = m[`ep_${name}`];
    const n = m[`n_${name}`] ? m[`n_${name}`].values.count : 0;
    if (!t || !n) return;
    out.endpoints[name] = {
      count: n, rps: n / secs, p50: t.values.med, p90: t.values["p(90)"], p95: t.values["p(95)"], p99: t.values["p(99)"],
      avg: t.values.avg, max: t.values.max, error_rate: m[`fail_${name}`] ? m[`fail_${name}`].values.rate : 0,
    };
  });
  return { [OUT]: JSON.stringify(out, null, 2), stdout: `${GROUP}: ${out.overall.rps.toFixed(1)} req/s p50=${out.overall.p50.toFixed(1)}ms p95=${out.overall.p95.toFixed(1)}ms err=${(out.overall.error_rate * 100).toFixed(2)}%\n` };
}
