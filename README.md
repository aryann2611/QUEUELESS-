# QueueLess — Skip the wait.

Virtual queues for clinics, salons, banks, government offices and repair shops. Customers find a business on the map, see the live queue, take a token from their phone, track their position in real time and get a push notification when their turn is near. Businesses run the queue from a one-tap counter screen.

```
Dr. Sharma Clinic · 2 counters
Counter 1: #536 (2:47 to arrive)   Counter 2: #537 ✓ arrived   Waiting: 4   ETA: 19 min
```

## Accounts

All seeded accounts use the password **`password`** unless noted.

| Role | Email | Password | Lands on |
|---|---|---|---|
| Admin (seeded) | `admin@example.com` | `password` | `/admin` |
| Customer | `user@example.com` | `password` | `/app` |
| Vendor | `dr-sharma-clinic@example.com` | `password` | `/vendor` |
| Any other vendor | `<shop-name-slug>@example.com` e.g. `glow-salon@example.com`, `city-bank-main-branch@example.com` | `password` | `/vendor` |
| Other customers | `priya@example.com`, `rahul@example.com`, `neha@example.com` … (first names from the seed) | `password` | `/app` |

Registering with the email set as `ADMIN_EMAIL` in `server/.env` makes that account an admin (your own admin login is whatever you registered there). Admins can change any user's role at **Admin → Users**.

> These are sample credentials for a local database. Change `JWT_SECRET` and the admin password before exposing the app anywhere public.

## Run

### With Docker (nothing else to install)

```bash
docker compose up --build        # → http://localhost:4000
```

One image serves the API, WebSocket and the built front end on a single port; MongoDB runs beside it on a named volume. The first start seeds the sample shops and accounts.

```bash
docker compose down              # stop, keep data
docker compose down -v           # stop and wipe
docker compose exec app node scripts/seed.js         # re-seed sample data
docker compose run --rm app node scripts/vapid.js    # generate push keys
```

### Without Docker

```bash
# server — embedded MongoDB persists in server/data, nothing to install
cd server && cp .env.example .env && npm install   # then fill in .env
npm run seed        # sample shops + accounts, password "password" (safe to re-run)
npm run dev         # http://localhost:4000

# client — second terminal
cd client && npm install && npm run dev      # http://localhost:5173
```

`npm run seed` seeds without staging; `npm test` runs the server suite; `npm run build` in `client/` produces `dist/`, which the server serves on `:4000` in production.

Only one process can use the embedded database at a time. Starting a second server, or a server while `npm run seed` is still running, fails immediately with a message saying so.

### Production (Render, Railway, a VPS — anything that runs Node or Docker)

The server refuses to start in production without `MONGO_URI` and `JWT_SECRET`, so a misconfigured deploy fails loudly instead of silently using an empty database or accepting any token.

| Setting | Value |
|---|---|
| Build command | `cd client && npm ci && npm run build && cd ../server && npm ci --omit=dev` |
| Start command | `cd server && node src/index.js` (not `npm start` — that expects a `.env` file) |
| Health check | `/healthz` |
| `NODE_ENV` | `production` |
| `MONGO_URI` | your Atlas string, e.g. `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/queueless?retryWrites=true&w=majority` — in Atlas → Network Access, allow the host's IP (or `0.0.0.0/0` for platforms without a fixed egress IP) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | the email that gets the admin role on registration |
| `TRUST_PROXY` | `1` (behind Render/Railway/nginx, so rate limits see real client IPs) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | from `npm run vapid` — optional, enables background push |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | live keys from the Razorpay dashboard — optional, enables express slots |
| `SEED` | leave unset in production (`1` fills the database with sample shops) |

Or build the Docker image (`docker build -t queueless .`) and run it with the same variables. Before going live: register the admin with `ADMIN_EMAIL`, register each real shop owner as a business (they start *pending* until the admin approves them), and switch Razorpay from `rzp_test_` to live keys.

## Environment

`server/.env`
```
PORT=4000
# MONGO_URI=mongodb://127.0.0.1:27017/queueless   # unset → embedded db in server/data
JWT_SECRET=change-me
ADMIN_EMAIL=admin@example.com     # registering with this email yields role=admin

# Web push (npm run vapid generates a pair). Blank → push reported as unavailable, app still works.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# Razorpay, for paid express slots. Blank -> feature hidden.
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# AUTO_APPROVE_SHOPS=1     # new shops go live without admin approval (default: pending)

# Sample-data city: where npm run seed places the shops
SEED_LAT=26.8492
SEED_LNG=80.8586
SEED_CITY=Lucknow
SEED_STATE=Uttar Pradesh
SEED_PINCODE=226001
SEED_EXTRA=100           # generated shops on top of the 22 named ones (default 0)
SEED_RADIUS_KM=60
```

`client/.env`
```
VITE_GOOGLE_MAPS_API_KEY=       # optional; without it maps use OpenStreetMap/Leaflet (free, nothing to configure)
VITE_GOOGLE_MAPS_MAP_ID=
```

Push notifications need `localhost` or HTTPS (a browser rule for service workers). A plain `http://192.168.x.x` LAN address will not deliver them.

## Features

**Customer** — map of nearby shops with live wait times, location accuracy shown honestly with a map pin to correct it; join a queue with a service; live ticket with position, ETA, which counter to go to and an arrive-by countdown; push notifications that reach a closed tab; appointments that check in as priority tokens; history.

**Vendor** — one tile per counter with Next / Skip / Complete, Arrived check-in, grace-period auto-skip of no-shows, one-tap Recall; keyboard-driven (`N` `S` `C`, `1`–`n` picks the counter); shop profile, map pin, services with durations, hours; printable counter QR; analytics for today / 7 / 30 days with a weekday×hour heatmap; **express slots** — sell a capped number of front-of-line tokens per hour through Razorpay (never for government offices); **Sales** page — revenue, slots sold, paying customers, trend, revenue-by-day chart and every payment; **Reviews** — average, star histogram, per-service ratings and public replies; cover photo upload (shrunk in the browser) or URL.

**Admin** — approve, suspend or restore businesses (new ones are hidden until approved); users and roles; platform stats; **Transactions** — every express payment across the platform with per-shop breakdown.

## Roles & routes

| role | routes | can |
|---|---|---|
| guest | `/` `/nearby` `/shop/:id` `/login` `/register` | browse approved shops and live queues |
| user | `/app` `/queue` `/t/:tokenId` `/appointments` `/notifications` `/profile` | join/leave, book, track, get notified |
| staff | `/vendor` + `queue` `appointments` `shop` `location` `services` `analytics` `settings` | run **own** shops |
| admin | `/admin` + `shops` `users` `vendors` `queues` `appointments` `analytics` `settings` | everything, any shop; verify shops; change roles |

Opening a route your role can't use redirects to your home and says why.

## Data model

```
User             { name, email (unique), passwordHash, role: user|staff|admin }
Queue (= shop)   { name, description, owner→User, category, status: pending|approved|suspended,
                   express{enabled, price (₹), perHour},
                   avgServiceMinutes, isOpen, counters (1–20), graceMinutes (0 = off),
                   counter, counterDate, currentToken→Token,
                   phone, email, image (https URL or data:image ≤500 KB), rating{avg, count}, address{street,city,state,pincode}, hours{open,close},
                   services[{name, minutes}], location: GeoJSON Point [lng, lat] (2dsphere) }
Token            { queue, user, number, priority, service, status: waiting|serving|served|skipped|left,
                   counter, calledAt, arrivedAt, doneAt, pushed[], express{orderId, paymentId, amount} }   unique: one active token per user per queue
ExpressOrder     { orderId (unique), queue, user, amount, used }    a Razorpay order, consumed once by the join that pays for it
Review           { queue, user, token (unique → one per served visit), rating 1-5, comment, service, reply{text, at} }
Appointment      { queue, user, at, service, note, status: booked|checked_in|cancelled|completed, token }
PushSubscription { user, endpoint (unique), keys{p256dh, auth}, userAgent }
```

## Queue rules

- Token numbers are per shop and reset at midnight UTC. One active token per user per shop; closed or unapproved shop → can't join.
- Order: `priority` desc, then `number` asc. Checked-in appointments and recalled tokens are priority.
- Each counter serves one token. **Next** completes that counter's token and calls the next waiting one to it. **Skip** marks it skipped. **Complete** finishes without calling anyone. Reducing `counters` returns anyone stranded above the new limit to the front of the line.
- **Grace period**: a called customer who hasn't been marked **Arrived** within `graceMinutes` is auto-skipped (sweeper runs every 20 s). **Recall** puts a skipped customer back at the front with priority and re-arms their alert.
- **Express slots**: a vendor can sell up to `perHour` front-of-line tokens per rolling hour. The client pays a Razorpay order the server created; the join is accepted only with a valid signature, for an order that belongs to that user and shop, and that has not been used. Off for `government` shops.
- **ETA** is service-aware: the sum of each token's service duration ahead of you, plus remaining time at the counters, divided by the number of counters. `avgServiceMinutes` is learned: `0.7·avg + 0.3·actual` on every completion.
- Analytics days run midnight to midnight UTC.

## HTTP API (JSON · `Authorization: Bearer <jwt>`)

| method | path | auth | notes |
|---|---|---|---|
| POST | `/api/auth/register` · `/login` | – | `{ token, user }` |
| GET · PATCH | `/api/auth/me` | any | PATCH `{ name?, password? }` |
| GET | `/api/queues` | optional | `?q&category&open=1` approved shops · `?mine=1` your own (any status) · `?all=1` everything (admin) |
| GET | `/api/queues/nearby` | optional | `?lat&lng&radius(km ≤100)&q&category` — `$geoNear`, adds `distanceKm`, max 100 results |
| POST | `/api/queues` | staff/admin | starts `pending` unless admin or `AUTO_APPROVE_SHOPS=1` |
| GET | `/api/queues/:id` | optional | `QueueState`; unapproved shops only for owner/admin |
| PATCH | `/api/queues/:id` | owner/admin | profile fields, `counters`, `graceMinutes`, `services[]`, `location{lat,lng}` |
| POST | `/api/queues/:id/express/order` | any | Razorpay order for one express slot → `{ orderId, amount, currency, keyId }` · 409 when the hour is sold out |
| POST | `/api/queues/:id/join` | any | `{ service?, express?: { orderId, paymentId, signature } }` → `{ ticket }`; a verified payment buys a priority token |
| POST | `/api/queues/:id/next` · `/skip` · `/complete` | owner/admin | `{ counter? }` (default 1) |
| POST | `/api/queues/:id/arrived/:tokenId` · `/recall/:tokenId` | owner/admin | check in · un-skip |
| GET | `/api/queues/:id/stats` | owner/admin | `?days=1|7|30` — totals, avg wait, per-hour, per-day, weekday×hour heatmap |
| GET · POST | `/api/queues/:id/reviews` | any · served customer | summary + list · `{ tokenId, rating 1-5, comment? }` once per served visit |
| PATCH | `/api/queues/:id/reviews/:rid` | owner/admin | `{ reply }` (empty removes) |
| GET | `/api/queues/:id/sales` | owner/admin | `?days=7|30|90` — express revenue, count, paying customers, per-day, transactions |
| GET | `/api/tokens/mine` · `/history` · `/:id` | any | tickets |
| DELETE | `/api/tokens/:id` | owner | leave |
| GET · POST · PATCH | `/api/appointments` | any | `{ queue, at, service?, note? }` · PATCH `{ status }` |
| GET | `/api/push/key` | – | `{ publicKey, enabled }` |
| POST · DELETE | `/api/push/subscribe` | any | register / remove this device |
| GET | `/api/admin/stats` · `/users` | admin | platform stats, users |
| GET | `/api/admin/transactions` | admin | `?days=7|30|90` — platform-wide express sales, per-shop breakdown |
| PATCH | `/api/admin/users/:id` | admin | `{ role }` |
| PATCH | `/api/admin/shops/:id` | admin | `{ status: approved|suspended|pending }` |

`/api/shops/*` is an alias of `/api/queues/*`.

## Socket.IO

Guests may connect without a token. `queue:watch` / `queue:unwatch` (queueId) join and leave room `queue:<id>`. After every mutation the server emits `queue:update` `{ queueId, name, isOpen, avgServiceMinutes, currentNumber, serving[{number, counter}], waitingNumbers, etaMinutes }` to the room and `ticket:update` (full `Ticket`) to each affected user, then sends a web push for the moments that matter (approaching, next, your turn, done, skipped) — each once per token.

## Layout

```
server/  src/app.js (express + socket)  db.js  index.js  auth.js  models.js  queue.js  sales.js  reviews.js  payments.js  push.js
         src/routes/ auth queues tokens appointments admin push
         scripts/ seed vapid    test/queue.test.js
client/  src/App.jsx  api.js  auth.jsx  public/sw.js (push service worker)
         lib/  hooks geo motion gsap push notifications theme format maps osm
         ui/   index.jsx (primitives, Reveal, Logo)  Modal.jsx  Toast.jsx
         components/  Layout Map LocationPicker LocationPrompt Cards Chart QrCode CursorGlow JoinQueue BookAppointment SearchPalette
         pages/  Landing Login Nearby Shop  user/(Home Ticket Appointments Notifications Profile)
                 vendor/(VendorContext Overview LiveQueue Appointments ShopProfile Location Services Analytics Settings)
                 admin/(Dashboard Lists)
Dockerfile  docker-compose.yml
```

## Stack

**Server** — Node 20+, Express 5, Mongoose 8, Socket.IO 4, JWT, bcryptjs, web-push. ESM, `node --env-file`. Embedded MongoDB (`mongodb-memory-server`, dev only) or any `MONGO_URI`.
**Client** — Vite, React 18, react-router 7, Framer Motion (+ GSAP ScrollTrigger, lazy-loaded, for scroll scrub only), Leaflet/OpenStreetMap or Google Maps, plain CSS with light and dark themes.
