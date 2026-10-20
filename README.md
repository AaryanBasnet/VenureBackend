# Venure Backend

[![CI](https://github.com/AaryanBasnet/VenureBackend/actions/workflows/ci.yml/badge.svg)](https://github.com/AaryanBasnet/VenureBackend/actions/workflows/ci.yml)

The API behind **Venure**, an event-venue platform for Nepal. It handles venue listings, venue applications, requests and quotations, bookings with eSewa deposits, chat and admin tools.

**Live site: [venure.aaryanbasnet.com.np](https://venure.aaryanbasnet.com.np)** · Frontend: [VenureFrontend](https://github.com/AaryanBasnet/VenureFrontend)

### At a glance

| | |
| --- | --- |
| **~1,650** automated tests across the stack | 1,037 backend (real MongoDB), 365 frontend unit, 252 end-to-end |
| **50 → 1** | 50 customers pay for the same slot at the same moment: exactly one booking is created |
| **1,201 ms → 19 ms** | Venue search by guests and amenities (median, 50 concurrent users) |
| **−70% to −86%** | Median latency of the booking and inquiry lists after server-side paging, with responses about 95% smaller |
| **~100 endpoints, 18 models** | About 28,000 lines of application code |

Measured with k6 on a laptop, so treat the absolute numbers as indicative. The tables are [further down](#engineering-details).

---

## What it does

A customer sends an **inquiry** for a date and a shift. The venue answers with a **quotation** (priced per plate and per shift). When the customer accepts, they pay a **deposit on eSewa**, and only a verified payment creates the **booking**. The balance is paid at the venue and recorded by the owner.

- **Roles:** Customer, VenueOwner, Admin. Customers sign up on the site. Owners come only through a venue application that an admin approves (the owner is emailed a one-time link to set a password). Admins are created only with `scripts/create-admin.js`.
- **Venues and halls:** a venue has a type (banquet or party palace, hotel or resort, heritage or traditional) and one or more halls, each with a kind of space. A venue cannot go live without a hall, and the last hall of a live venue cannot be removed.
- **Chat and notifications** over Socket.IO, with read receipts.
- **Money** is stored in paisa, and dates follow Kathmandu time, whatever time zone the server runs in.

## Why double booking cannot happen

Booking safety lives in the database, not in the application code. A partial unique index (`active_slot_keys_unique`) on the booking slot keys makes two live bookings for the same hall, date and shift impossible, even when two requests arrive at the same instant. eSewa payment verification is replay-safe: the server checks the signature, matches the payment to the attempt it created, asks eSewa's status API whether it is `COMPLETE`, and does so once. If a customer pays for a slot that was taken a moment earlier, the attempt is marked `refund_due` for a manual refund (eSewa has no refund API).

## Tech stack

Node.js 22 · Express 5 · MongoDB with Mongoose · JWT in HttpOnly cookies (access and refresh) · Socket.IO · Zod validation · Cloudinary (uploads, private documents) · eSewa · Brevo or Gmail for email · Winston logging · Helmet and rate limits · Jest, Supertest and mongodb-memory-server

## Getting started

You need Node.js 22 and a MongoDB database (local or Atlas).

```bash
git clone https://github.com/AaryanBasnet/VenureBackend.git
cd VenureBackend
npm install
cp .env.example .env     # then fill it in
npm run dev              # nodemon; use `npm start` in production
```

Create the first admin (the password is asked for, never printed or saved):

```bash
node scripts/create-admin.js
```

`npm run seed` fills a **local development** database with sample data and uses a well-known password. Never run it on a live database.

### Environment variables

`.env.example` lists the basics. The full set, with notes for production, is in [docs/DEPLOY.md](docs/DEPLOY.md).

| Variable | Needed | What it is |
| --- | --- | --- |
| `DB_URL` | yes | MongoDB connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | yes | Two different random strings. The server refuses to start if they match |
| `FRONTEND_URL` | yes | Allowed site origin(s), comma separated. Used for CORS, cookies, sockets and the eSewa return URLs |
| `PORT` | no | Defaults to 5050 |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | Photos and application documents |
| `ESEWA_MERCHANT_CODE`, `ESEWA_SECRET_KEY`, `ESEWA_FORM_URL`, `ESEWA_STATUS_URL` | production | Blank outside production falls back to eSewa's public sandbox merchant |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | for email on Render | Brevo over HTTPS. Render's free plan blocks SMTP |
| `GMAIL_USER`, `GMAIL_PASS` | alternative | Gmail SMTP when no Brevo key is set |
| `GOOGLE_CLIENT_ID` | no | Google sign-in. Must match the frontend's `VITE_GOOGLE_CLIENT_ID` |

## API overview

All routes are under `/api`. Responses look like `{ "success": true, "data": ... }`.

| Prefix | What is there |
| --- | --- |
| `/auth`, `/password` | Register (customers), login, refresh, Google sign-in, set password, reset password |
| `/venues`, `/spaces` | Browse and filter venues, venue details, owner venue and hall management, hall photos, admin status |
| `/venue-applications` | Apply to list a venue, email check, admin review, approve, reject, resend link |
| `/inquiries`, `/quotations` | Requests, quotations, accept, decline and cancel with reasons, attachments |
| `/payment`, `/bookings` | eSewa signing and verification, booking lists (paged), cancel, complete, settle balance, earnings |
| `/chats` | Conversations, messages, unread count (live events over Socket.IO) |
| `/user`, `/user/favorites`, `/notification`, `/contact`, `/newsletter`, `/landing`, `/admin` | Profile, favorites, notifications, contact form, newsletter, landing page content, admin dashboard and activity |

Booking and inquiry lists take `?page`, `?limit` and `?group` and return `{ items, total, page, pages, counts }`, with the size of every tab in `counts`.

## Project structure

```
controller/    # Thin request handlers
service(s)/    # Business rules (services/)
model/         # Mongoose schemas, including the indexes the app relies on
route/         # Express routers and who may call them
middleware/    # Auth, roles, uploads, rate limits
validators/    # Zod schemas
socket/        # Socket.IO setup and events
scripts/       # create-admin, seed, one-off migrations
test/          # Jest suites and helpers
docs/          # DEPLOY.md and PERFORMANCE.md
```

Controllers stay thin. The rules (who may cancel, how a refund is worked out, what a quotation must contain) live in `services/`, which is where the tests aim.

## Testing

```bash
npm test
```

47 suites and about 1,000 tests run against a real MongoDB (`mongodb-memory-server`), not mocks. They cover the booking race (many requests for one slot), eSewa replay, cancellation and refund boundaries, Kathmandu month boundaries, inquiry and quotation rules, the applications flow, uploads, chat, the model indexes and cross-site requests. CI runs the same suite on every push and pull request, after a require-path case check (Linux is case sensitive) and a check that the app boots.

## Deployment

The API is a plain Node server (`node server.js`) and the repository has a `Dockerfile`. [docs/DEPLOY.md](docs/DEPLOY.md) covers environment variables, the health check, cookies across domains, venue applications, the first admin and testing eSewa. [docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the k6 load-test results and what was changed because of them.

## Engineering details

<details>
<summary><b>Load test results</b> (k6, 50 concurrent users, 3,200 venues, 40,000 bookings, 30,000 inquiries, 20,000 reviews)</summary>

| Endpoint | Median before → after | Throughput before → after |
| --- | --- | --- |
| Public venue list and filters | 243–386 ms → about 20 ms | 124–197 → about 2,300–2,500 req/s |
| Venue search by guests and amenities | 1,201 ms → 19 ms | 38 → 2,494 req/s |
| Venue detail | 122 ms → 18 ms | 406 → 2,634 req/s |
| Owner reviews | 1,643 ms → 331 ms | 26 → 120 req/s |
| Admin monthly earnings | 583 ms → 84 ms | 82 → 586 req/s |
| Notifications (customer, owner) | 385, 414 ms → 154, 157 ms | 104, 95 → 265, 258 req/s |
| Customer inquiries list | 1,794 ms → 546 ms | 20 → 73 req/s |
| Customer bookings list | 3,130 ms → 606 ms | 12 → 65 req/s |
| Owner inquiries list | 4,125 ms → 855 ms | 9 → 46 req/s |
| Owner bookings list | 5,871 ms → 798 ms | 6 → 50 req/s |

What produced the gains: indexes declared in the models (27–60% on their own, and a test uses `explain` to prove the hot queries never scan the whole collection), denormalised fields (minimum price, capacity and hall count on the venue, the last message on the chat), a short-lived cache for public reads, and server-side paging with per-tab counts for the four lists (response sizes fell from 137–411 KB to 11–16 KB).

Honest reading: most of the public-browse gain is the cache, which helps repeated identical reads. One machine runs the load generator, the database and the server, so expect about ±25% noise. Full method and every endpoint: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

</details>

<details>
<summary><b>Concurrency and integrity checks</b> (real HTTP requests fired at the same instant)</summary>

| Scenario | Result |
| --- | --- |
| 50 customers pay for the same slot | 1 booking, 49 conflicts |
| One eSewa callback replayed 20 times in parallel | 1 booking, 1 payment record |
| 30 sign-ups with the same email (case variants too) | 1 account |
| 20 reviews of one booking at once | 1 review |
| 30 chat messages at once | 30 messages, 30 notifications, preview ends on the newest |
| 51 parallel favorite toggles | exactly 1 stored (a load test found 11 duplicates before the fix) |

Open item: in the 50-way slot race, 47 of the 49 losers were flagged `refund_due`. The other 2 are not explained yet.

</details>

<details>
<summary><b>Process</b></summary>

About 110 commits, 14 merged pull requests, CI on every push, and CodeQL security alerts reviewed and fixed. Rules live in services and are tested there, so a change to a refund or a quotation rule shows up as a failing test.

</details>

## Known limits

- Payments run on eSewa's sandbox until live keys are set. The sandbox test wallet is small, so large deposits fail there.
- Refunds are recorded and paid back by hand.
- Email from an unverified free sender may land in spam until the Brevo domain is authenticated.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can read, run and learn from the code. Commercial use is not allowed.

## Author

Aaryan Basnet · [basnetaryan1011@gmail.com](mailto:basnetaryan1011@gmail.com) · [LinkedIn](https://www.linkedin.com/in/basnet-aryan-4511a22a4/)
