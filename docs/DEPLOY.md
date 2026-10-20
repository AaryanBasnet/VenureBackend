# Deploying the backend (Render or any Node host)

The API is a plain Node 22 server (`node server.js`, port from `PORT`). A Dockerfile is included.

## 1. Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` (turns on secure cookies and requires real eSewa keys) |
| `DB_URL` | yes | MongoDB Atlas connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | yes | two different long random strings |
| `FRONTEND_URL` | yes | the live site origin(s), comma separated, no trailing slash, e.g. `https://venure.aaryanbasnet.com.np`. Used for CORS, cookies, socket origins and the eSewa return URLs (the first value is used for those) |
| `ESEWA_MERCHANT_CODE`, `ESEWA_SECRET_KEY` | yes in production | from your eSewa merchant account |
| `ESEWA_FORM_URL` | live payments | `https://epay.esewa.com.np/api/epay/main/v2/form` (default is the sandbox) |
| `ESEWA_STATUS_URL` | live payments | `https://esewa.com.np/api/epay/transaction/status/` (default is the sandbox) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | image uploads |
| `BREVO_API_KEY` | on Render | Brevo API key (Brevo, SMTP & API, API keys). When set, all email goes through Brevo's HTTPS API. Render's free plan blocks the SMTP ports Gmail needs, so without this, email cannot work there |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | with Brevo | The sender shown on emails. The address must be a sender you verified in Brevo. Name defaults to "Venure Support" |
| `GMAIL_USER`, `GMAIL_PASS` | only without Brevo | Gmail app password over SMTP: fine locally or on a paid host, blocked on Render's free plan. Used for the owner's "choose your password" link, applications and password reset. If email fails, an approval still succeeds and the admin page offers "Send the link again" |
| `GOOGLE_CLIENT_ID` | optional | Google sign-in; same value as the frontend's `VITE_GOOGLE_CLIENT_ID` |

`DISABLE_RATE_LIMITS=1` only works outside production and exists for local testing.

## 2. Health check

`GET /api/health` returns `{ "success": true, "status": "ok" }` without touching the database. Point the host's health check at it.

## 3. Cookies across domains

Login uses HttpOnly cookies. They work best when the frontend and API share a parent domain, for example frontend `venure.aaryanbasnet.com.np` and API `api.venure.aaryanbasnet.com.np`. If the API stays on `*.onrender.com` and the site is on another domain, the browser treats the cookies as third-party and some browsers will block them.

## 4. Existing data

After this version is deployed against an older database, run once (check the scripts first):

```
node scripts/migrate-spaces.js
node scripts/migrate-bookings.js
```

They create spaces for existing venues and convert old bookings to the inquiry/quotation model. Take a backup first.

## 5. Payments

Deposits are paid on eSewa. The server signs the amount, the customer pays on eSewa, and on return the server verifies the signature and asks eSewa's status API before creating the booking. eSewa has no refund API, so cancellations create a pending refund record (`Payment` of type `refund`, status `pending`) that Venure pays back by hand.

## 6. Venue applications

Owners no longer sign themselves up. They apply at `/list-your-venue/apply` (no account), and an admin reviews the application under Admin, Applications.

- Approving creates the owner account (with no password), the live venue with its halls and photos, and emails a one-time link (`FRONTEND_URL` + `/set-password?token=...`, valid 7 days). The owner chooses a password there and signs in with the email they applied with.
- The business registration and PAN certificates are stored privately on Cloudinary (type `authenticated`, folder `venure/applications-private`) and are only reachable through a 5 minute signed link for an admin.
- Run `node scripts/ensure-indexes.js` after deploying: it creates the one-open-application-per-email index.
- `POST /api/auth/register` still accepts `role: "VenueOwner"` (the admin "add owner" screen uses it). Anyone who calls the API directly can still make an owner account that way; closing it is a separate decision.

## 7. Venue types and space types (run once, right after deploying)

A venue is now filed under one of three **venue types** (`Venue.category`: `banquet-party-palace`, `hotel-resort`, `heritage-traditional`), and the older labels (heritage courtyards, garden estates, intimate halls, mountain retreats, rooftop terraces) are the **space type** of each hall (`Space.spaceType`). A venue lists its kinds of space in `Venue.spaceTypes`, kept in step by the Space model.

Existing venues still carry an old category until this is run, so the venue type filter will not find them:

```
node scripts/migrate-venue-types.js --dry-run   # prints what it would do
node scripts/migrate-venue-types.js
node scripts/ensure-indexes.js
```

It gives each venue's spaces the old category as their space type and files the venue under the nearest venue type (courtyards to heritage and traditional; garden estates and intimate halls to banquet hall and party palace; mountain retreats and rooftop terraces to hotel and resort). That mapping is a best guess: owners can change a venue's type afterwards. Safe to run twice. Take a backup first.

