# Venure backend performance report

Measured with k6 against a local MongoDB loaded with realistic volume, before and after the changes below.
All numbers are medians of 3 runs; run-to-run variance is stated where it matters. Nothing here was measured
against the cloud database or the shared `venure-local-e2e` database.

## Summary

| | before | after |
|---|---|---|
| Public browse endpoints (venue list, filters, search, featured, counts, detail) | 38-507 req/s, p50 96-1,201 ms | 2,300-3,000 req/s, p50 16-20 ms (same 50 virtual users) |
| `GET /api/venues?guests=300&amenities=...` | 38 req/s, p50 1,201 ms | 2,494 req/s, p50 19 ms |
| Owner reviews | p50 1,643 ms | p50 331 ms |
| Admin yearly earnings | 82 req/s, p50 583 ms | 586 req/s, p50 84 ms |
| Notifications (customer / owner) | p50 385 / 414 ms | p50 154 / 157 ms |
| Favorites toggle race (51 parallel toggles) | 11 duplicate copies stored | exactly 1 |
| Booking / replay / registration races | see "Races" | all hold |

Honest reading: the public wins are mostly the cache (see "Caching"), which only helps repeated identical reads.
The un-cached improvements are the indexes (28-60% lower p50 on the endpoints they target), the
denormalised fields and lean queries. The biggest remaining costs are the booking and inquiry lists in
`bookingService.js` / `inquiryService.js` (see "What I could not improve").

## Method

- Hardware: Intel i7-11800H (8 cores / 16 threads), 15.7 GB RAM, Windows 11, Node 24, MongoDB 8.x local standalone,
  k6 v2.2. The load generator, MongoDB and the server share the machine, and other agents were using it too,
  so absolute numbers carry noise of roughly +-25% (visible on endpoints I did not touch, e.g. `admin_activity`
  moved +28% with no relevant change). Compare ratios, not single digits.
- Dataset (`scripts/seed-load.js`, deterministic, raw-driver inserts): 3,200 venues (3,000 approved over 20 Nepali
  cities and 5 categories), 11,087 spaces, 0-6 packages per venue, 5,401 users (5,000 customers, 400 owners, 1 admin),
  40,000 bookings, 30,000 inquiries, 15,000 quotations, 20,000 reviews, 50,000 notifications, 3,000 chats,
  20,000 messages. Hot users and venues are skewed so list endpoints return realistic, non-trivial pages.
- Server: `DISABLE_RATE_LIMITS=1 DB_URL=mongodb://127.0.0.1:27017/venure-load PORT=5053 node server.js`
  (NODE_ENV unset, as in the brief: access log on, debug logger on).
- Load: 50 virtual users, closed loop (no think time), 12 s per run, one endpoint at a time ("solo"), 3 runs per
  endpoint, medians reported. Latency in a closed loop at saturation is queueing at the single Node thread, so it is
  roughly 50 / throughput; req/s is the more stable number. Server CPU was about 100% of one core on most endpoints
  both before and after (the process is CPU bound), raw per-run CPU/RSS samples are in `k6/results/*/*/run*.json`.
- "Before" is the repository at commit `f28e94f` (extracted with `git archive`, same machine, same database, its
  own auto-created indexes only). "After" is the working tree. A server-less floor check (`k6/floor.js`,
  `/api/health`) gives about 3,200 req/s for the bare framework on the before build.

## Before / after, every endpoint (solo, 50 VUs, median of 3)

Columns: req/s, then p50 / p95 / p99 in milliseconds. Raw: `k6/results/before`, `k6/results/after`.

| endpoint | before req/s | after req/s | before p50 | after p50 | p50 change | before p95 | after p95 | before p99 | after p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| browse / venues_list | 161 | 2344 | 288 | 20.3 | -93% | 434 | 27.3 | 579 | 42.9 |
| browse / venues_filter_city_cat | 197 | 2429 | 243 | 19.9 | -92% | 384 | 24.7 | 407 | 29.4 |
| browse / venues_sort_rating_p3 | 171 | 2509 | 270 | 19.4 | -93% | 417 | 25.2 | 514 | 29.7 |
| browse / venues_search_name | 124 | 2323 | 386 | 20.4 | -95% | 500 | 25.3 | 548 | 31.7 |
| browse / venues_guests_amenities | 38.2 | 2494 | 1201 | 19.3 | -98% | 1631 | 24.5 | 1678 | 28.3 |
| browse / venues_featured | 419 | 2692 | 113 | 17.9 | -84% | 169 | 23.0 | 193 | 25.8 |
| browse / venues_category_counts | 507 | 2987 | 96.2 | 16.3 | -83% | 134 | 21.3 | 170 | 23.6 |
| browse / venue_detail | 406 | 2634 | 122 | 18.3 | -85% | 149 | 24.0 | 175 | 29.8 |
| browse / venue_spaces | 645 | 765 | 73.0 | 64.7 | -11% | 104 | 75.8 | 119 | 87.8 |
| browse / venue_availability | 472 | 363 | 103 | 135 | 31% | 117 | 164 | 130 | 190 |
| browse / venue_reviews | 471 | 442 | 102 | 116 | 13% | 135 | 145 | 160 | 163 |
| browse / reviews_featured | 289 | 324 | 168 | 152 | -9% | 202 | 179 | 230 | 193 |
| customer / auth_me | 435 | 463 | 89.6 | 83.0 | -7% | 117 | 99.1 | 133 | 109 |
| customer / my_inquiries | 28.7 | 22.0 | 1274 | 1685 | 32% | 2013 | 2620 | 2237 | 2789 |
| customer / my_bookings | 16.4 | 13.2 | 2479 | 2915 | 18% | 3191 | 3799 | 3339 | 4071 |
| customer / my_booking_count | 413 | 335 | 88.9 | 114 | 28% | 150 | 149 | 190 | 164 |
| customer / favorites | 226 | 250 | 177 | 158 | -11% | 203 | 199 | 227 | 219 |
| customer / notifications | 104 | 265 | 385 | 154 | -60% | 435 | 194 | 455 | 204 |
| customer / chats | 164 | 141 | 244 | 284 | 16% | 267 | 317 | 295 | 336 |
| customer / chat_unread_count | 309 | 360 | 127 | 109 | -14% | 158 | 128 | 172 | 140 |
| customer / chat_messages | 182 | 163 | 218 | 236 | 8% | 250 | 282 | 267 | 338 |
| owner / owner_inquiries | 13.8 | 10.9 | 2852 | 3565 | 25% | 3547 | 4471 | 4193 | 5369 |
| owner / owner_bookings | 7.7 | 6.0 | 5170 | 6334 | 23% | 5906 | 7760 | 7524 | 9723 |
| owner / owner_earnings | 156 | 177 | 254 | 224 | -12% | 341 | 264 | 393 | 302 |
| owner / owner_booking_count | 207 | 175 | 186 | 222 | 19% | 258 | 266 | 309 | 300 |
| owner / owner_venues | 100 | 189 | 379 | 208 | -45% | 472 | 268 | 513 | 312 |
| owner / owner_reviews | 25.5 | 120 | 1643 | 331 | -80% | 1923 | 409 | 2253 | 443 |
| owner / owner_notifications | 95.0 | 258 | 414 | 157 | -62% | 523 | 202 | 572 | 215 |
| owner / owner_chats | 98.8 | 95.8 | 378 | 400 | 6% | 625 | 631 | 740 | 706 |
| admin / admin_users | 293 | 282 | 165 | 173 | 4% | 190 | 200 | 208 | 231 |
| admin / admin_venues | 177 | 186 | 248 | 265 | 7% | 335 | 307 | 352 | 325 |
| admin / admin_venues_search | 172 | 180 | 282 | 274 | -3% | 327 | 333 | 373 | 353 |
| admin / admin_reviews | 150 | 185 | 320 | 266 | -17% | 381 | 293 | 432 | 306 |
| admin / admin_reviews_search | 41.1 | 72.2 | 1139 | 658 | -42% | 1414 | 842 | 1469 | 881 |
| admin / admin_earnings_monthly | 82.0 | 586 | 583 | 83.5 | -86% | 661 | 102 | 700 | 127 |
| admin / admin_activity | 559 | 446 | 87.3 | 111 | 28% | 95.9 | 141 | 118 | 155 |
| admin / admin_total_bookings | 271 | 340 | 178 | 137 | -23% | 206 | 187 | 232 | 254 |
| admin / admin_customer_total | 489 | 462 | 98.5 | 106 | 8% | 117 | 127 | 134 | 162 |
| admin / admin_approved_count | 472 | 456 | 103 | 106 | 3% | 116 | 130 | 125 | 154 |
| admin / top_venues | 91.2 | 93.3 | 531 | 511 | -4% | 644 | 646 | 689 | 782 |

Endpoints that look slower after (my_inquiries, my_bookings, owner_inquiries, owner_bookings, availability, chats,
admin_activity) are in code I did not change materially or at all; the swing there is machine noise plus, for the
booking/inquiry lists, a changed `bookingService`/`inquiryService` from the parallel booking work. I am not claiming
those as regressions or wins of this work.

## What changed, and what each change did

Measured effect is stated only where I isolated it.

### 1. Indexes (isolated: before code + new indexes, label `idx-only`)

Real query shapes now have indexes (`model/venue.js`, `space.js`, `review.js`, `notification.js`, `chat.js`,
`message.js`, `user.js`, `booking.js`, `inquiry.js`, `quotation.js`, `activityLog.js`: every index is declared in its model):

| endpoint | before p50 | indexes only p50 | change |
|---|---:|---:|---:|
| venues list | 288 | 189 | -35% |
| venues city+category | 243 | 145 | -40% |
| venues sort rating page 3 | 270 | 150 | -45% |
| venues featured | 113 | 82 | -27% |
| category counts | 96 | 44 | -54% |
| notifications (customer) | 385 | 173 | -55% |
| notifications (owner) | 414 | 167 | -60% |
| chat unread count | 127 | 89 | -30% |
| admin reviews | 320 | 252 | -21% |
| bookings/inquiries lists | | | about 0-5%: dominated by unbounded `populate` and serialising thousands of documents, not by the scan |

Full table: `k6/results/compare-before-indexes.md`. `test/perfIndexes.test.js` asserts via `explain` that the hot
shapes use an index and never `COLLSCAN`.

### 2. Denormalised read models

- `Venue.minPricePerPlate`, hidden `priceSortKey` (maintained on every save, `findOneAndUpdate`, `updateOne`),
  `Venue.maxCapacity`, `Venue.spaceCount` (maintained by hooks in `model/space.js`, recomputed from the truth on every
  space write so concurrent writes converge). The guests filter used to aggregate over every space in the database per
  request (38 req/s); it is now an indexed range on the venue (2,494 req/s with the cache, and no aggregation without).
- `Chat.lastMessage`, written in one atomic pipeline update in `saveMessage`; the conversation list no longer
  aggregates every message of every chat (old chats fall back to one aggregation limited to those chats and are healed).
- Backfill: `node scripts/backfill-venue-derived.js` (idempotent).

### 3. New search filters (contract, confirmed on port 5052)

`GET /api/venues` accepts `minPrice`, `maxPrice` (integers, NPR per plate; a venue matches if ANY package costs within the
inclusive range; venues without packages match only when neither is given) and `sort=price_asc|price_desc|popular`
(plus existing `newest|rating`). Price sorts order by the cheapest package, venues without packages last in both;
`popular` is `totalReviews desc, averageRating desc, createdAt desc`. Every sort ends in `_id` so pages never overlap.
Unknown sort or non-integer price gives 400. 16 tests in `test/venueSearchFilters.test.js`.

### 4. Public cache and HTTP caching (`utils/publicCache.js`)

Venue list, featured, category counts and venue detail are served from a per-process TTL cache (30-60 s) holding the
serialised JSON, a weak ETag and a pre-gzipped copy; concurrent misses share one query. Responses carry
`Cache-Control: public, max-age=5-30, stale-while-revalidate` and honour `If-None-Match` (304).
Invalidation: any write to Venue (save, findOneAndUpdate, updateOne/Many, deleteOne/Many, insertMany), Space (which
touches its venue) or Review (which updates the venue rating) clears the whole cache; a generation counter prevents
an in-flight stale read from being stored afterwards. Availability is never cached. Off under jest unless
`PUBLIC_CACHE=1`; `PUBLIC_CACHE=0` disables it anywhere.
Limits, stated plainly: the cache is per process (with several instances, a write on one is seen by the others only
after the TTL, at most 30-60 s); the browser may show a list up to 10 s old.
This is the change responsible for the 15-50x public numbers. Without it a venue list request is still a Mongo query plus
serialisation; with the old code plus indexes only it ran at 259-340 req/s (`idx-only` runs).

### 5. Lean queries and over-fetching

`.lean()` plus `Promise.all` for count+find on owner venues, admin venues, venue detail, favorites (now one `$in` query
instead of a populate, ordering preserved), notifications, chat messages (capped to the newest 200), owner reviews,
public reviews (newest 50, `?page&limit`, max 100), featured reviews, activity log, user profile and space list.
Lists drop `drinkOptions` and the internal sort key. Owner reviews: 25 -> 120 req/s, p50 1,643 -> 331 ms (venue name
comes from the venue query instead of a second populate).

### 6. Other

- Admin yearly earnings: result memoised for 30 s per process (82 -> 586 req/s). Figures can be up to 30 s old.
- Mongo pool `maxPoolSize` 10 -> 30 (`MONGO_MAX_POOL`), `minPoolSize` 5, `AUTO_INDEX=0` to stop implicit index builds
  in production (then run `node scripts/ensure-indexes.js` on release; with the default there is nothing to run). Not isolated individually.
- Nearby search used `countDocuments` with `$near`, which MongoDB rejects; it now counts the same circle with `$geoWithin`.
- Access log (`LOG_REQUESTS=all|errors|off`, default `all` = unchanged). Isolated on the after build, 3 runs each:

  | endpoint | log all (req/s) | log errors only (req/s) |
  |---|---:|---:|
  | auth_me | 398 / 454 / 583 | 597 / 676 / 648 |
  | venue_availability | 506 / 351 / 410 | 533 / 550 / 580 |
  | my_booking_count | 349 / 381 / 438 | 478 / 542 / 540 |

  Roughly +25-45% throughput for authenticated/uncached requests. Recommended: `LOG_REQUESTS=errors` in production
  (not made the default because access logs are an operations decision).

### Checked and found fine
Compression is effective (cached responses are pre-gzipped, others use the `compression` middleware, threshold 1 KB);
helmet/cors overhead is negligible next to the 0.3 ms per-request floor; bcrypt cost 10 is only on login/register.

## Races and integrity

Standalone MongoDB (local and mongodb-memory-server) has no multi-document transactions, so every guarantee is a
single atomic update or a unique index. Jest: `test/raceConditions.test.js`; k6 over real HTTP: `k6/run-race.js`
(starts an eSewa status stub, builds signed callbacks, fires all requests at once, then checks the database).

| scenario | before (`f28e94f`) | after |
|---|---|---|
| 51 parallel favorite toggles, one venue | **FOUND**: 11 copies of the same venue stored (read-modify-write `user.save()`) | exactly 1; atomic pipeline update. Fixed in `favoriteService.js` |
| 20 parallel reviews of one booking | unique index existed, but the duplicate surfaced as a generic 400 from the error handler | exactly 1 review, others 400 with a clear message; venue stats recomputed from the truth |
| 30 parallel sign-ups, same email | 1 account (unique index) | 1 account; case variants also collapse to one |
| 30 concurrent chat messages | | 30 messages, 30 notifications, preview ends on the newest, text starting with `$` stored verbatim |
| 50 customers verify payment for one slot | not measurable: the before build answered all 50 with 409 on this database (cause not investigated; possibly the newer slot index already in the database), so no valid before number | 1 booking (201), 49 x 409, no stuck holds |
| one payment callback replayed 20x in parallel | not measurable (same reason) | 1 booking, 1 payment row; 19 replays return 200 with the existing booking, 1 returns 201 |

Possible issue in the booking code (not my files, not fixed): after the 50-way slot race, 49 customers lost but only
47 attempts ended `refund_due`. Two paid losers appear to have been rejected before the refund flag was set, which would
leave them charged with nothing recorded. Worth a look by whoever owns `bookingService.js` (I did not dig further).

Other findings outside my files:
- `GET /api/bookings/owner-bookings`, `/api/inquiries/owner`, `/api/bookings/my-bookings`, `/api/inquiries/my` return every
  row, un-lean, with 2-3 `populate`s. These are the slowest endpoints in the system (owner bookings p50 about 5 s,
  7 req/s at 50 users). They need pagination, `.lean()` and projections; the indexes I added make the scans cheap but the
  cost is serialising thousands of documents.
- `middleware/authMiddleware.js` loads a full Mongoose user document on every authenticated request; `.lean()` plus a
  field projection (or a very short cache) would raise the floor of every authenticated endpoint.
- No code ever sets `Message.seen = true`, so unread counts only grow.
- `getVenueAvailability` runs two sequential queries (spaces, then bookings) and is uncached by design: about 100-140 ms
  p50 at 50 users.

## Reproduce

```
# 1. data (refuses anything but a local database whose name contains "load"; drops it first)
DB_URL=mongodb://127.0.0.1:27017/venure-load node scripts/seed-load.js
# 2. indexes / derived fields on the new code
DB_URL=mongodb://127.0.0.1:27017/venure-load node scripts/ensure-indexes.js
DB_URL=mongodb://127.0.0.1:27017/venure-load node scripts/backfill-venue-derived.js
# 3. server
DISABLE_RATE_LIMITS=1 DB_URL=mongodb://127.0.0.1:27017/venure-load PORT=5053 FRONTEND_URL=http://localhost:5175 node server.js
# 4. read paths: every endpoint solo, 3 runs, medians + CPU/RSS samples
node k6/run.js --label after --groups browse,customer,owner,admin --solo --runs 3 --duration 12s --vus 50 --port 5053
node k6/compare.js before after
# 5. races (server needs ESEWA_STATUS_URL=http://127.0.0.1:5099/ in its environment)
DB_URL=mongodb://127.0.0.1:27017/venure-load node k6/run-race.js --label after --port 5053
# jest
npx jest test/venueSearchFilters.test.js test/perfIndexes.test.js test/raceConditions.test.js
```
Test accounts: `load-admin@load.test`, `load-owner-N@load.test`, `load-customer-N@load.test`, password `LoadTest#123`
(local throw-away database only). On Windows git-bash prefix k6/node commands with `MSYS_NO_PATHCONV=1`.
To measure a "before", extract the old commit (`git archive <commit> | tar -x -C somewhere`), link `node_modules`, run
it on 5053 against the same database before running `ensure-indexes.js`.

## Paged booking and inquiry lists (measured 2026-10-20)

The four lists that were the slowest in the system now come a page at a time, with the tab filter and the tab counts
done on the server (`?page`, `?limit`, `?group`). Same method as above: 50 virtual users, 12 s, one endpoint at a time,
median of 3 runs, a freshly seeded `venure-load` database (same volume), both builds against the same data and indexes.
"Before" is commit `c04fe7f` (every row returned), "after" is the first page of the tab the page opens on
(`k6/load.js` endpoints ending `_page`). Raw: `k6/results/pg-before`, `k6/results/pg-after`.

| list | before p50 | after p50 | change | before req/s | after req/s | response size before | after |
|---|---:|---:|---:|---:|---:|---:|---:|
| customer inquiries | 1,794 ms | 546 ms | -70% | 20 | 73 | 137 KB | 15 KB |
| customer bookings | 3,130 ms | 606 ms | -81% | 12 | 65 | 203 KB | 16 KB |
| owner inquiries | 4,125 ms | 855 ms | -79% | 9 | 46 | 254 KB | 13 KB |
| owner bookings | 5,871 ms | 798 ms | -86% | 6 | 50 | 411 KB | 11 KB |

The old, un-paged calls still exist (no `page` or `group` returns the plain array) and measured the same as before
(1,767 / 3,228 / 3,521 / 6,727 ms), so the gain comes from paging, not from machine noise. The remaining time is mostly
the per-tab counts (five count queries per request) and the populates. Same caveats as above: one machine, noise of about 25%.

## Remaining bottlenecks and limits

- Booking and inquiry lists (above): the largest remaining cost, outside my files.
- A single Node process is CPU bound at about 100% of one core; the next step for throughput is running several
  processes (the in-memory cache is per process, see limits above) or a shared cache.
- Text search (`search=`) is an unanchored case-insensitive regex; it is fast on cached hits but a miss scans venue
  names (about 3,200 rows here). A text or normalised-name index would be needed beyond tens of thousands of venues.
- Mixed-traffic runs and sustained-duration (soak) runs were not done; every number above is single-endpoint, 12 s, 50 VUs.
- Admin user search (`name`/`email` regex) and review search (comment regex) are still scans (review search improved
  only through parallelism and indexes: 1,139 -> 658 ms p50).
- `getVenueAvailability`, socket.io overhead, JWT verification caching and graceful shutdown were not changed.

## Load database

`venure-load` was left in place on the local MongoDB for re-runs (about 80 MB of data; `mongosh venure-load --eval "db.dropDatabase()"`
removes it). It is not used by anything else. Raw results and a log of each run are in `k6/results/`.
