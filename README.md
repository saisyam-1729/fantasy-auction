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
| `npm run db:apply` | Apply `supabase/*.sql` in order, in one transaction. Add `-- --dry` to roll back |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every push and PR.

## Auction rules

Money is in rupees (1 L = 100,000, 1 Cr = 10,000,000). Rules live in `lib/` and are enforced again in the database.

- **Bid slabs** (`lib/bidSlabs.ts`): under ₹2 Cr raise by ₹10 L; ₹2–5 Cr by ₹20 L; above ₹5 Cr by ₹25 L. A step that would cross ₹2 Cr or ₹5 Cr lands exactly on it.
- **Squad size** (`lib/purse.ts`): minimum 12, maximum 15 by default; the host sets both (1–30) before starting.
- **Purse lock**: a bid may fill one slot; money is reserved only for the *other* slots still needed to reach the minimum, at the cheapest other unsold base price. At the maximum, no more bids.
- **Selling**: the host presses Hammer or Pass. Optionally a room can enable **auto-sell**: 30 s after the last bid any member's browser asks the database to sell to the top bidder (exactly once). Lots with no bids still wait for the host.
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
