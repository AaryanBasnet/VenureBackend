const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const loggerPath = path.join(__dirname, "..", "utils", "logger.js");

// A start-up check in a fresh process: the logger must never crash the server, even where ./logs cannot be created.
const run = (cwd, env = {}) =>
  spawnSync(process.execPath, ["-e", `const l = require(${JSON.stringify(loggerPath)}); l.info("hello"); console.log("LOGGER_OK " + l.transports.length)`], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

describe("logger start-up", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "venure-logger-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("production logs to the console only and does not create a logs folder", () => {
    const r = run(dir, { NODE_ENV: "production" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LOGGER_OK 1");
    expect(fs.existsSync(path.join(dir, "logs"))).toBe(false);
  });

  it("production with an unusable ./logs (a file in its place) still starts, even when files are requested", () => {
    fs.writeFileSync(path.join(dir, "logs"), "not a folder");
    const r = run(dir, { NODE_ENV: "production", LOG_TO_FILES: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LOGGER_OK 1");
    expect(r.stderr + r.stdout).toMatch(/Log files disabled/);
  });

  it("development writes log files", () => {
    const r = run(dir, { NODE_ENV: "development" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LOGGER_OK 3");
    expect(fs.existsSync(path.join(dir, "logs"))).toBe(true);
  });

  it("production writes files when LOG_TO_FILES=1 and the folder is writable", () => {
    const r = run(dir, { NODE_ENV: "production", LOG_TO_FILES: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LOGGER_OK 3");
  });
});
