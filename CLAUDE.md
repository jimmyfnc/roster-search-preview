# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React application for searching and displaying public personnel records. It's a police accountability tool built with Vite, TypeScript, React, shadcn-ui, and Tailwind CSS, with a Railway PostgreSQL backend.

## Development Commands

- `npm run dev` - Start development server on port 8080
- `npm run build` - Build for production
- `npm run build:dev` - Build for development mode
- `npm run lint` - Run ESLint linting
- `npm run preview` - Preview production build

## Database and Migration Commands

- `npm run generate-migration` - Generate new database migration
- `npm run insert-personnel` - Insert personnel data into Railway database
- `npm run run-migration` - Run migration directly
- `npm run generate-sql` - Generate SQL insert statements
- `npm run db:push` - Push database changes to Railway

## Architecture

### Frontend Structure
- **Pages**: `/src/pages/` - Main route components (Search, ProfileDetails, Statistics, About)
- **Components**: `/src/components/` - Reusable UI components including shadcn-ui components
- **Hooks**: `/src/hooks/` - Custom React hooks for data fetching and state management
- **Types**: `/src/types/index.ts` - TypeScript interfaces, primarily Personnel interface

### Data Layer
- **Railway PostgreSQL Integration**: `/src/integrations/database/` - PostgreSQL client and type definitions
- **React Query**: Used for data fetching, caching, and state management
- **Personnel Hook**: `usePersonnel`, `usePersonnelById`, `usePersonnelSearch` for data operations
- **Advanced Personnel Hook**: `useAdvancedPersonnel` for filtered and paginated results

### Key Data Flow
1. Search page uses `useAdvancedPersonnel` hook with filters for pagination and search
2. Personnel data fetched from Railway PostgreSQL `personnel` table using raw SQL queries
3. Search supports name and badge number queries with intelligent detection (numeric = badge, text = name)
4. Results displayed with pagination using `RosterList` and `Pagination` components

### Database Schema
- Primary table: `personnel` with fields for names, badge numbers, pay information, divisions
- App configuration stored in `app_config` table with secure access patterns
- Personnel photos stored in `/public/photos/` directory with filename conventions
- PostgreSQL database with connection pooling and optimized queries

### Source data files (`public/data/`)

| File | Role |
|---|---|
| `SAPD ROSTER 202403.csv` | Original 2024 roster + payroll. Loaded into the DB as `roster_year=2024`, `payroll_year=2024`. |
| `NSP_2026_SAPD_260114_ROSTER.xlsx` | **January 2026 roster** (current source of truth). Names, badges, demographics, embedded photos. No payroll columns. Loaded as `roster_year=2026`. |
| `NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv` | **Final 2025 payroll** numbers (confirmed by camacho). The migration prefers these for 2026 records' payroll fields and stamps `payroll_year=2025`. |
| `NSP_UPDATE_SAPD_202603 - MASTER.csv` | **Historical / unused.** This was a preliminary 2025 payroll snapshot the city released in March 2026. Superseded by the final 2025 payroll CSV. Kept in the repo for archival reference but NOT consumed by `migrate-2025-2026-data.cjs`. |

### Component Architecture
- Uses shadcn-ui component library with Radix UI primitives
- Tailwind CSS for styling with custom theme colors
- React Router for navigation
- Toast notifications via Sonner

### File Path Conventions
- Components use `@/` alias for `/src/`
- UI components in `/src/components/ui/`
- Custom components in `/src/components/`
- Absolute imports preferred over relative imports

### Build and Deployment
- Vite build system with SWC for fast compilation
- Development server runs on port 8080
- Platform integration for deployment
- Environment variables for Railway PostgreSQL connection (`VITE_DATABASE_URL`)

## Environments — CRITICAL

There are **two product environments** (preview vs production) and **three DB endpoints**. Confusing them has bitten us before.

| Product env | URL | DB endpoint | Deployed code repo |
|---|---|---|---|
| **Production** (live site) | https://www.nosecretpolice.net | **Railway Postgres** (`crossover.proxy.rlwy.net` / `postgres.railway.internal`) | `Guts-Studios/roster-roster-search` |
| **Preview** (Vercel deployed) | `*-jimmyfncs-projects.vercel.app` | **Neon Postgres — Production branch** (`ep-autumn-pine-aii9iw8c...`) | `jimmyfnc/roster-search-preview` (this repo) |
| **Local dev** (`vercel dev`, scripts run from this repo) | localhost / scripts | **Neon Postgres — Development branch** (`ep-mute-queen-aiverb3d-pooler...`) | this repo |

Yes — the Vercel "Production" *environment* maps to the *Preview* product. Vercel's "Production" just means the main-branch deployment; in our case the main-branch deployment IS the preview. The Neon Vercel integration provisions a separate branch for each Vercel environment (Production / Preview / Development).

### Rule 1: Always verify the DB target before destructive operations

```powershell
node scripts/check-target-db.cjs
```

Prints the host and one of these labels:
- `Neon (preview DEV branch — safe iteration)`
- `Neon (preview PROD branch — affects deployed Vercel preview)`
- `Neon (unknown branch — INVESTIGATE before writing)`
- `Railway (PRODUCTION live site)`

Eyeball the label before running anything that writes.

### Rule 2: Local scripts target the Neon **Development** branch by default

After `vercel env pull` (no flags), `.env` contains the Development branch URL. Migration scripts call `require('dotenv').config()` and pick it up. So:

```powershell
node scripts/migrate-2025-2026-data.cjs           # hits Neon DEV branch
DRY_RUN=1 node scripts/migrate-2025-2026-data.cjs # preview-only; runs in a transaction that always rolls back
```

This is safe for iteration — it does NOT affect what your friend sees on the Vercel preview URL. Use `DRY_RUN=1` (or `--dry-run`) before any real run to confirm the summary matches expectations.

### Rule 3: To affect what the deployed Vercel preview shows, target the Neon **Production** branch explicitly

The deployed Vercel app at `*-jimmyfncs-projects.vercel.app` reads from the Vercel Production env, which is the Neon Production branch. To migrate THAT branch, use the wrapper script:

```powershell
.\scripts\run-against-vercel-prod.ps1 scripts/migrate-2025-2026-data.cjs
.\scripts\run-against-vercel-prod.ps1 scripts/snapshot-state.cjs
.\scripts\run-against-vercel-prod.ps1 scripts/verify-migration.cjs
.\scripts\run-against-vercel-prod.ps1 scripts/run-rollback.cjs
```

The wrapper pulls the Production env vars from Vercel, overrides `DATABASE_URL` inline, runs the requested script, then cleans up.

### Rule 4: Only touch Railway production after preview validation

To migrate the live Railway DB (after the Vercel preview is reviewed and approved):

```powershell
railway run --service Postgres node scripts/migrate-2025-2026-data.cjs
```

`railway run` injects `DATABASE_PUBLIC_URL` from the Railway Postgres service. Confirm the host with `check-target-db.cjs` first — it should label as `Railway (PRODUCTION)`.

**Heuristic**: iterate on Dev Neon → migrate Prod Neon → eyeball the Vercel preview with your friend → only then run against Railway production.