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

There are **two separate environments** with **two separate databases**:

| Environment | Host | Database | Deployed code repo |
|---|---|---|---|
| **Production** | https://www.nosecretpolice.net | Railway Postgres (`crossover.proxy.rlwy.net` / `postgres.railway.internal`) | `Guts-Studios/roster-roster-search` |
| **Preview** | Vercel preview URL | Neon Postgres (`*.neon.tech`) | `jimmyfnc/roster-search-preview` (this repo) |

**Before running ANY migration or destructive DB script, verify which DB you're pointed at:**

```powershell
node scripts/check-target-db.cjs
```

That prints the host and identifies the provider as `Neon (preview)` or `Railway (PRODUCTION)`.

### Connecting to the preview DB (Neon)

1. `vercel link` to associate the repo with the Vercel project (one-time setup).
2. `vercel env pull` writes a `.env.local` file with `DATABASE_URL` pointing at Neon.
3. All migration scripts call `require('dotenv').config()` so they auto-pick up the file.

### Connecting to the production DB (Railway)

Only do this when intentionally migrating production. Use `railway run --service Postgres node scripts/...` which injects `DATABASE_PUBLIC_URL` from the Railway Postgres service.

**Rule of thumb**: if the migration is exploratory or in-progress, target the Neon preview. Only push to Railway production after the preview has been validated and the client has approved.