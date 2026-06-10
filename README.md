<div align="center">

# **Google X Immersion**

---

**You can use this tool to search people on LinkedIn based on tags, automatically connect and send requests. Add your AI API to integrate with an agentic system that helps find, locate, and send connections.**

</div>

---

# LinkedIn X-Ray Search

Scrapes public LinkedIn profiles via Serper.dev search API using healthcare/AI keywords. Displays results in a dashboard with profile photos, exports to Excel, and sends LinkedIn connection requests directly from the panel via a Chrome extension.

## Prerequisites

- Python 3.11+
- Node.js 18+
- Serper API key (free at [serper.dev](https://serper.dev) — 2,500 free queries)
- Chrome/Brave browser (for the connection sender extension)
- AWS credentials in `~/.aws/credentials` (Mac/Linux) or `%USERPROFILE%\.aws\credentials` (Windows) — optional, for Bedrock AI provider

## Quick Start (Mac/Linux)

```bash
cp .env.example .env          # optionally add your Serper API key
npm run setup                  # installs Python + Node dependencies (one-time)
npm run dev                    # starts backend + frontend together
```

Open http://localhost:3000. You can also configure your API key via the gear icon in the UI.

## Quick Start (Windows)

Open PowerShell in the project root and run these steps:

**1. Install root dependencies:**
```powershell
npm install
```

**2. Backend setup:**
```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

**3. Frontend setup:**
```powershell
cd frontend
npm install
cd ..
```

**4. Run (two separate PowerShell windows):**

Terminal 1 — Backend:
```powershell
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — Frontend:
```powershell
cd frontend
npm run dev
```

Open http://localhost:3000.

> **Note:** `npm run dev` at the root uses `concurrently` which works on Mac/Linux. On Windows, run backend and frontend in separate terminals as shown above.

**5. AWS Bedrock setup (optional, only if using AI Chat with Bedrock):**

```powershell
mkdir "$env:USERPROFILE\.aws" -Force
notepad "$env:USERPROFILE\.aws\credentials"
```

Paste in Notepad and save:
```
[default]
aws_access_key_id = YOUR_ACCESS_KEY_HERE
aws_secret_access_key = YOUR_SECRET_KEY_HERE
```

This is the same credentials file that Mac/Linux stores at `~/.aws/credentials`. Without it, Bedrock auth will fail.

## Chrome Extension Setup

1. Open `chrome://extensions` (or `brave://extensions` in Brave)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Keep the extension enabled while using the dashboard

## Manual Setup (Mac/Linux)

1. Backend:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

2. Frontend (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

## Usage

- Add or remove keyword chips in the search panel
- Select **Location** filter (multi-select country picker) to scope searches by country
- Keywords are full width on top; Location and Max Pages sit side by side below
- Click **Scan** to start searching (progress streams in real-time)
- View results in the table — sort by name, filter by keyword, connection status, or location
- Resize columns by dragging the column border (like Excel/Google Sheets)
- Paginate results: choose 50, 100, or 200 rows per page
- Click **Export to Excel** to download all results
- Click **Enrich Profiles** (only visible in LinkedIn Network project) → dropdown with two options:
  - **Via Serper API** — fetches profile photo, bio snippet, and location (1 API credit per profile)
  - **Via LinkedIn Extension** — scrapes real names, followers, location, experience, education, and about from LinkedIn (free, slower)
- Both options target profiles missing **both** photo and bio snippet
- Select profiles with checkboxes → **Delete** button appears to remove profiles (with confirmation)
- Configure your Serper API key and AI provider keys via the gear icon (top-right)
- **Remove** any saved API key with the remove button next to each provider
- Toggle the **Activity Log** at the bottom for debug info
- Click the **AI Chat** button (bottom-right) to open the AI assistant

### Enrich Profiles

- Only available in the **LinkedIn Network** project (not shown for custom search projects)
- Click **Enrich Profiles** → dropdown with two options:

**Via Serper API (Fast):**
- Searches `"{name} site:linkedin.com/in/{slug}"` via Serper Search API
- Fetches profile photo, bio snippet, and location
- 1 API credit per profile, processes in batches of 5
- SSE progress stream with live counter
- Only targets profiles missing **both** photo and bio snippet

**Via LinkedIn Extension (Free):**
- Opens LinkedIn profile pages one by one in background tabs (8s apart, max 50 per session)
- Scrapes: real name, followers count, location, experience, education, about section
- The scraped name replaces the slug-derived placeholder name in the DB
- Scrolls profile pages to trigger lazy-loaded sections (Experience, Education)
- **Free — no API credits used**, scrapes directly from LinkedIn via the extension
- Only targets profiles missing **both** photo and bio snippet

### Delete Profiles

- Select one or more profiles using checkboxes in the table
- A **Delete** button appears in the bottom action bar
- Confirmation popup before deletion — removes profile, enrichment data, and project links

### Post-Scan LinkedIn Sync

After every scan completes, the extension automatically syncs your LinkedIn sent invitations and connections:

1. **Minimal overlay** appears with a spinner, status text, and live countdown between batches
2. **Sent page sync** — Opens your LinkedIn sent invitations page, scrolls incrementally:
   - Fetches known sent slugs from the DB cache
   - Scrolls from the top until it hits a known slug (incremental — only scrapes new ones)
   - Saves new slugs to DB immediately
   - First run: full scrape to seed the cache
3. **Connections page sync** — Opens your LinkedIn connections page:
   - First checks if the top profile is already known → if yes, skips entirely (zero scrolling)
   - Otherwise scrapes in batches of 300 with random 60–90 second delays
   - Checks for known slugs during scrolling (not just after each batch) — stops as soon as one is found
   - Each batch saved to DB immediately
   - Overlay shows countdown timer between batches (e.g., "Wait 61s" counting down)
   - First run: full scrape to seed the cache (takes ~15–20 minutes for 1,600+ connections)
4. **Status comparison** — After both scrapers finish, the backend compares cached slugs against profile URLs:
   - Profiles with status "none" whose slug appears in the sent cache → moved to "sent"
   - Profiles with status "none" whose slug appears in the connected cache → moved to "connected"
   - **Profiles with status "sent" whose slug appears in connected cache → promoted to "connected"** (they accepted your invite)
   - Toast notification shows how many profiles were promoted (e.g., "3 profiles promoted to Connected")
5. **Profile population** — Creates profile entries for all slugs that don't already have a profile in the DB
6. **Default project assignment** — All synced profiles are automatically added to the "LinkedIn Network" project

**Incremental behavior (subsequent runs):**
- Sent page: stops at the first known slug, saves only new ones above it (seconds, not minutes)
- Connections page: checks the top profile first — if already known, skips entirely. Otherwise stops at first known slug during scrolling.
- Designed to minimize LinkedIn scraping and avoid detection

### LinkedIn Network Project

- Auto-created on first sync, holds all profiles from your actual LinkedIn account
- **Cannot be deleted** or renamed — protected in both frontend and backend
- Description is editable
- Search panel is hidden for this project (no keyword search needed)
- "Enrich Profiles" button only appears when this project is selected

### Sending Connections

- Click the **Connect** dropdown on any profile row → **Send Connection** to queue it
- A **toast notification** appears showing the scheduled send time
- The button shows **Queued - 12:06 AM** with the scheduled send time (your local timezone)
- The Chrome extension uses **smart polling** — it stays idle by default and only starts polling every ~10s when items enter the queue. When the queue empties, polling stops automatically. On extension install/startup, it checks once for any existing queued items.
- The extension opens LinkedIn's invite page in a background tab and clicks "Send without a note"
- Once sent, the button auto-updates to **Sent** (dashboard polls every 5s while items are queued, without table flickering)
- Use **Already Connected** in the dropdown to manually mark someone
- Select multiple rows with checkboxes and use the bulk action bar to queue or mark them at once
- Daily limit: 50 connections/day, shown in the header quota badge
- Random 30–90 second delays between sends to avoid LinkedIn rate limits
- If LinkedIn shows a captcha or weekly limit, the extension pauses for 5 minutes
- Filter by connection status (All statuses, Queued, Sent, Connected, Failed) to track progress

### AI Chat

The AI Chat panel (bottom-right button) lets you interact with an AI assistant that can analyze your profiles, recommend connections, search the web, and even send connections on your behalf.

**Setup:**
1. Open Settings (gear icon, top-right)
2. Under **AI Chat Settings**, add at least one API key:
   - **OpenAI** — models: gpt-5.4, gpt-5.4-mini, gpt-5.4-nano
   - **Anthropic** — models: claude-opus-4-7, claude-sonnet-4-6
   - **Gemini** — models: gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview
   - **AWS Bedrock** — models: us.anthropic.claude-sonnet-4-6, us.anthropic.claude-opus-4-7, us.anthropic.claude-haiku-4-5, us.anthropic.claude-opus-4-6-v1. Requires AWS credentials file: `~/.aws/credentials` (Mac/Linux) or `%USERPROFILE%\.aws\credentials` (Windows). The API key field in settings acts as an enable flag; actual auth uses boto3 with IAM.
3. Select your preferred model from the dropdown for each provider
4. Click **Save Settings**
5. To remove a key, click the **Remove** button next to any saved provider

**Features:**
- **Profile Analysis** — Ask "Who should I connect with for healthcare AI?" and the AI analyzes your entire DB
- **Web Search** — Toggle the 🔍 button to let the AI search the internet for more info on a person (e.g., "Tell me more about Hak Seung Lee")
- **Send Connections via Chat** — Say "send connection to Emre Aktas" or "find top 10 profiles and connect" — the AI queues them (with your confirmation)
- **Natural Language** — The AI understands informal phrasing: "Emre Aktas connect", "queue Junxia Lin", "add top 5 to my network", etc.

**Security & Consent Popups:**
- **Database access** — On first message, a popup asks: *"Your AI wants to access your LinkedIn X-Ray Search DB. Want to proceed?"* (Yes/No)
- **Web search** — When web search is enabled, a separate popup asks for permission before searching the internet
- **Connection actions** — When the AI wants to queue connections, a confirmation popup shows how many profiles will be queued (Yes, Send / Cancel)
- If you deny DB access, the AI responds as a general assistant without profile context
- Consent persists for the current chat session only

**Provider Selector:**
- Switch between configured AI providers mid-conversation using the dropdown in the chat header
- A badge shows which model is active, plus green "DB" and purple "Web" badges when those are granted

## API Quota

Serper.dev free tier includes 2,500 queries total. The header badge shows **credits left** (live balance fetched from Serper's `/account` endpoint). The connection quota badge (next to it) shows connections sent today vs. the 50/day limit.

---

## Project Structure & File Reference

```
linkedin-xray-search/
├── package.json                  # Root monorepo — scripts: setup, dev (concurrently runs BE+FE)
├── .env.example                  # SERPER_API_KEY, LOG_LEVEL
├── README.md
│
├── backend/
│   ├── requirements.txt          # fastapi, uvicorn, httpx, aiosqlite, openpyxl, sse-starlette, python-dotenv, boto3
│   ├── pytest.ini                # asyncio_mode = auto
│   ├── data.db                   # SQLite database (created at runtime, gitignored)
│   │
│   ├── app/
│   │   ├── main.py               # FastAPI app, CORS config (allows localhost:3000, linkedin.com, chrome-extension), lifespan (DB init + logging), mounts all routers
│   │   ├── config.py             # Loads .env; exports DATABASE_PATH, LOG_DIR, LOG_LEVEL, DAILY_QUOTA_LIMIT (2500), SERPER_API_KEY, DAILY_CONNECTION_LIMIT (50)
│   │   ├── database.py           # Async SQLite layer (aiosqlite). Tables: profiles, settings, api_usage, connection_usage, profile_enrichment, linkedin_sent_slugs, linkedin_connected_slugs, projects, project_profiles. Connection functions: update_connection_status, get_next_queued_connection, report_connection_result, get/increment_connection_usage, update_profile_thumbnail. Slug cache functions: get_known_sent_slugs, add_sent_slugs, get_known_connected_slugs, add_connected_slugs, sync_post_scan_from_cache (promotes sent→connected), populate_profiles_from_slugs (auto-assigns to LinkedIn Network project). Profile functions: delete_profiles, update_profile_info, update_profile_name. Default project: get_or_create_default_project ("LinkedIn Network" — protected from deletion/rename)
│   │   ├── models.py             # Pydantic schemas: SearchRequest, ProfileResponse, ConnectionStatusUpdate, ConnectionResultUpdate, ConnectionBulkRequest, ConnectionResponse, ConnectionQueueItem, ConnectionQueueResponse, ConnectionUsageResponse, ConnectionBulkResponse, SyncSentRequest, SyncSentResponse, IncrementalSlugsRequest, IncrementalSlugsResponse, KnownSlugsResponse, SyncFromCacheResponse, PostScanSyncRequest, PostScanSyncResponse, EnrichmentData, EnrichmentUpdate (with name field), ProjectCreate, ProjectUpdate, ProjectResponse
│   │   │
│   │   ├── routers/
│   │   │   ├── search.py         # POST /api/search — SSE streaming search. Loops keywords × pages, yields progress/log/error/keyword_done/done events. Supports location filtering
│   │   │   ├── results.py        # GET /api/results — paginated profile list (limit up to 5000). POST /api/delete-profiles — bulk delete. POST /api/backfill-images — Serper photo/snippet/location enrichment (SSE, project-scoped)
│   │   │   ├── export.py         # GET /api/export — streams .xlsx file download
│   │   │   ├── settings.py       # GET/PUT /api/settings — API key CRUD
│   │   │   ├── quota.py          # GET /api/quota — live credit balance from Serper
│   │   │   ├── connections.py    # Connection sender + sync API: queue, usage, bulk, result, sync-sent, known-sent-slugs, sent-slugs, known-connected-slugs, connected-slugs, sync-from-cache, populate-from-slugs
│   │   │   ├── enrichment.py     # GET/PUT /api/profiles/{id}/enrichment — saves enrichment data + updates profile name
│   │   │   └── chat.py           # AI Chat API: settings, streaming chat, execute-action
│   │   │
│   │   └── services/
│   │       ├── google_search.py  # Serper.dev API client
│   │       ├── profile_image.py  # Fetches LinkedIn profile info (photo, snippet, location) via Serper Search API with slug+name validation
│   │       └── excel_export.py   # generate_excel(profiles) → BytesIO
│   │
│   └── tests/
│       ├── test_database.py      # 11 tests
│       ├── test_google_search.py # 5 tests
│       ├── test_excel_export.py  # 2 tests
│       ├── test_routers.py       # 6 tests
│       └── test_connections.py   # 26 tests
│
├── extension/                    # Chrome/Brave extension (Manifest V3)
│   ├── manifest.json             # MV3 service worker, permissions: tabs, activeTab, storage, alarms, scripting. Matches *.linkedin.com and localhost
│   ├── background.js             # Service worker: smart polling, connection sending, enrichment queue, post-scan sync orchestration, API proxy for content scripts (API_FETCH handler)
│   ├── content.js                # Runs on LinkedIn invite page, clicks "Send without a note"
│   ├── enrichment-content.js     # Runs on LinkedIn profile pages, scrolls page, scrapes name/followers/location/experience/education/about
│   ├── sync-sent-content.js      # Runs on LinkedIn sent page, incremental scraping via API proxy, stops at known slug
│   ├── sync-connections-content.js # Runs on LinkedIn connections page, checks top profile first (skip if known), batch scraping (300/batch, 60-90s delays), inline known-slug detection
│   ├── dashboard-content.js      # Runs on localhost:3000, relays messages between frontend and background (ENRICH_PROFILE, START_POLLING, TRIGGER_POST_SCAN_SYNC, SYNC_PROGRESS, POST_SCAN_SYNC_DONE)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── frontend/
    ├── package.json              # next@16, react@19, tailwindcss@4, typescript@5
    ├── tsconfig.json
    ├── next.config.ts
    │
    └── src/
        ├── app/
        │   ├── layout.tsx        # Root HTML layout
        │   ├── page.tsx          # Home — search, minimal sync overlay with countdown, auto-populate after sync
        │   └── globals.css       # Tailwind directives
        │
        ├── components/
        │   ├── Header.tsx        # App title, credits badge, connection quota badge, settings gear
        │   ├── SearchPanel.tsx   # Keyword chips + Location picker + max pages + Scan button
        │   ├── KeywordChips.tsx  # Editable chip input
        │   ├── ProgressArea.tsx  # Per-keyword progress indicators
        │   ├── ResultsTable.tsx  # Resizable columns, sortable, filterable, Export, Enrich Profiles, Delete buttons, checkbox bulk selection, pagination
        │   ├── ProfileAvatar.tsx # Profile photo or colored initials fallback
        │   ├── ConnectionButton.tsx # Status dropdown per profile (Connect/Queued/Sent/Connected/Failed)
        │   ├── KanbanBoard.tsx   # Kanban view of profiles by status
        │   ├── ProjectSelector.tsx # Project dropdown with All Projects option
        │   ├── Toast.tsx         # Global toast notification system
        │   ├── ActivityLog.tsx   # Collapsible debug log panel
        │   ├── ChatPanel.tsx     # AI Chat sidebar
        │   └── SettingsPanel.tsx # Settings slide-over modal
        │
        ├── hooks/
        │   └── useSSESearch.ts   # SSE client hook for streaming search
        │
        └── lib/
            ├── types.ts          # TS interfaces
            ├── constants.ts      # API_BASE, defaults
            └── api.ts            # API client: getResults, updateConnectionStatus, bulkQueueConnections, deleteProfiles, populateFromSlugs, getEnrichment, etc.
```

## Backend API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Start search (SSE stream) |
| GET | `/api/results` | Get saved profiles (limit up to 5000) |
| POST | `/api/delete-profiles` | Delete profiles by IDs (cascade: enrichment + project links) |
| POST | `/api/backfill-images` | Fetch photo/snippet/location via Serper (SSE stream, optional `project_id` query param) |
| GET | `/api/export` | Download Excel file |
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/quota` | Get credit balance |
| GET | `/api/connections/queue` | Next queued item for extension |
| GET | `/api/connections/usage` | Daily connection count |
| PUT | `/api/connections/bulk` | Queue multiple profiles |
| PUT | `/api/connections/{id}` | Queue, mark connected, or reset |
| PUT | `/api/connections/{id}/result` | Extension reports sent/failed |
| GET | `/api/connections/known-sent-slugs` | Get all cached sent slugs |
| POST | `/api/connections/sent-slugs` | Add new sent slugs to cache |
| GET | `/api/connections/known-connected-slugs` | Get all cached connected slugs |
| POST | `/api/connections/connected-slugs` | Add new connected slugs to cache |
| POST | `/api/connections/sync-from-cache` | Compare cached slugs against profiles, update statuses, promote sent→connected |
| POST | `/api/connections/populate-from-slugs` | Create profile entries for all slugs not yet in profiles table |
| POST | `/api/connections/sync-sent` | Legacy: sync accepted connections |
| POST | `/api/connections/sync-post-scan` | Legacy: post-scan sync with slug lists |
| GET | `/api/profiles/{id}/enrichment` | Get enrichment data |
| PUT | `/api/profiles/{id}/enrichment` | Save enrichment data (+ update profile name) |
| GET | `/api/chat/settings` | Get AI provider settings |
| PUT | `/api/chat/settings` | Update AI keys & models |
| POST | `/api/chat` | AI chat (SSE stream) |
| POST | `/api/chat/execute-action` | Execute AI-suggested action |

## Data Flow

**Search flow:** User enters keywords + optional location filter → `SearchPanel` → `useSSESearch.startSearch()` → POST `/api/search` → backend loops keywords × pages → calls Serper API → `parse_search_results()` → `database.upsert_profile()` → fetches profile images → yields SSE events → frontend updates progress in real-time → on "done", triggers post-scan sync.

**Post-scan sync flow:** Frontend sends `TRIGGER_POST_SCAN_SYNC` → extension opens sent tab (active) → content script fetches known slugs via background API proxy → scrolls incrementally until hitting a known slug → saves new slugs → sends result → extension closes tab → opens connections tab (active) → checks top profile against DB (skips if known) → otherwise scrapes in batches of 300, checking for known slugs during scrolling → saves each batch immediately → sends result → background calls `POST /sync-from-cache` → backend compares slug caches against profile URLs → moves profiles to sent/connected, promotes sent→connected → shows toast for promotions → calls `POST /populate-from-slugs` → creates profile entries for new slugs → assigns all to LinkedIn Network project → overlay closes → results refresh.

**Enrichment flow:** User selects LinkedIn Network project → clicks "Enrich Profiles" → frontend sends `ENRICH_PROFILE` messages for profiles without follower data → extension queues them → opens LinkedIn profile tabs one at a time (8s apart) → scrolls page to load lazy sections → scrapes name, followers, location, experience, education, about → saves via `PUT /api/profiles/{id}/enrichment` → backend updates enrichment table + profile name → tab closes. Max 50 per session.

**Connection flow:** User clicks Connect → queued with 30–90s delay → extension polls → opens invite page → clicks send → reports result → dashboard auto-refreshes.

**AI Chat flow:** User types message → consent popup → backend injects profile DB as context → streams AI response. Supports web search, connection queueing via natural language.

## SQLite Schema

```sql
-- Profiles table (deduplicated by profile_url)
profiles: id, name, profile_url (UNIQUE), snippet, thumbnail_url, search_location,
          matched_keywords (JSON array),
          connection_status (none|queued|sent|connected|failed), connection_queued_at,
          connection_scheduled_at, connection_sent_at, created_at, updated_at

-- Profile enrichment (scraped from LinkedIn via Chrome extension)
profile_enrichment: profile_id (FK), followers, location, education, experience,
                    last_post_date, about, scraped_at

-- LinkedIn slug caches (for incremental sync)
linkedin_sent_slugs: slug (PRIMARY KEY), added_at
linkedin_connected_slugs: slug (PRIMARY KEY), added_at

-- Projects
projects: id, name, description, keywords (JSON), created_at, updated_at
project_profiles: project_id (FK), profile_id (FK), added_at

-- Partial index for fast queue lookups
idx_profiles_connection_queue ON profiles(connection_status, connection_scheduled_at)
    WHERE connection_status = 'queued'

-- App settings
settings: key (PRIMARY KEY), value

-- Usage tracking
api_usage: date (PRIMARY KEY), call_count
connection_usage: date (PRIMARY KEY), send_count
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Backend | Python 3.12, FastAPI, uvicorn, httpx, aiosqlite, sse-starlette |
| Search API | Serper.dev (Google search results via `site:linkedin.com/in`) |
| Database | SQLite (async via aiosqlite) |
| Excel Export | openpyxl |
| Connection Sender | Chrome Extension (Manifest V3 service worker + content script) |
| Profile Enrichment | Chrome Extension (scrapes LinkedIn profile pages directly) |
| LinkedIn Sync | Chrome Extension (incremental scraping of sent/connections pages with DB cache) |
| AI Chat | OpenAI API, Anthropic API, Google Gemini API, AWS Bedrock (boto3) — streaming, provider-agnostic |
| Dev Runner | concurrently (single `npm run dev` starts both servers) |
| Tests | pytest + pytest-asyncio (50 tests) |
