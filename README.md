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
| `npm run e2e` | End-to-end tests: real Chrome, three signed-in users, a full draft with waivers, and an auction. Needs `.env.local`. Creates `@e2e.invalid` users and `E2E…` rooms and removes them again (`npm run e2e:cleanup` if a run was cut short) |
| `npm run db:test` | Database rule tests against `SUPABASE_DB_URL` (rolled back, nothing persists) |
| `npm run db:apply` | Apply `supabase/*.sql` in order, in one transaction. Add `-- --dry` to roll back |
| `node scripts/import-smat2026.cjs <xlsx>` | Rebuild the SMAT 2026 draft pool seed from the squad spreadsheet |
| `node scripts/import-ilt20-2026.cjs <xlsx>` | Rebuild the ILT20 2026 auction list and draft pool seed |

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
- **Events tab**: the dashboard has two tabs, IPL Auction and Events. Events lists tournaments with their own player lists (`lib/events.ts`): **ILT20 2026** (142 players, 6 franchises) can be played as an auction or a draft, chosen when creating the room; **SMAT 2026** is draft only. An ILT20 auction is a normal auction room on `player_inventory.inventory_type = 'ILT20_2026'`, with the sheet's own ₹ base prices (50 L / 1 Cr / 2 Cr; not official) and all the usual rules. Players whose role the sheet marks Unknown are stored as `UNK`. To refresh ILT20, run `node scripts/import-ilt20-2026.cjs <ILT20_2026_Squads_Roles_BasePrice.xlsx>` and `npm run db:apply`.
- **Drafts** (`/draft/[id]`, from an event on the Events tab): no money, no bidding. 3 to 10 teams join with a room ID and key. The host spins a wheel; each spin gives the next pick position to a random team still on the wheel, and the last team left takes the last position. Picks then snake (1, 2, 3 … 3, 2, 1 …) from one shared pool of 544 Syed Mushtaq Ali Trophy players until every team has its picks (1–30, default 15). Only the team on the clock may pick; the host can pick for an absent team and undo the last pick. Rules are in `lib/draft.ts` and enforced by `supabase/draft.sql`. To refresh the pool when squads change, run `node scripts/import-smat2026.cjs <SMAT_2026_27_Players.xlsx>` and then `npm run db:apply`.
- **Drafts, extras**: members keep a private wishlist (☆ in the pool, ordered under “My list”). A room can set a pick timer (15–600 s); when a turn runs out the database picks for that team: the top available wishlist player, else the most points. Optional turn chime, the screen stays awake while drafting, and the pool shows each player's points. Hosts get tools to fix a pick, add a missing player and reset points (`supabase/draft_admin.sql`).
- **Team identity**: in a draft, 🎨 My team gives your team a name, emoji and colour, shown on the board, team cards, wheel, latest pick and leaderboard (`draft_set_team_identity`).
- **Captains** (host opt-in per draft, in Host tools): each team picks a Captain (2× points) and a Vice-captain (1.5×) from its own players. The bonus is the extra 1× / 0.5× of points those players gain at each nightly update and is added to the team's score; a new choice is pending until the next update, so it only counts for points earned after it and can't be switched to a player who already scored. Switching captains on mid-draft applies from then on, never backwards, and resetting a draft's points clears the bonuses (`supabase/draft_teams.sql`).
- **Waivers (free agency)**: a host switches waivers on for a finished draft (Host tools). Each team keeps up to 3 ranked claims ("add free agent Y, drop my player X"). Claims run once a week, in Monday's nightly update (or at once with "Run claims now"): the lowest-ranked team goes first, ties go to the team that drafted last, and each team gets at most one swap, its first claim still possible. The dropped player returns to the pool; what they earned for the team stays in its score ("banked") and the new player counts only from the swap; a dropped Captain is cleared. Other teams see a claim only once it has won. Rules and numbers live in `supabase/draft_waivers.sql`.
- **Your day**: after each nightly update Home shows a recap per draft (rank, places moved, points gained, best player, who you passed and who passed you) and a **Share recap** button that draws a picture (canvas, in the browser) and shares it, or downloads it and copies a summary on laptops (`lib/recap.ts`, `lib/shareImage.ts`).
- **Invite links**: `/join#code=…&key=…` joins a draft or auction room in one tap; the code and key sit in the URL fragment, which is never sent to the server.
- **Auction leaderboards**: auction rooms on a list with a points source (ILT20) get the same fantasy leaderboard as drafts (🏆 link in the room, Home, Leaderboard tab). A bought player counts only from the sale (a trigger on `user_squads` stores his points at that moment); players are matched to the points pool by team and name. The nightly job snapshots each room's standings for the ▲/▼ and "+points" (`supabase/auction_fantasy.sql`).
- **Is the nightly update healthy?** `/api/health/points` answers 200 when every points source updated in the last 30 hours and 503 when a night was missed (counts and times only, safe to leave public). Point an uptime monitor at it, or set the `APP_URL` repository variable (GitHub → Settings → Secrets and variables → Actions → Variables) to switch on `.github/workflows/points-watchdog.yml`, which checks every morning at 04:00 IST and emails you when it fails. The update itself refuses a points page that looks broken (far fewer rows than last time, or everything at zero) instead of overwriting good totals.
- **Fantasy leaderboard** (dashboard → Leaderboard → Events, and `/leaderboard/[id]`): every night at 2:00 am IST a Vercel Cron job (`vercel.json`, `app/api/cron/sync-points`) reads each event's points page (ILT20: Statz performance points, configured in the `fantasy_sources` table), matches players to the draft pool by name and team, and stores season totals plus a daily snapshot of each player and of every draft's standings. A team's score is the sum of its players' points. The board shows 🥇🥈🥉 for the top three, ▲/▼ places moved and points gained since the previous day; tap a team for its players. Points a player already had when a draft began can be excluded with `node scripts/set-draft-baseline.cjs <room code> --apply` (stored in `draft_point_offsets`; used for ILT202026_405, whose first match was played during the draft). Players the job could not match are logged in `points_sync_log` (add a spelling to `NAME_ALIASES` in `lib/fantasyPoints.ts`). Needs `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` on Vercel. Run it by hand with `node scripts/sync-points.cjs` (`--dry` to only print matches). On the Hobby plan Vercel only guarantees the hour (20:00–20:59 UTC, i.e. 1:30–2:30 am IST); either way the snapshot counts for the new day.
- **Insights tab**: five fixed charts (purse vs slots, roles, spend concentration, premium, timeline) and a rule-based strategy label, computed in `lib/insights.ts`.

## Code map

```
app/(app)/layout.tsx                     app shell for signed-in pages (session check, top bar, page width)
app/(app)/dashboard                      Home: your rooms, your standings, events
app/(app)/events, join, leaderboard      Events (IPL, ILT20, SMAT), join any room / invite links, leaderboards
app/(app)/room/[id], draft/[id]          auction room, draft room
app/dev/*-preview                        development-only previews of the draft room and leaderboard with sample data
components/ui                            shared Card, Button, Segmented tabs, Badge, PageHeader
components/draft, leaderboard, room      screens; DraftRoomView and LeaderboardBoard draw from props only
hooks/                                   useRoomSync (auction live sync), useWakeLock, useTurnSound, useSecondsLeft, …
lib/                                     rules and pure helpers (tested): bidSlabs, purse, draft, events, fantasyPoints, invite, …
supabase/*.sql                           database functions and policies (see docs/DATABASE.md)
tests/                                   Vitest
```

## Screens and sizes

Signed-in pages share one shell and grow with the screen (up to 1600px). The draft room shows one panel at a time on phones, the pool beside the teams on laptops, and pool, teams and the live pick feed on wide screens. Check layouts without signing in at `/dev/draft-preview?state=lobby|drafting|done` and `/dev/leaderboard-preview` (development only).

## Security model

The browser may only: create a room, join through `join_room`, set its own `ready_to_start`, and read rooms it belongs to. Every change to money, squads, bids and sales goes through `SECURITY DEFINER` functions that check the caller. See `supabase/security_hardening.sql`. Room keys are visible only to members.

## Database

See [docs/DATABASE.md](docs/DATABASE.md). Old guides are kept in `docs/archive/` for reference and may be out of date.
