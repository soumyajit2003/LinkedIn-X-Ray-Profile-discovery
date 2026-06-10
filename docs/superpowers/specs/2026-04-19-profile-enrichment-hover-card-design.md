# Profile Enrichment Hover Card

## Overview

Add a hover card to the results table that shows enriched LinkedIn profile data (followers, location, education, current experience, last post date) scraped on-demand via the Chrome extension. Uses lazy background pre-fetching with rate limiting to stay under LinkedIn's radar.

## User Experience

### Hover Card Appearance

- Triggered on mouse hover over profile name or avatar in ResultsTable
- 300ms hover delay before showing (prevents flicker on casual mouse movement)
- 200ms grace period on mouse leave (allows moving cursor into the card)
- Card: 300px wide, rounded corners (8px), subtle drop shadow, dark background matching app theme
- Positioned to the right of the hovered element; flips left if near viewport edge

### Card Layout

```
┌─────────────────────────────────┐
│  [Photo]  Name                  │
│           📍 Location           │
├─────────────────────────────────┤
│  👥 12,450 followers            │
│  💼 VP of Engineering at Acme   │
│  🎓 Stanford University         │
│  📝 Last post: 3 days ago       │
└─────────────────────────────────┘
```

- **Photo**: 48px circle, same source as table avatar (thumbnail_url)
- **Location**: Country/city as shown on LinkedIn profile (e.g., "United States", "San Francisco Bay Area")
- **Followers**: Numeric count with commas (e.g., "12,450 followers")
- **Experience**: Current role — title + company (latest experience entry)
- **Education**: Most recent/prominent education institution name
- **Last post date**: Relative time (e.g., "3 days ago", "2 weeks ago") or "N/A" if not visible

### States

- **Loading (first fetch)**: Skeleton shimmer animation in card, same dimensions
- **Cached (instant)**: Data displays immediately from local cache
- **Partial data**: Missing fields show "N/A" in muted text
- **Scrape failed**: Card shows "Could not load profile data" with subtle retry icon

## Data Scraping via Chrome Extension

### On-Demand Flow

1. User hovers profile name/avatar → frontend calls `GET /api/profiles/{id}/enrichment`
2. If cached data exists (scraped_at is set) → return immediately
3. If not cached → return `{status: "not_enriched"}` → frontend sends message to extension
4. Extension opens LinkedIn profile URL in background tab
5. Content script (new: `enrichment-content.js`) scrapes visible data from the profile page
6. Extension sends scraped data to `PUT /api/profiles/{id}/enrichment`
7. Frontend polls or listens for enrichment completion → displays card

### What to Scrape (from LinkedIn profile page DOM)

| Field | DOM Location (approximate) | Fallback |
|-------|---------------------------|----------|
| Followers | `.pvs-header__subtitle` or follower count in "X followers" text | N/A |
| Location | `.text-body-small` under name in profile header | N/A |
| Current Experience | First entry in Experience section (title + company) | N/A |
| Education | First entry in Education section (school name) | N/A |
| Last Post Date | Most recent activity/post timestamp in Activity section | N/A |

Note: DOM selectors are approximate and will need verification against current LinkedIn UI. The content script should use multiple selector strategies with fallbacks.

### Lazy Background Pre-fetching

After any hover triggers a scrape:
1. Identify next 5 visible profiles in the table that lack enrichment data
2. Queue them for background scraping
3. Process queue at **1 profile per 8 seconds** (rate limit)
4. Each scrape: open background tab → scrape → close tab → wait 8s → next
5. Pause immediately if LinkedIn shows any restriction signals (captcha page, "unusual activity" message)
6. Resume after 5 minutes if paused

### Rate Limiting & Safety

- Maximum 1 profile scrape per 8 seconds
- Maximum 50 profile enrichments per session (browser restart resets)
- If restriction detected: pause all enrichment for 5 minutes
- Extension badge shows enrichment status: "E" (enriching), count of cached profiles, or "!" (paused)
- Pre-fetch only runs while the dashboard tab is active/focused

## Backend Changes

### New Table: `profile_enrichment`

```sql
CREATE TABLE IF NOT EXISTS profile_enrichment (
    profile_id INTEGER PRIMARY KEY REFERENCES profiles(id),
    followers TEXT,
    location TEXT,
    education TEXT,
    experience TEXT,
    last_post_date TEXT,
    scraped_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);
```

All fields stored as TEXT (nullable). `scraped_at` is ISO timestamp of when data was fetched.

### New Endpoints

#### `GET /api/profiles/{id}/enrichment`

Returns cached enrichment data or indicates not yet enriched.

**Response (enriched):**
```json
{
  "status": "enriched",
  "data": {
    "followers": "12,450",
    "location": "United States",
    "education": "Stanford University",
    "experience": "VP of Engineering at Acme Corp",
    "last_post_date": "2026-04-16",
    "scraped_at": "2026-04-19T10:30:00Z"
  }
}
```

**Response (not enriched):**
```json
{
  "status": "not_enriched"
}
```

#### `PUT /api/profiles/{id}/enrichment`

Extension reports scraped data.

**Request:**
```json
{
  "followers": "12,450",
  "location": "United States",
  "education": "Stanford University",
  "experience": "VP of Engineering at Acme Corp",
  "last_post_date": "2026-04-16"
}
```

**Response:** `200 OK` with the saved enrichment data.

## Frontend Changes

### New Component: `ProfileHoverCard.tsx`

- Renders the hover card UI
- Props: `profile: Profile`, `anchorEl: HTMLElement`
- Manages hover delay (300ms show, 200ms hide grace)
- Fetches enrichment data on show
- If `status === "not_enriched"`, dispatches `chrome.runtime.sendMessage` to extension requesting scrape
- Polls `GET /api/profiles/{id}/enrichment` every 2s while waiting (max 15s timeout)
- Shows skeleton during loading, data when ready, error on timeout

### ResultsTable Changes

- Wrap profile name and ProfileAvatar with hover event handlers
- Track hovered profile ID in state
- Render `ProfileHoverCard` when a profile is hovered

### Communication with Extension

Frontend communicates scrape requests to extension via `window.postMessage` (since the extension content script can listen on the page). Message format:

```js
window.postMessage({ type: "ENRICH_PROFILE", profileId: 123, profileUrl: "https://linkedin.com/in/..." }, "*")
```

Extension content script on the dashboard page listens for these messages and forwards to background worker.

## Chrome Extension Changes

### New File: `enrichment-content.js`

Content script that runs on LinkedIn profile pages (`https://www.linkedin.com/in/*`). Scrapes:
- Followers count
- Location
- Current experience (first entry)
- Education (first entry)
- Last post/activity date

Reports data back to background.js via `chrome.runtime.sendMessage`.

### Updates to `background.js`

- New message handler: `ENRICH_PROFILE` — opens profile tab, waits for scrape, reports to API
- Enrichment queue: stores pending profile IDs, processes at 1 per 8 seconds
- Pre-fetch logic: after completing a scrape, checks for queued profiles
- Rate limit tracking: timestamps of recent scrapes, pause logic
- Session counter: tracks total enrichments this session (cap at 50)

### Updates to `manifest.json`

- Add `enrichment-content.js` to content scripts matching `https://www.linkedin.com/in/*`
- Add dashboard URL to content scripts (for `window.postMessage` listener)

## Edge Cases

- **Profile no longer exists**: Extension lands on 404/redirect → report as failed, card shows "Profile unavailable"
- **Premium-only data**: Some fields only visible to premium users → those fields return N/A
- **Very long text**: Truncate experience/education to 60 chars with ellipsis in card
- **Multiple hovers rapid-fire**: Debounce — only the most recent hovered profile triggers a fetch
- **Extension not installed**: Frontend detects no response after 5s → card shows "Install extension to view profile details"
- **Stale cache**: Data older than 30 days shows subtle "Last updated 32 days ago" footnote but still displays

## File Changes Summary

| File | Change |
|------|--------|
| `backend/app/database.py` | Add `profile_enrichment` table creation in `init_db()`, add `get_enrichment()` and `save_enrichment()` functions |
| `backend/app/models.py` | Add `EnrichmentResponse`, `EnrichmentUpdate` Pydantic models |
| `backend/app/routers/enrichment.py` | New router: GET and PUT endpoints |
| `backend/app/main.py` | Mount enrichment router |
| `frontend/src/components/ProfileHoverCard.tsx` | New component |
| `frontend/src/components/ResultsTable.tsx` | Add hover handlers, render ProfileHoverCard |
| `frontend/src/lib/api.ts` | Add `getEnrichment()`, communication helper |
| `frontend/src/lib/types.ts` | Add `EnrichmentData` interface |
| `extension/manifest.json` | Add enrichment content script |
| `extension/enrichment-content.js` | New file: scrapes LinkedIn profile data |
| `extension/background.js` | Add enrichment queue, rate limiting, pre-fetch logic |
