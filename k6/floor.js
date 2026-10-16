// The server's per-request floor: GET /api/health touches no database. Anything slower than this is real work.
//   MSYS_NO_PATHCONV=1 k6 run -e BASE=http://localhost:5053 -e P=/api/health k6/floor.js
import http from "k6/http";
export const options = { vus: Number(__ENV.VUS || 50), duration: __ENV.DURATION || "10s" };
export default function () { http.get(`${__ENV.BASE || "http://localhost:5053"}${__ENV.P || "/api/health"}`); }
