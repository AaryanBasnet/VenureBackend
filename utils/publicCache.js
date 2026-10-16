// In-memory TTL cache for hot PUBLIC reads (venue list, featured, category counts, venue page).
//
// - Stores the already-serialised JSON, its weak ETag and a pre-gzipped copy, so a hit costs a Map lookup and a
//   socket write: no Mongo, no JSON.stringify, no per-request gzip.
// - Concurrent misses for the same key share one producer call (no stampede).
// - Every write path that can change a cached answer calls invalidate() (model hooks in model/venue.js,
//   model/space.js, model/review.js), so entries are normally fresh; the TTL bounds staleness when a write
//   happens in ANOTHER process (this cache is per process, not shared).
// - Availability is deliberately never cached: it must not show a booked slot as free.
// - Off under jest unless PUBLIC_CACHE=1, off everywhere with PUBLIC_CACHE=0.
const crypto = require("crypto");
const zlib = require("zlib");

const enabled = () => (process.env.PUBLIC_CACHE ? process.env.PUBLIC_CACHE === "1" : process.env.NODE_ENV !== "test");
const MAX_ENTRIES = 500;

const entries = new Map(); // key -> { body, gz, etag, expires }
const inflight = new Map(); // key -> Promise<entry>
let generation = 0; // bumped by invalidate(); a producer that started before it must not store its (stale) answer
const stats = { hits: 0, misses: 0, invalidations: 0 };

const build = (payload) => {
  const body = JSON.stringify(payload);
  const buf = Buffer.from(body);
  return {
    body: buf,
    gz: buf.length > 1024 ? zlib.gzipSync(buf, { level: 6 }) : null,
    etag: `W/"${buf.length.toString(16)}-${crypto.createHash("sha1").update(buf).digest("base64").slice(0, 27)}"`,
  };
};

const invalidate = () => {
  generation += 1;
  stats.invalidations += 1;
  entries.clear();
  inflight.clear();
};

const getEntry = async (key, ttlMs, producer) => {
  const hit = entries.get(key);
  if (hit && hit.expires > Date.now()) {
    stats.hits += 1;
    return hit;
  }
  if (inflight.has(key)) return inflight.get(key);
  stats.misses += 1;
  const startedAt = generation;
  const promise = (async () => {
    const entry = { ...build(await producer()), expires: Date.now() + ttlMs };
    // Only keep the answer if nothing was written while it was being computed
    if (startedAt === generation) {
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
      entries.set(key, entry);
    }
    return entry;
  })().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/**
 * Sends `producer()`'s result (an object, serialised as JSON) with Cache-Control + ETag, answering
 * If-None-Match with 304, and serving the pre-gzipped bytes when the client accepts gzip.
 */
const sendCached = async (req, res, key, { ttlMs = 30000, maxAgeSec = 10 }, producer) => {
  if (!enabled()) return res.status(200).json(await producer());

  const entry = await getEntry(key, ttlMs, producer);
  res.set("Cache-Control", `public, max-age=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 3}`);
  res.set("ETag", entry.etag);
  res.vary("Accept-Encoding");
  if (req.headers["if-none-match"] === entry.etag) return res.status(304).end();

  res.status(200).type("application/json");
  if (entry.gz && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    res.set("Content-Encoding", "gzip");
    return res.send(entry.gz);
  }
  return res.send(entry.body);
};

module.exports = { sendCached, invalidate, stats, enabled };
