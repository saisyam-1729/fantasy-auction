# IPL Fantasy Auction

Live multiplayer cricket auction. Next.js (App Router) + Supabase (Auth, Postgres, Realtime).

Players join a room with an ID and key, bid in real time on IPL players against a purse, and build a squad.

## Run it

```bash
npm install
cp env.local.template .env.local   # fill in the Supabase values
npm run dev                        # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest unit tests (rules and insights) |
| `npm run build` | Production build (works without Supabase env) |
| `npm run db:test` | Database rule tests against `SUPABASE_DB_URL` (rolled back, nothing persists) |
| `npm run db:apply` | Apply `supabase/*.sql` in order, in one transaction. Add `-- --dry` to roll back |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every push and PR.

## Auction rules

Money is in rupees (1 L = 100,000, 1 Cr = 10,000,000). Rules live in `lib/` and are enforced again in the database.

- **Bid slabs** (`lib/bidSlabs.ts`): under ₹2 Cr raise by ₹10 L; ₹2–5 Cr by ₹20 L; above ₹5 Cr by ₹25 L. A step that would cross ₹2 Cr or ₹5 Cr lands exactly on it.
- **Squad size** (`lib/purse.ts`): minimum 12, maximum 15 by default; the host sets both (1–30) before starting.
- **Purse lock**: a bid may fill one slot; money is reserved only for the *other* slots still needed to reach the minimum, at the cheapest other unsold base price. At the maximum, no more bids.
- **Selling**: the host presses Hammer or Pass. Optionally a room can enable **auto-sell**: 30 s after the last bid any member's browser asks the database to sell to the top bidder (exactly once). Lots with no bids still wait for the host.
- **Pause, Close and away**: the host can Pause, or **Close auction** with an optional message every player sees (resume later). If a player who was connected drops for 45 s the database pauses the auction ("a player disconnected"); the host resumes manually. Each browser sends a heartbeat every 10 s while a lot is live.
- **Other tabs**: a slim live bar (lot, bid, holder, timer, Bid button) stays on screen while browsing squads or insights.
- **Player photos**: freely licensed Wikipedia/Wikimedia Commons photos are stored in `public/players` (87 of 250 players); everyone else shows initials on their franchise colour. `node scripts/fetch-player-images.cjs` reports coverage, `--download` fetches matches, `--apply` updates `player_inventory.image_url`; approve near-matches in `data/player-images.overrides.json`. Licences and photographers are listed at `/credits`.
- **Error logging**: uncaught browser errors and page crashes are sent to `/api/log-error` and written to the server log as `[client-error] {...}`. On Vercel, open the project, then Logs, and search for `client-error`. Nothing is stored; reports are size-capped, query strings are dropped, and callers are rate limited. A friendly error screen replaces a blank crash.
- **Cleaning up rooms**: every room copies the 250-player list, so old rooms add up. The owner can press **Delete room** in the host panel. `npm run db:cleanup` lists rooms idle for 30+ days (`-- --days 14` to change), and only deletes them with `-- --apply`. It is a dry run by default.
- **Auction by sets**: the host can choose lot order "By sets": Marquee (base ₹3 Cr and up), then Batters, All-rounders, Wicketkeepers, Bowlers, then Emerging (₹20 L base), high to low inside each set. The lot card shows the set and how many are left in it. Defined in `lib/sets.ts` and `supabase/auction_sets.sql`.
- **Room settings**: when creating a room the host can set the starting budget (default ₹100 Cr), the lot timer (10–120 s, default 30) and the bid steps (two thresholds and three steps, default 10 / 20 / 25 L under ₹2 Cr and ₹5 Cr). They are stored on the room (`budget`, `bid_timer_seconds`, `slab_config`), enforced by the database, and apply to bidding, the countdown, auto-sell and the "going once" call. Settings are fixed once a room is created.
- **Insights tab**: five fixed charts (purse vs slots, roles, spend concentration, premium, timeline) and a rule-based strategy label, computed in `lib/insights.ts`.

## Code map

```
app/auth, app/dashboard, app/room/[id]   pages (room page holds state, realtime, bidding)
components/room/*                        My Squad, Leaderboard, Players, Squad boards
components/InsightsPanel.tsx             Insights charts
lib/bidSlabs.ts  lib/purse.ts            rules
lib/insights.ts  lib/squadBoards.ts      derived numbers (pure, tested)
lib/roomTypes.ts lib/money.ts            shared types and formatting
supabase/*.sql                           database functions, policies (see docs/DATABASE.md)
tests/                                   Vitest
```

## Security model

The browser may only: create a room, join through `join_room`, set its own `ready_to_start`, and read rooms it belongs to. Every change to money, squads, bids and sales goes through `SECURITY DEFINER` functions that check the caller. See `supabase/security_hardening.sql`. Room keys are visible only to members.

## Database

See [docs/DATABASE.md](docs/DATABASE.md). Old guides are kept in `docs/archive/` for reference and may be out of date.
