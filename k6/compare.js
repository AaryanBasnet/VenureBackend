// Prints a before/after markdown table from two result labels.
//   node k6/compare.js before after [--md k6/results/compare-before-after.md]
const fs = require("fs");
const path = require("path");

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const mdIdx = process.argv.indexOf("--md");
const read = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, "results", l, "summary.json"), "utf8")).results;
const A = read(a);
const B = read(b);

const f = (n) => (Number.isFinite(n) ? (n >= 100 ? n.toFixed(0) : n.toFixed(1)) : "n/a");
const pct = (x, y) => (Number.isFinite(x) && Number.isFinite(y) && x ? `${(((y - x) / x) * 100).toFixed(0)}%` : "n/a");
const lines = [
  `| endpoint | ${a} req/s | ${b} req/s | ${a} p50 | ${b} p50 | p50 change | ${a} p95 | ${b} p95 | ${a} p99 | ${b} p99 |`,
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const key of Object.keys(A)) {
  if (!key.includes("/") || !B[key]) continue;
  const [group, endpoint] = key.split("/");
  const x = A[key].endpoints[endpoint];
  const y = B[key].endpoints[endpoint];
  if (!x || !y) continue;
  lines.push(`| ${group} / ${endpoint} | ${f(x.rps)} | ${f(y.rps)} | ${f(x.p50)} | ${f(y.p50)} | ${pct(x.p50, y.p50)} | ${f(x.p95)} | ${f(y.p95)} | ${f(x.p99)} | ${f(y.p99)} |`);
}
const out = lines.join("\n");
console.log(out);
if (mdIdx > -1) fs.writeFileSync(process.argv[mdIdx + 1], out + "\n");
