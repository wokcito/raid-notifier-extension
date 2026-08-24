# Raid Notifier

Chrome extension that detects the gym you're viewing on `pokemongo.com/en/map` and lets you watch/unwatch it directly from Niantic's real map, so you get notified when a raid is available.

## Features

- Detects gyms on the live Pokémon GO web map (no separate scraping step)
- Watch/unwatch a gym from a floating panel on the map
- Log in / sign up (Supabase auth)
- Link Telegram for notifications
- Free tier watch limit indicator
- Buy premium from the popup (currently Bitcoin Cash; more payment methods can be added without
  extension changes, see "Backend API" below) -- shows a QR/address with the exact amount, and
  survives closing the popup while a payment is in flight

## Setup

1. Install dependencies:
   ```
   bun install
   ```
2. Copy the env file and fill in the real values:
   ```
   cp .env.example .env
   ```
   - `API_BASE_URL` — backend API URL
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` — Supabase project (auth)
   - `DEBUG` — optional, set to `true` to log gym-detection details from the map hook
3. Build the extension:
   ```
   npm run build
   ```
4. Load it in Chrome: go to `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the `dist/` folder.

## Scripts

- `npm run build` — one-off production build into `dist/`
- `npm run watch` — rebuilds on file changes (use this while developing)
- `npm run typecheck` — TypeScript check without emitting files

## Project structure

- `src/background.ts` — service worker; talks to the backend API and Supabase auth
- `src/content.ts` — isolated-world content script; renders the floating watch/unwatch panel
- `src/main-world-hook.ts` — main-world content script; hooks `fetch`/`XMLHttpRequest` to detect gyms from the map's GraphQL traffic
- `src/popup.ts` — extension popup (login/sign up, watched gyms list, notification settings)
- `manifest.template.json` — manifest source; `manifest.json` is generated from it plus `.env` at build time

## Backend API

All requests below go to `API_BASE_URL` (from `.env`) with an `Authorization: Bearer <accessToken>` header, except auth which goes straight to Supabase. Called from `src/background.ts`. Types referenced below (`Gym`, `AccountInfo`, `BillingOrder`, etc.) are defined in `src/types.ts`.

| Method | Endpoint | Sends | Receives | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/gyms/watched` | Nothing (no body/params) | `WatchedGymSummary[]` — `{ scopelyGymId, name }` per gym | List the gyms the current user is watching |
| POST | `/gyms/watch-by-scopely-id` | Body: `Gym` — `{ scopelyGymId, name, imageUrl, latitude, longitude }` | The created/updated gym record (not used by the extension beyond `ok`) | Watch a gym |
| DELETE | `/gyms/watch-by-scopely-id/:scopelyGymId` | Path param `scopelyGymId`, no body | Nothing (204) | Unwatch a gym |
| POST | `/gyms/discover-by-scopely-id` | Body: `Gym` (same shape as above) | Nothing (204) | Report a gym seen on the map (feeds the gym database, independent of watching) |
| GET | `/user/me` | Nothing | `AccountInfo` — `{ isPremium, premiumUntil, linkedChannels }` (plus raw user fields the extension ignores) | Get account info |
| PATCH | `/user/me` | Body: `{ timezone: string }` (IANA name, e.g. `America/Argentina/Buenos_Aires`) — sent on every login/signup | Nothing (204) | Update the user's timezone |
| POST | `/notifications/telegram/link-code` | Nothing | `TelegramLinkCode` — `{ deepLink: string }` | Get a deep link to link a Telegram account |
| GET | `/billing/packages` | Nothing | `BillingPackagesInfo` — `{ packages: { months, priceUsdCents, durationMs }[], methods: { method, label }[], maxPremiumHorizonMs }` | List available premium packages and payment methods -- drives the popup's package buttons and method selector, nothing is hardcoded client-side |
| POST | `/billing/orders` | Body: `{ packageMonths: number, method: string }` | `BillingOrder` — `{ orderId, status, expiresAt, methodLabel, payment: { kind: 'crypto', address, expectedAmountSats } \| null }` | Create a premium order for a package + method; `payment` carries the address + exact amount to pay for crypto methods |
| GET | `/billing/orders/:id` | Path param `id`, no body | `BillingOrder` (same shape as above) | Poll an order's status (`PENDING`/`PAID`/`EXPIRED`/`CANCELLED`) |

### Supabase Auth

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `${SUPABASE_URL}/auth/v1/token?grant_type=password` | Log in with email/password |
| POST | `${SUPABASE_URL}/auth/v1/signup` | Sign up with email/password |
