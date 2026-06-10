# LinkedIn X-Ray Search — Design Spec

## Overview

A local tool that scrapes public LinkedIn profiles via Google Custom Search API using healthcare/AI keywords. Monorepo with a Next.js + TypeScript frontend and Python FastAPI backend. Results accumulate in SQLite across sessions. Outputs to downloadable Excel.

## Project Structure

```
linkedin-xray-search/
├── frontend/              # Next.js + TypeScript + Tailwind
│   ├── src/
│   │   ├── app/           # App router pages
│   │   ├── components/    # UI components
│   │   ├── lib/           # API client, types, utils
│   │   └── hooks/         # Custom React hooks
│   ├── package.json
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI app + CORS
│   │   ├── routers/       # search, export, settings, quota
│   │   ├── services/      # google_search, excel_export
│   │   ├── models.py      # Pydantic schemas
│   │   ├── database.py    # SQLite setup + queries
│   │   └── config.py      # Settings resolution (.env → DB)
│   ├── logs/              # Rotating log files
│   ├── requirements.txt
│   └── data.db            # SQLite database (gitignored)
├── .env                   # Initial API credentials seed
├── .gitignore
└── README.md
```

## Architecture

**Approach:** Direct API Proxy with SSE streaming.

**Data flow:** Browser → Next.js → FastAPI (`POST /api/search` via SSE) → Google Custom Search API → SQLite → Browser.

**Credential resolution order:** `.env` on first run → user updates via UI Settings panel → stored in SQLite `settings` table → DB values take precedence over `.env` on all subsequent reads.

**Search trigger:** Manual only — user clicks "Scan" button. No auto-search on server start.

**Result accumulation:** Each search run appends to the SQLite database. Duplicate profiles (same URL) get their keywords merged.

## Backend (Python FastAPI)

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/search` | POST | Accepts `{ keywords: string[], max_pages: number }`. Streams SSE progress events per keyword/page, then a final `done` event with all results. |
| `GET /api/results` | GET | Returns all stored profiles from SQLite (paginated). |
| `GET /api/export` | GET | Generates and returns `.xlsx` file of all stored results. |
| `GET /api/settings` | GET | Returns current API key (masked) and CX ID. |
| `PUT /api/settings` | PUT | Updates API key and/or CX ID in SQLite. |
| `GET /api/quota` | GET | Returns today's API call count vs. daily limit (100). |

### SQLite Schema

**`profiles` table:**
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL
- `profile_url` TEXT UNIQUE NOT NULL
- `snippet` TEXT
- `matched_keywords` TEXT (JSON array string, e.g. `["Healthcare AI", "Medtech"]`)
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP

**`settings` table:**
- `key` TEXT UNIQUE NOT NULL
- `value` TEXT NOT NULL

Stores: `api_key`, `cx_id`

**`api_usage` table:**
- `date` TEXT UNIQUE NOT NULL (YYYY-MM-DD)
- `call_count` INTEGER DEFAULT 0

### Key Behaviors

- **Deduplication:** By `profile_url`. If profile exists, merge new keyword into `matched_keywords` JSON array (no duplicates), update snippet if newer is longer.
- **Rate limiting:** Check `api_usage` before each Google API call. If 100 calls reached for today, stop and send error via SSE.
- **Async HTTP:** `httpx.AsyncClient` for non-blocking Google API calls.
- **Quota counting:** Each Google API page request = 1 API call counted.
- **Google API query format:** `site:linkedin.com/in "{keyword}"` with pagination via `start` parameter (1, 11, 21, ...).

### SSE Event Types

- `progress`: `{ keyword, current_page, total_pages, profiles_found }`
- `keyword_done`: `{ keyword, total_profiles }`
- `error`: `{ message, keyword?, recoverable }`
- `done`: `{ total_profiles, new_profiles, keywords_completed }`
- `log`: `{ timestamp, level, message }` (for debug panel)

## Frontend (Next.js + TypeScript + Tailwind)

### Layout — Single Page Dashboard

**Header Bar:**
- App title "LinkedIn X-Ray Search" (left)
- Settings gear icon (top-right) → slide-out panel for API Key + CX ID
- Quota badge showing "23/100 queries used today"

**Search Panel:**
- Keyword chip input, pre-filled: `Healthcare Startups`, `Medtech`, `Healthcare AI`, `Medical AI`, `Healthcare for AI`
- Chips: click X to remove, type + Enter to add
- "Max pages per keyword" number input (default: 5, max: 10)
- "Scan" button — disabled during active search
- Progress area: per-keyword status lines during search

**Results Table:**
- Columns: Name, Profile Link (clickable, new tab), Bio Snippet (truncated + tooltip), Matched Keywords (small badges)
- Sortable by name, filterable by keyword
- Row count in header
- "Export to Excel" button above table

**Activity Log (collapsible):**
- Bottom of dashboard, toggled visible/hidden
- Timestamped entries for each API call, response status, errors
- Populated via SSE `log` events

### UI Style

- Tailwind CSS, neutral palette: white/slate/gray backgrounds, dark text
- Subtle borders, card-based layout
- System font stack or Inter
- One muted blue for primary actions (buttons, links)
- Professional data-table look with proper whitespace and consistent sizing
- No bright/funky accent colors

## Error Handling

- **Quota exceeded:** SSE error event mid-search. Already-collected results saved to DB. Message: "Daily quota reached at keyword X/Y, Z profiles collected so far."
- **Google API errors (403, 429, 5xx):** Retry once after 2s. If still failing, skip that page/keyword, report via SSE, continue with remaining keywords.
- **Invalid/missing credentials:** Validated on settings save. Search checks credentials exist before starting, returns clear error if missing.
- **Network failures:** `httpx` timeout at 10s per request. Timeout → skip page, report, continue.
- **No results:** Keyword returns zero → SSE reports it, moves to next keyword. Not an error.

## Logging & Debug

- **Backend:** Python `logging` module. Level configurable via `.env` `LOG_LEVEL` (DEBUG|INFO|WARNING). Output to console + `logs/app.log` (rotating file handler).
- **Frontend:** Activity Log panel fed by SSE `log` events. Shows timestamp, API call URL (credentials masked), response status, timing, and errors.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14+, TypeScript, Tailwind CSS |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Database | SQLite (via aiosqlite) |
| HTTP client | httpx (async) |
| Excel export | openpyxl |
| API | Google Custom Search JSON API |

## Constraints

- No LinkedIn login/auth — only Google-indexed public profiles
- Max 10 pages per keyword (100 results max per keyword, Google CSE limit)
- 100 free queries/day (Google CSE free tier)
- Local tool, no authentication on dashboard
- Search only triggers manually via Scan button
