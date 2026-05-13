# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-05-13

Note: the 4.0.0 entry below describes a migration that was deployed, then rolled
back before this branch ever shipped. The 5.0.0 changes are the actual deployed
preview migration; the 4.0.0 scripts (`migrate-2026-schema.sql`,
`migrate-2026-roster.cjs`, `rollback-2026.sql`) are superseded.

### Added
- **Unified 2025/2026 Migration**: New `scripts/migrate-2025-2026-data.cjs` takes
  the pre-2026 baseline to a three-year versioned dataset (2024 + 2025 + 2026)
  in one transaction. 1004 total rows, 447 `is_current=true` under a
  latest-record-per-person rule.
- **2025 Payroll Data**: Imported final 2025 payroll numbers (336 records),
  joined to 2024 roster by name with middle-initial-stripping; preferred over
  2024 carry-forward when populating 2026 records' payroll fields.
- **2026 January Roster**: Imported `NSP_2026_SAPD_260114_ROSTER.xlsx` (350
  records) including 31 redacted entries; 310 embedded photos extracted to
  WebP via `sharp`. Includes `rank_title` (e.g. "Police Officer (Detective)")
  in addition to the existing `classification` field.
- **`payroll_year` column**: Tracks which year's payroll data each record
  reflects. Surfaced on profile pages as a per-record disclaimer that reads
  "Payroll data is current as of {year}" or "No payroll data available for
  this record."
- **DRY_RUN flag**: `DRY_RUN=1` (or `--dry-run`) on the migration script runs
  the full transaction and then rolls back — safe preview before a real run.
- **Cross-platform XLSX parsing**: `xlsx-helper.cjs` now uses `adm-zip`
  instead of `powershell.exe`. Works on macOS/Linux/WSL.
- **DB target safety**: `scripts/check-target-db.cjs` distinguishes Neon Dev
  branch (safe iteration) from Neon Prod branch (affects deployed preview)
  before any destructive run.
- **Vercel Production wrapper**: `scripts/run-against-vercel-prod.ps1` pulls
  the Production env from Vercel CLI, sets `DATABASE_URL` inline, runs any
  script against the Neon Prod branch, then cleans up. Stores the temp env
  file in the OS temp dir (not the repo) so an interrupted run can't leave
  credentials in the git tree.
- **Verification invariants**: `scripts/verify-migration.cjs` asserts two SQL
  invariants — for every named person, `is_current=true` is on the row with
  the highest `roster_year`; and `payroll_year` is set if and only if at
  least one pay field is non-null.

### Changed
- **`is_current` rule**: One `is_current=true` row per unique stripped name
  (latest year wins) rather than one full year being current. The site
  surfaces ~447 records — the most current record for each person across all
  three years.
- **`is_current` column default**: now `false` (was `true`) so the schema
  migration can't accidentally leave everyone marked current if the data
  migration doesn't run.
- **Phase B classification normalization**: 2025 records use `baseRank()` to
  strip parenthesized qualifiers like "(Temp Up)" / "(RM)" before insert,
  matching 2024 conventions.
- **Photo-resolution effect** (ProfileCard, ProfileDetails): probes all URL
  variations in parallel via `Promise.any()` with cancellation cleanup,
  replacing the sequential per-variation waterfall.
- **About page copy**: payroll currency is described per-record (range
  2024–2025) rather than a single static year.
- **Profile error copy**: replaced misleading "Access Denied — You need to
  be authenticated" with neutral "Unable to load record" (this is a public
  tool with no auth wall).
- **Height display**: stored as 3-digit strings ("511", "601") and formatted
  to `5'11"`, `6'1"` at render time.
- **`.gitignore`**: hardened with `.env`, `.env.local`, `.env.production`,
  `.env*.local`, `.env.vercel*`, `.vercel`, and `.claude/`. Untracked the
  previously-tracked `.claude/settings.local.json`.

### Fixed
- **SPA reload 404**: `vercel.json` now adds a filesystem handler + fallback
  to `index.html` so React Router routes survive a hard reload at any URL.
- **Migration idempotency**: Phase A wipes pre-existing 2025/2026 rows before
  re-insert; the script is safe to re-run against any prior state.
- **Batched inserts**: ~700 sequential `INSERT` round-trips collapsed to ~7
  multi-row inserts (~10s wall-clock savings on Neon).
- **Zip-slip guard**: `readImageAnchors` validates that resolved image paths
  stay within the extracted directory before `sharp` opens them.
- **PowerShell wrapper**: validates `$LASTEXITCODE` after `vercel env pull`
  instead of suppressing output; constrains script path to `scripts/`
  prefix.
- **Phase D partition key**: matches JS `norm()`/`stripMiddle()` exactly
  (collapse internal whitespace) so name-key fragmentation can't cause
  duplicate `is_current` rows.

### Technical
- New partial expression index `idx_personnel_name_stripped` matching the
  Phase D `PARTITION BY` for scale.
- `package.json`: added `adm-zip` runtime dependency.
- Source data files added: `NSP_2026_SAPD_260114_ROSTER.xlsx`,
  `NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv`. The older
  `NSP_UPDATE_SAPD_202603 - MASTER.csv` is preserved for archival only and is
  NOT consumed by the current migration.

## [4.0.0] - 2026-02-23

### Added
- **2026 Roster Migration**: Migrated 350 personnel records from March 2026 SAPD roster data
- **Historical Versioning**: Added `roster_year` and `is_current` columns for year-over-year data retention
- **Demographic Fields**: Added gender, ethnicity, height, weight, and year of hire to personnel records
- **Personal Details Section**: New section on profile pages displaying demographic information
- **69 New Photos**: Extracted and converted personnel photos from roster spreadsheet (WebP format)
- **CSV Header Validation**: Migration script now validates expected column headers before processing
- **Migration Scripts**: `scripts/migrate-2026-schema.sql` and `scripts/migrate-2026-roster.cjs` for reproducibility

### Changed
- **API Endpoints**: All query endpoints now filter by `is_current = true` to show only current roster
- **Disclaimers**: Profile cards and detail pages now differentiate roster year vs payroll year
- **Profile Cards**: Consistent card heights with flex layout; proper number formatting with commas
- **About Page**: Removed embedded search functionality (dead code cleanup); page is now static content only
- **About Page**: Updated one-time donation link to Ko-fi (`ko-fi.com/inadvertent`)
- **About Page**: Updated data currency text to reflect 2026 roster / 2024 payroll

### Fixed
- **Security**: Parameterized LIMIT/OFFSET in search endpoint to prevent DoS via unbounded queries
- **Security**: Removed duplicate `GET /api/personnel/:id` route (dead code)
- **Error Handling**: `usePersonnelById` now properly surfaces server errors instead of swallowing them
- **Number Formatting**: Base Pay and Overtime display with proper comma separators
- **Accessibility**: Fixed inverted h2/h3 heading hierarchy on profile details page
- **Type Safety**: Added `Number()` coercion for pay field visibility guards (handles string DB values)

### Technical
- 318 historical (2024) records preserved with `is_current=false`
- Composite unique constraint on `(badge_number, roster_year)` supports multi-year data
- 10 existing PNG photos converted to WebP for consistency

## [3.0.0] - 2025-08-05

### 🚀 MAJOR: Database Migration to Railway PostgreSQL

#### Database Infrastructure Overhaul
- **BREAKING CHANGE**: Migrated from Supabase to Railway PostgreSQL
- **New Database Client**: Replaced Supabase client with direct PostgreSQL client (`pg`)
- **Data Preservation**: Successfully migrated 318 personnel records and app configuration
- **Connection Pooling**: Implemented efficient connection pooling for better performance
- **Type Safety**: Enhanced TypeScript support with generic database query methods

#### Backend Architecture Changes
- **Database Client**: [`src/integrations/database/client.ts`](src/integrations/database/client.ts) - New Railway PostgreSQL client
- **Query Methods**: Added `queryOne<T>()`, `queryMany<T>()`, and `transaction()` methods
- **Error Handling**: Comprehensive database error management and connection retry logic
- **Performance**: Optimized queries with parameterized statements and connection pooling

#### Code Migration
- **All Data Hooks Updated**:
  - [`useAdvancedPersonnel.ts`](src/hooks/useAdvancedPersonnel.ts) - Main search functionality converted to SQL
  - [`useAllPersonnel.ts`](src/hooks/useAllPersonnel.ts) - Full roster pagination with SQL queries
  - [`usePersonnel.ts`](src/hooks/usePersonnel.ts) - Basic personnel queries migrated
  - [`usePersonnelStats.ts`](src/hooks/usePersonnelStats.ts) - Statistics aggregation in SQL
- **Authentication System**: [`src/utils/auth.ts`](src/utils/auth.ts) updated for Railway compatibility
- **Data Loading**: [`src/utils/loadPersonnelData.ts`](src/utils/loadPersonnelData.ts) converted to raw SQL

#### Environment & Configuration
- **Environment Variables**: Added `VITE_DATABASE_URL` for Railway connection
- **Configuration Files**: Created [`.env`](.env) and [`.env.example`](.env.example)
- **Database Schema**: PostgreSQL-optimized schema with proper indexing

#### Dependencies
- **Removed**: `@supabase/supabase-js` and all Supabase dependencies
- **Added**: `pg` and `@types/pg` for PostgreSQL connectivity
- **Cleaned Up**: Removed unused authentication hooks and Supabase integration files

#### Performance & Scalability Improvements
- **Direct SQL Queries**: Replaced query builder with optimized parameterized SQL
- **Connection Management**: Efficient connection pooling with Railway PostgreSQL
- **Query Optimization**: Server-side pagination, filtering, and sorting
- **Type Safety**: Full TypeScript support with generic query methods

#### Migration Details
- **Database Connection**: `postgresql://postgres:***@crossover.proxy.rlwy.net:35280/railway`
- **Data Integrity**: 100% data preservation during migration
- **Testing**: Comprehensive testing of all functionality post-migration
- **Zero Downtime**: Seamless migration with backward compatibility during transition

#### Files Changed
- `src/integrations/database/` - New Railway database integration
- `src/hooks/` - All data hooks converted to Railway
- `src/utils/auth.ts` - Authentication utilities updated
- `src/utils/loadPersonnelData.ts` - Data loading functions migrated
- `package.json` - Updated dependencies
- Environment configuration files

#### Testing & Verification
- ✅ Database connectivity verified
- ✅ All search functionality working
- ✅ Statistics and analytics operational
- ✅ Authentication system functional
- ✅ Mobile responsiveness maintained
- ✅ Performance benchmarks met or exceeded

This major version represents a complete infrastructure overhaul while maintaining all existing functionality and user experience. The migration to Railway PostgreSQL provides better performance, reliability, and scalability for the application.

## [2.0.0] - 2025-07-14

### Added
- **Redaction Font Integration**: Implemented complete Redaction font family with multiple weights
  - Added Redaction Regular, Bold, and Italic variants
  - Added Redaction 10 (light weight) for subtle styling
  - Applied font universally across all elements including headings, inputs, and buttons
  - Added proper font-display: swap for performance
- **Logo Integration**: Added clickable logo functionality
  - Centered logo in navigation header
  - Added hover effects and proper linking to home page
  - Logo sourced from `/logo/logo.webp`
- **Full Roster Page**: Created new comprehensive personnel directory
  - Complete personnel listing with pagination
  - Accessible via `/roster` route
  - Uses `useAllPersonnel` hook for data fetching
  - Responsive design with mobile optimization
- **Enhanced About Page**: Major content and functionality updates
  - Added comprehensive project background and history
  - Integrated search functionality directly in About page
  - Added hyperlinks to external resources (Inadvertent Substack, Ben Camacho's site)
  - Detailed explanation of public records process and legal battles
- **Input Field Visibility**: Enhanced form accessibility
  - Added permanent black outlines (2px solid #000000) to all input fields
  - Improved visibility across all input types (text, email, password, etc.)
  - Maintained focus and hover states with consistent black borders

### Changed
- **Color Scheme Overhaul**: Migrated from yellow accents to black-based design
  - Updated accent colors from yellow (#f59e0b) to black (#000000)
  - Changed hover states to darker black (#1a1a1a)
  - Maintained warm cream backgrounds with improved contrast
  - Updated all CSS custom properties for consistency
- **Navigation Improvements**: Enhanced header layout and spacing
  - Improved mobile responsiveness
  - Better logo positioning and navigation item spacing
  - Enhanced hamburger menu functionality
- **Typography System**: Complete font integration
  - Replaced system fonts with Redaction font family
  - Improved readability and visual consistency
  - Better font weight hierarchy (300, 400, 600, 700)

### Technical Improvements
- **Font Loading Optimization**: Implemented efficient font loading strategy
  - Added font-display: swap for better performance
  - Organized font variants by weight and style
  - Comprehensive fallback font stack
- **Component Architecture**: Enhanced component structure
  - Added `FullRoster.tsx` page component
  - Updated `App.tsx` routing for new pages
  - Improved navigation component with logo integration
- **CSS Architecture**: Streamlined styling system
  - Updated CSS custom properties for new color scheme
  - Enhanced input styling with permanent borders
  - Improved responsive design patterns

### Files Modified
- `src/index.css` - Complete font integration and color scheme updates
- `src/pages/About.tsx` - Major content updates and search integration
- `src/pages/FullRoster.tsx` - New page for complete personnel directory
- `src/components/Navbar.tsx` - Logo integration and navigation improvements
- `src/App.tsx` - Updated routing for new pages
- `public/font_kit/` - Added complete Redaction font family
- `public/logo/logo.webp` - Added project logo

### Dependencies
- No new dependencies added
- Enhanced existing font loading capabilities

## [1.0.0] - 2025-01-07

### Added
- **Landing Page**: Created a new professional home page with hero section, feature cards, and call-to-action buttons
- **Password Protection**: Implemented secure authentication system for Search and Statistics pages
  - Uses "WatchtheWatchers2024!" password stored securely in Supabase with SHA-256 hashing
  - Fallback authentication when Supabase is unavailable
  - Password visibility toggle for better UX
- **Database Security**: Created app_config table with Row Level Security (RLS) policies
- **Navigation Updates**: Added Home, Search, Statistics, and About tabs to navigation
- **Logout Functionality**: Added logout buttons to protected pages

### Changed
- **Color Scheme**: Updated entire application to use Inadvertent Substack color palette
  - Warm cream/beige backgrounds (#F5F2E8)
  - Dark text for better readability (#2D2520)
  - Yellow/orange accents (#E6B800) replacing previous orange theme
  - Updated all components, pages, and UI elements for consistency
- **Page Structure**: Converted original home page to password-protected "Search" page
- **Authentication Flow**: Enhanced security with proper password hashing and verification
- **UI Components**: Updated all cards, buttons, and interactive elements with new color scheme

### Technical Improvements
- **Database Migration**: Added migration for secure password storage
- **TypeScript Types**: Updated Supabase type definitions for new app_config table
- **CSS Variables**: Implemented comprehensive CSS custom properties for theming
- **Tailwind Config**: Updated color palette and removed old police theme colors
- **Component Consistency**: Ensured all components use semantic color classes

### Security
- **Password Hashing**: Implemented SHA-256 with custom salt for secure password storage
- **Database Security**: Added Row Level Security policies to protect sensitive data
- **Authentication State**: Proper session management and logout functionality

### Files Modified
- `src/index.css` - Updated color scheme and CSS variables
- `src/pages/Home.tsx` - New landing page with professional design
- `src/pages/Search.tsx` - Added password protection to search functionality
- `src/pages/Statistics.tsx` - Added password protection to statistics page
- `src/components/Navbar.tsx` - Updated navigation and color scheme
- `src/pages/About.tsx` - Updated colors and styling
- `src/pages/ProfileDetails.tsx` - Updated color scheme
- `src/pages/Index.tsx` - Updated color scheme
- `src/components/RosterList.tsx` - Updated color scheme
- `src/components/ProfileCard.tsx` - Updated color scheme
- `tailwind.config.ts` - Updated color palette and fixed ESLint issues
- `src/utils/auth.ts` - New authentication utilities
- `supabase/migrations/20240107000000_create_app_config.sql` - Database migration
- `src/integrations/supabase/types.ts` - Updated TypeScript definitions

### Dependencies
- No new dependencies added
- Fixed ESLint configuration in Tailwind config

## [0.0.0] - Initial Version
- Basic personnel database functionality
- Search and filter capabilities
- Profile details and statistics
- Original police-themed color scheme