# Raid Notifier

Chrome extension that detects the gym you're viewing on `pokemongo.com/en/map` and lets you watch/unwatch it directly from Niantic's real map, so you get notified when a raid is available.

## Features

- Detects gyms on the live Pokémon GO web map (no separate scraping step)
- Watch/unwatch a gym from a floating panel on the map
- Log in / sign up (Supabase auth)
- Link Telegram for notifications
- Free tier watch limit indicator

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

All requests below go to `API_BASE_URL` (from `.env`) with an `Authorization: Bearer <accessToken>` header, except auth which goes straight to Supabase. Called from `src/background.ts`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/gyms/watched` | List the gyms the current user is watching |
| POST | `/gyms/watch-by-scopely-id` | Watch a gym |
| DELETE | `/gyms/watch-by-scopely-id/:scopelyGymId` | Unwatch a gym |
| POST | `/gyms/discover-by-scopely-id` | Report a gym seen on the map (feeds the gym database, independent of watching) |
| GET | `/user/me` | Get account info (`isPremium`, `linkedChannels`) |
| PATCH | `/user/me` | Update the user's timezone (sent on every login/signup) |
| POST | `/notifications/telegram/link-code` | Get a deep link to link a Telegram account |

### Supabase Auth

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `${SUPABASE_URL}/auth/v1/token?grant_type=password` | Log in with email/password |
| POST | `${SUPABASE_URL}/auth/v1/signup` | Sign up with email/password |
