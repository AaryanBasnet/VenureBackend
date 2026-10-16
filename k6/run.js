// Runs k6/load.js N times for one or more groups against a running backend, sampling the node process's
// CPU and memory once a second, and writes per-run raw JSON plus a median summary + markdown table.
//
//   node k6/run.js --label before --groups browse,customer,owner,admin --port 5053 --runs 3 --vus 50 --duration 30s [--solo]
//
// --solo additionally runs every endpoint on its own (so per-endpoint numbers are not diluted by the mix).
// Output: k6/results/<label>/<group>[-<endpoint>]/run<N>.json, <label>/summary.json, <label>/summary.md
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const label = arg("label", "run");
const groups = arg("groups", "browse,customer,owner,admin").split(",");
const port = arg("port", "5053");
const runs = Number(arg("runs", 3));
const vus = arg("vus", "50");
const duration = arg("duration", "30s");
const solo = flag("solo");
const onlyEndpoints = arg("endpoints", "") ? arg("endpoints").split(",") : null;
const root = path.join(__dirname, "..");
const outRoot = path.join(__dirname, "results", label);

const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const serverPid = () => Number(ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess`));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Sample "cpu seconds, working set MB" of the server process every second while k6 runs (async via a PowerShell loop)
const startSampler = (pid, file, seconds) => {
  const script = `$end=(Get-Date).AddSeconds(${seconds}); while((Get-Date) -lt $end){ $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){ '{0},{1},{2}' -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds(),$p.TotalProcessorTime.TotalSeconds,($p.WorkingSet64/1MB) | Add-Content -Path '${file}' }; Start-Sleep -Milliseconds 1000 }`;
  const { spawn } = require("child_process");
  return spawn("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
};
const readSamples = (file) => {
  if (!fs.existsSync(file)) return { cpu_pct_of_core: null, rss_mb_peak: null };
  const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map((l) => l.split(",").map(Number)).filter((r) => r.length === 3 && r.every(Number.isFinite));
  if (rows.length < 2) return { cpu_pct_of_core: null, rss_mb_peak: null };
  const dt = (rows[rows.length - 1][0] - rows[0][0]) / 1000;
  return { cpu_pct_of_core: ((rows[rows.length - 1][1] - rows[0][1]) / dt) * 100, rss_mb_peak: Math.max(...rows.map((r) => r[2])) };
};

const runK6 = (group, endpoint, run) => {
  const dir = path.join(outRoot, endpoint ? `${group}-${endpoint}` : group);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `run${run}.json`);
  const samples = path.join(dir, `run${run}.samples.csv`);
  if (fs.existsSync(samples)) fs.unlinkSync(samples);
  if (flag("resume") && fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, "utf8")); // reuse a finished run
  const pid = serverPid();
  const sampler = startSampler(pid, samples, parseInt(duration) + 20);
  const args = ["run", "--quiet", "-e", `BASE=http://localhost:${port}`, "-e", `GROUP=${group}`, "-e", `VUS=${vus}`, "-e", `DURATION=${duration}`, "-e", `OUT=${out.split(path.sep).join("/")}`];
  if (endpoint) args.push("-e", `ENDPOINT=${endpoint}`);
  args.push(path.join(__dirname, "load.js"));
  const r = spawnSync("k6", args, { cwd: root, encoding: "utf8" });
  sampler.kill();
  if (!fs.existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error(`k6 produced no summary for ${group}/${endpoint}`); }
  const res = JSON.parse(fs.readFileSync(out, "utf8"));
  res.process = readSamples(samples);
  fs.writeFileSync(out, JSON.stringify(res, null, 2));
  return res;
};

const summary = {};
const table = [`| scope | endpoint | req/s | p50 ms | p95 ms | p99 ms | errors |`, `|---|---|---:|---:|---:|---:|---:|`];
const f = (n) => (n === null || n === undefined ? "n/a" : n.toFixed(1));

const doRuns = (group, endpoint) => {
  const all = [];
  for (let i = 1; i <= runs; i++) { all.push(runK6(group, endpoint, i)); process.stdout.write(`${label} ${group}${endpoint ? "/" + endpoint : ""} run ${i}: ${all[all.length - 1].overall.rps.toFixed(0)} rps p50 ${all[all.length - 1].overall.p50.toFixed(1)}\n`); }
  const key = endpoint ? `${group}/${endpoint}` : group;
  const med = (fn) => median(all.map(fn));
  const entry = {
    runs, vus, duration,
    overall: { rps: med((r) => r.overall.rps), p50: med((r) => r.overall.p50), p95: med((r) => r.overall.p95), p99: med((r) => r.overall.p99), error_rate: med((r) => r.overall.error_rate), bytes_per_req: med((r) => r.overall.bytes_per_req) },
    rps_runs: all.map((r) => r.overall.rps), p50_runs: all.map((r) => r.overall.p50),
    process: { cpu_pct_of_core: all[0].process.cpu_pct_of_core === null ? null : med((r) => r.process.cpu_pct_of_core), rss_mb_peak: all[0].process.rss_mb_peak === null ? null : med((r) => r.process.rss_mb_peak) },
    endpoints: {},
  };
  for (const name of Object.keys(all[0].endpoints)) {
    const ep = (fn) => median(all.map((r) => (r.endpoints[name] ? fn(r.endpoints[name]) : NaN)).filter(Number.isFinite));
    entry.endpoints[name] = { rps: ep((e) => e.rps), p50: ep((e) => e.p50), p95: ep((e) => e.p95), p99: ep((e) => e.p99), error_rate: ep((e) => e.error_rate) };
  }
  summary[key] = entry;
  // Persist after every endpoint so a crash never loses finished work
  fs.mkdirSync(outRoot, { recursive: true });
  const file = path.join(outRoot, "summary.json");
  const prevResults = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).results || {} : {};
  fs.writeFileSync(file, JSON.stringify({ label, port, vus, duration, runs, results: { ...prevResults, ...summary } }, null, 2));
  const scope = endpoint ? "solo" : "mixed";
  for (const [name, e] of Object.entries(entry.endpoints)) table.push(`| ${scope} ${group} | ${name} | ${f(e.rps)} | ${f(e.p50)} | ${f(e.p95)} | ${f(e.p99)} | ${(e.error_rate * 100).toFixed(1)}% |`);
};

const src = fs.readFileSync(path.join(__dirname, "load.js"), "utf8");
const names = {};
for (const g of ["browse", "customer", "owner", "admin"]) {
  const i = src.indexOf("  " + g + ": [");
  const j = src.indexOf("\n  ],", i);
  names[g] = [...src.slice(i, j).matchAll(/\["([a-z0-9_]+)",/g)].map((m) => m[1]).filter((n) => n !== "landing" || process.env.LANDING === "1");
}

for (const g of groups) {
  if (!solo) doRuns(g, null);
  else for (const ep of names[g]) if (!onlyEndpoints || onlyEndpoints.includes(ep)) doRuns(g, ep);
}
fs.mkdirSync(outRoot, { recursive: true });
const prev = fs.existsSync(path.join(outRoot, "summary.json")) ? JSON.parse(fs.readFileSync(path.join(outRoot, "summary.json"), "utf8")).results || {} : {};
const merged = { ...prev, ...summary };
fs.writeFileSync(path.join(outRoot, "summary.json"), JSON.stringify({ label, port, vus, duration, runs, results: merged }, null, 2));
fs.writeFileSync(path.join(outRoot, `summary-${groups.join("+")}${solo ? "-solo" : ""}.md`), table.join("\n") + "\n");
console.log(table.join("\n"));
