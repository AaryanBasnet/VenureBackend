/**
 * Detects require() paths whose casing doesn't match the actual file on disk.
 * Run with: node scripts/check-case.js
 * Windows is case-insensitive so these bugs only surface on Linux (Render/prod).
 */
const fs = require("fs");
const path = require("path");

const SCAN_DIRS = ["services", "controller", "middleware", "route", "socket"];
const ROOT = path.resolve(__dirname, "..");
const REQUIRE_RE = /require\(["'](\.[^"']+)["']\)/g;

let errors = 0;

for (const dir of SCAN_DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;

  for (const file of fs.readdirSync(dirPath)) {
    if (!file.endsWith(".js")) continue;
    const filePath = path.join(dirPath, file);
    const src = fs.readFileSync(filePath, "utf8");

    let m;
    REQUIRE_RE.lastIndex = 0;
    while ((m = REQUIRE_RE.exec(src)) !== null) {
      const rel = m[1];
      const resolved = path.resolve(path.dirname(filePath), rel);
      const candidates = [resolved, resolved + ".js", resolved + "/index.js"];

      for (const candidate of candidates) {
        const parent = path.dirname(candidate);
        const base = path.basename(candidate);
        if (!fs.existsSync(parent)) continue;

        const actual = fs.readdirSync(parent).find(
          (f) => f.toLowerCase() === base.toLowerCase()
        );
        if (actual && actual !== base) {
          console.error(
            `CASE MISMATCH in ${dir}/${file}:\n  required: ${rel}\n  on disk:  ${actual}\n`
          );
          errors++;
        }
      }
    }
  }
}

if (errors === 0) {
  console.log("✓ No case mismatches found.");
} else {
  console.error(`\n${errors} mismatch(es) found — fix before pushing to Linux.`);
  process.exit(1);
}
