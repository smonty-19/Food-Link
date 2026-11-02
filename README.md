# FoodLink

A surplus food redistribution platform for Bengaluru. Restaurants, caterers and canteens list leftover food;
shelters, orphanages and community kitchens nearby claim it before it expires.

DBMS mini project, PES University, Group 19:
Shreyas Mohanty (PES2UG24CS491, Part A) and Shreya Ajith (PES2UG24CS480, Part B).

The project is about the database. PostgreSQL holds every piece of business state and enforces every rule.
The web app is a thin layer on top.

## Architecture

```
 Browser ──► Next.js (Server Components + Server Actions, Node runtime)
                │
                ├── foodlink_web role (least privilege, row-level security)
                │      └── PostgreSQL ── triggers · stored functions/procedures · RLS · views · MV
                │                            │
                │                            └── vector_sync_outbox (written by triggers)
                │                                      │
                ├── outbox worker (FOR UPDATE SKIP LOCKED) ──► Qdrant  { id, vector } only
                │
                └── foodlink_dba role (admin pages: reports, MV refresh, demo setup)

 Matching:  requirement text ──► MiniLM embedding (local) ──► Qdrant top-K IDs
                                                         ──► find_matching_donations() in Postgres
                                                             (available, unexpired, diet, capacity,
                                                              not own org, within radius)
```

Qdrant holds only `{ donation_id, embedding }`, with no payload. Status, quantity and expiry change faster
than a vector index can follow, so Postgres re-validates every candidate. A stale vector is harmless by design.

## Database objects (where to look)

| File | What's in it |
|---|---|
| `db/review2.sql` | Review 2 script: DDL changes, seed data, queries, views, materialized view, functions, procedures, triggers, roles, RLS, tests, negative tests |
| `db/app_support.sql` | `sessions` table, `browse_available_donations()`, `donation_timeline()` (SECURITY DEFINER), demo-only functions |
| `db/reports.sql` | Showcase analytics: window functions, running totals, CTE, FILTER aggregates, `EXPLAIN` on a partial index |
| `db/reset.ps1` | Re-seeds everything (data timestamps are relative to `now()`) and rebuilds the Qdrant index |

### Advanced features checklist

| Feature | Where |
|---|---|
| Two database paradigms (relational + vector) | Postgres + Qdrant, thin-vector pattern, transactional outbox |
| Row-level locking / concurrency control | `allocate_donation()` (`SELECT … FOR UPDATE`), demo at `/admin/demo` |
| Triggers | lifecycle state machine, auto-expiry, status history, outbox, allocation and pickup rules |
| Stored functions and procedures | `allocate_donation`, `find_matching_donations`, `create_donation`, `confirm_receipt`, … |
| Row-level security + roles | `foodlink_app` / `foodlink_admin` / `foodlink_analyst`, policies on allocations, pickups, requirements |
| Views + materialized view | `v_available_donations`, `v_allocation_details`, `mv_donor_impact` (refreshed `CONCURRENTLY`) |
| Index variety | partial, expression, composite, GIN (array + full-text), BRIN, partial unique |
| Integrity | CHECK constraints, FKs with deliberate `ON DELETE` rules, enum |
| SECURITY DEFINER with pinned `search_path` | `donation_timeline()` |
| `FOR UPDATE SKIP LOCKED` work queue | `src/lib/vector-sync.ts` |

## Running it locally (Windows)

Requirements: PostgreSQL 17+ with the `foodlink` database from Review 1, Node.js 20+, and Qdrant.

```powershell
# 1. database (asks for the postgres password)
psql -U postgres -d foodlink -f db/review2.sql
psql -U postgres -d foodlink -f db/app_support.sql

# 2. Qdrant: download qdrant-x86_64-pc-windows-msvc.zip from
#    https://github.com/qdrant/qdrant/releases, unzip, and run qdrant.exe (port 6333)

# 3. app
copy .env.example .env
npm install
npm run qdrant:init        # create the collection and embed live listings
npm run dev -- -p 3001     # http://localhost:3001
```

To reset to fresh demo data later: `powershell -ExecutionPolicy Bypass -File db\reset.ps1`.

Demo accounts (seed data):

| Role | Email | Password |
|---|---|---|
| Donor | ravi@annapoorna.in | Ravi@123 |
| Recipient | anita@akshaya.org | Anita@123 |
| Recipient | joseph@hopefoundation.org | Joseph@123 |
| Admin | admin@foodlink.app | Admin@123 |

Seed users carry SHA-256 hashes from Review 2. On first login they are upgraded to bcrypt.

## The concurrency demo

`/admin/demo` (or `npm run race` as a CLI backup) creates a fresh listing and makes up to 12 recipient
organizations claim it at the same instant. Each claimer has its own connection on the web role, with its
own organization set for RLS.

- **Safe** (`allocate_donation`, `FOR UPDATE`): claimers queue on the row lock. One wins; latency climbs
  claimer by claimer; the rest get a clean "not available".
- **Unsafe** (`allocate_donation_unsafe`, no lock): every claimer passes the read-then-write check.
  The database still refuses a second allocation, through trigger B.T1's status re-check or, for inserts
  that truly overlap, the partial unique index `idx_allocations_one_active` (`23505`).

Two-browser version: set `DEMO_CLAIM_DELAY_MS=3000` in `.env`, restart, and claim the same listing as two
different recipients. The second browser waits about 3 seconds, then gets "Another organization has just
been allocated this listing."

## Expiry in three layers

1. Trigger A.T1 expires a listing on any write after its deadline.
2. A background job calls `expire_stale_donations()` every 60 s (`src/instrumentation.ts`).
3. Every read and allocation checks `expires_at > now()`.

Layer 3 alone guarantees correctness; layers 1 and 2 keep the stored status honest for reports.
