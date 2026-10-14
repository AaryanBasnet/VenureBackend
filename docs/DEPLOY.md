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
| `GMAIL_USER`, `GMAIL_PASS` | for password reset | Gmail app password |
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
