# THE LAB CAFE
### QR-based Thursday reservations, built in React

A complete small-scale reservation app based on the three provided Figma screen PNGs. Frontend: React + Vite. API: Express. Database: SQLite (persistent file, transaction-locked reservations). Google Calendar: OAuth 2.0 and Calendar API. No paid database or hosting service is required to run it locally.

## Quick start: works before any Google setup

You need **Node.js 20+** and npm. In Terminal:

```bash
cd lab-cafe
cp .env.example .env
npm install
npm run dev
```

Open these URLs on your laptop:

- **http://localhost:5173**: booking app
- **http://localhost:5173/qr**: printable QR code; it automatically chooses your computer's LAN IP
- **http://localhost:5173/admin**: admin guest list; password is `ADMIN_KEY` in `.env`

Click **"try with a sample calendar"** to run the complete reservation flow without a Google account. Demo has realistic gray busy events, clickable colored windows, a confirmation screen, and real SQLite records. Demo bookings do **not** create a Google Calendar event. The demo setting defaults to `true` and should be changed to `false` for any public deployment.

### Scan the QR on your phone

1. Connect your laptop and phone to the **same Wi-Fi**.
2. Start the app with `npm run dev` on your laptop.
3. Visit `http://localhost:5173/qr` on your laptop. This page finds your computer's local network IP and displays a QR code. For example, the QR might point to `http://192.168.1.12:5173`, which is different for every network.
4. Scan it in your phone's camera. Click **try with a sample calendar**, pick an open colored time block, and select a 30-minute reservation.
5. The confirmation page should appear; open `/admin` to see the guest recorded. Press **Print QR** to print it.

If your phone cannot open the QR URL, make sure Vite is running, the devices share Wi-Fi, your laptop firewall allows port `5173`, and the QR contains the correct LAN IP (not `localhost`). Guest/isolated Wi-Fi can prevent local communication. You can edit the URL right on `/qr`.

## Real Google Calendar integration

Google OAuth requires your own **Google Cloud OAuth client ID and secret**. These values cannot be shipped in someone else's project.

### Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/), create/select a project, and enable **Google Calendar API** in APIs & Services > Library.
2. Open **Google Auth Platform** and configure the OAuth consent screen: app name "The Lab Cafe", support email, audience **External**. Keep it in **Testing** during development and add each person's Google account as a test user.
3. Create an OAuth client of type **Web application**. For desktop testing, register this *exact* **Authorized redirect URI**:

   ```
   http://localhost:5173/auth/google/callback
   ```

4. Copy the OAuth client ID and client secret into `.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-secret
   GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
   ```

5. Restart `npm run dev`, open `http://localhost:5173`, and click the Google Calendar icon. Authorize the requested calendar permissions. Your existing commitments on the selected calendars will appear blocked. When you book a free slot, the app adds **"the lab cafe"** to your primary Google Calendar with the location **"Cardinal Gardens, USC, Los Angeles, CA"**.

   The app requests calendar-list read, calendar free/busy read, event read/write, and your basic Google profile. If Google asks you to authorize a sensitive scope in testing, you must be registered as a test user. For broad public release, Google's OAuth verification requirements may apply.

### Real Google login from a phone (QR)

**IMPORTANT:** Google does not permit non-localhost, raw LAN IP addresses as authorized redirect URIs for web OAuth apps. Use a public HTTPS URL to test real OAuth on a phone.

One approach is an HTTPS tunnel:

1. Run `npm run dev` and obtain an HTTPS tunnel URL for your Vite frontend port `5173`. For example, if you have installed [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), run:

   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```

2. Suppose it gives you `https://your-random-name.trycloudflare.com`. In your Google Cloud **Web application** OAuth client, add the **exact authorized redirect URI**:

   ```
   https://your-random-name.trycloudflare.com/auth/google/callback
   ```

3. Change `.env` to match exactly:

   ```dotenv
   GOOGLE_REDIRECT_URI=https://your-random-name.trycloudflare.com/auth/google/callback
   ```

4. Restart `npm run dev`. On your laptop, visit **the HTTPS tunnel URL plus `/qr`**; the QR will point to the HTTPS tunnel domain. Scan from the phone, connect Google, and book.

   You may need to reconnect Google after switching domains because browser sessions are domain-specific. Some tunnel products present an initial anti-abuse page. For a lasting QR code, deploy to a stable HTTPS domain instead of using a rotating tunnel URL.

**Do not** use `http://192.168.x.x:5173/auth/google/callback` as a Google Cloud redirect URI. Google rejects it.

## Reservation rules

- Cafe time zone is **America/Los_Angeles**. The app automatically chooses the upcoming **Thursday**, inclusive of the current Thursday before closing, with times from **10:00 AM to 8:00 PM**.
- Reservations are **30 minutes** by default. The calendar timeline groups consecutive available 30-minute slots into colorful blocks; gray blocks represent existing Google Calendar commitments or fully booked times.
- The cafe permits **at most 10 concurrent reservations**. The backend uses a SQLite `BEGIN IMMEDIATE` transaction around its overlap count and insert. Even two users reserving the last spot at the same time cannot exceed the limit.
- The selected slot is rechecked against the user's actual calendar **at reservation time**, not only when the schedule first loads.
- It creates a `pending` booking under the capacity lock, adds the Google Calendar event, and marks it `confirmed`. If Google event creation fails, the pending reservation is deleted so the spot reopens. Demo bookings confirm directly.
- One user cannot reserve overlapping times. Multiple people can independently reserve the same slot until all 10 spots are used.
- For Google accounts, calendar event details from the user's selected calendars are shown **only to that signed-in visitor**. Admins see the names/emails of people booked but not their other private calendar events.
- SQLite persistence lives at `data/lab-cafe.sqlite`. This file survives stopping/restarting the application. Don't commit it to Git. `.env` and database are ignored by `.gitignore`.
- The `/admin` page is password-protected by `ADMIN_KEY`. It displays confirmed reservations, guest names and emails, and per-slot occupancy. It **does not** require Notion; SQLite is more dependable for this transactional capacity check.

## Customize

Edit `.env` to set:

| Setting | Default | Purpose |
| --- | --- | --- |
| `CAPACITY` | `10` | Maximum concurrent visitors |
| `SLOT_MINUTES` | `30` | Duration of an appointment; use a divisor of 600 like 30 or 60 |
| `TIME_ZONE` | `America/Los_Angeles` | Cafe time zone |
| `DEMO_MODE` | `true` | Let anyone test with a fake calendar |
| `ADMIN_KEY` | Change me | Password to access `/admin` |
| `PORT` | `3001` | API server in development |
| `DB_PATH` | `data/lab-cafe.sqlite` | Optional custom database filename |

To edit the calendar event, modify `createCalendarEvent` in `server/calendar.mjs`. To change the demo busy meetings, edit `demoBusy` there. For colors, typography, or layout use `src/styles.css`.

## Verification

```bash
npm test       # calendar date/slot logic, collision checks, and 10-person capacity
npm run build  # builds an optimized frontend into dist/
npm start      # starts Express on port 3001 and serves the compiled frontend
```

For a packaged build, open `http://localhost:3001` and `http://localhost:3001/qr`, and set `GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback` in Google Cloud and `.env`. (For LAN QR access, edit the URL in `/qr` to use port `3001` instead of `5173`; for phone OAuth use an HTTPS tunnel to port `3001`.)

You can also test occupancy manually by opening incognito sessions or separate devices in demo mode, selecting the same slot 10 times, and verifying that it disappears from the 11th visitor's selectable times. The admin page displays counts.

## Important deployment notes

This is a working small-scale app with functional persistence and Google OAuth support, not a fully hardened multi-tenant production system. Before allowing strangers to sign up on the public internet: turn off demo mode, secure the admin key, configure a stable HTTPS domain, add rate limiting and abuse protection, use encrypted token storage and reliable backups, add clear privacy/retention terms for emails and Calendar access, review Google API OAuth verification, and run the server/database on persistent storage. Never expose `.env`, your OAuth client secret, or SQLite to web users. For one running Node process, SQLite's built-in write locking handles the required capacity constraint.

## Structure

```text
lab-cafe/
  src/main.jsx               React UI, QR view, admin view
  src/styles.css              Figma-inspired dark design
  server/index.mjs            Express routes, sessions and bookings
  server/calendar.mjs         Google OAuth and Calendar API
  server/scheduling.mjs       Thursday times and interval logic
  server/db.mjs               SQLite and atomic reservations
  server/scheduling.test.mjs  Automated correctness checks
  reference/                  Your original three screen PNGs
  vite.config.js              Vite + API reverse proxy
  .env.example                Required configuration template
```

Troubleshooting: `redirect_uri_mismatch` indicates that the `GOOGLE_REDIRECT_URI` in `.env` does not exactly match the URI registered in Google Cloud. OAuth consent denial for an external app in Testing frequently indicates that the Google account was not added as a test user. If the browser shows old bookings after switching Google accounts, sign out of the old session or open an incognito window.
