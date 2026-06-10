# LinkedIn Connection Sender — Design Spec

## Goal

Add the ability to send LinkedIn connection requests directly from the X-Ray Search dashboard, without switching to a LinkedIn tab. A Chrome extension acts as the automation worker, polling a backend queue and clicking "Connect" on LinkedIn profile pages. Connection status is tracked per-profile in SQLite.

## Architecture Overview

Three components work together:

1. **Frontend (Next.js)** — adds a status dropdown button per profile row and a connection quota badge. Users queue connections or flag profiles as already connected.
2. **Backend (FastAPI)** — new `/api/connections/*` endpoints. Manages the queue in the existing SQLite DB, calculates scheduled send times with random delays, enforces 50/day limit.
3. **Chrome Extension (Manifest V3)** — background service worker polls the backend for ready queue items, opens LinkedIn profile in a background tab, content script clicks Connect, reports result back.

```
User clicks "Send Connection"
        |
        v
Frontend PUT /api/connections/{id} { status: "queued" }
        |
        v
Backend calculates scheduled_at (last queued + 30-90s random delay)
        |
        v
Stores in profiles table (connection_status = "queued", connection_scheduled_at = UTC)
        |
        v
Extension polls GET /api/connections/queue every 10s
        |
        v
When scheduled_at <= now, extension gets the item
        |
        v
Extension opens linkedin.com/in/... in background tab
        |
        v
Content script finds "Connect" button, clicks it, dismisses "Add a note?" modal
        |
        v
Extension reports PUT /api/connections/{id}/result { status: "sent" | "failed" }
        |
        v
Frontend reflects updated status on next poll/refetch
```

---

## Database Changes

### Modified table: `profiles`

Add columns to the existing profiles table:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `connection_status` | TEXT | `'none'` | `none`, `queued`, `sent`, `connected`, `failed` |
| `connection_queued_at` | TIMESTAMP | NULL | When user clicked "Send Connection" |
| `connection_scheduled_at` | TIMESTAMP | NULL | UTC time when extension should process this item |
| `connection_sent_at` | TIMESTAMP | NULL | When extension confirmed delivery |

Migration: `ALTER TABLE profiles ADD COLUMN ...` for each new column, run in `init_db()`.

### New table: `connection_usage`

```sql
CREATE TABLE IF NOT EXISTS connection_usage (
    date TEXT UNIQUE NOT NULL,
    send_count INTEGER DEFAULT 0
);
```

Tracks daily connection sends against the 50/day limit. Separate from the existing `api_usage` table (which tracks search API calls).

### Queue mechanism

No separate queue table. The `profiles` table is the queue. Extension polls:

```sql
SELECT id, profile_url, name FROM profiles
WHERE connection_status = 'queued'
  AND connection_scheduled_at <= datetime('now')
ORDER BY connection_scheduled_at ASC
LIMIT 1
```

---

## Connection Status Lifecycle

```
none ──> queued ──> sent
  ^        |         |
  |        v         |
  |      failed      |
  |        |         |
  └────────┴─────────┘  (Reset)

none ──> connected
  ^         |
  └─────────┘  (Reset)
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `none` | Default, no action taken | User (reset/cancel) |
| `queued` | Waiting for extension to process at scheduled time | User (Send Connection) |
| `sent` | Extension confirmed it clicked Connect on LinkedIn | Extension |
| `connected` | User manually flagged as already in their network | User |
| `failed` | Extension couldn't send (page error, button not found, CAPTCHA) | Extension |

---

## Scheduled Time Calculation

When a user queues a connection:

1. Backend fetches the latest `connection_scheduled_at` from all queued items
2. If no items in queue, `scheduled_at = now + random(30, 90)` seconds
3. If items exist, `scheduled_at = max(last_scheduled_at, now) + random(30, 90)` seconds
4. Store as UTC in `connection_scheduled_at`
5. Return to frontend; frontend displays in local timezone via `toLocaleTimeString()`

For bulk queuing (N profiles selected):
- Each profile gets staggered: `base + i * random(30, 90)` seconds
- Total time for 10 profiles: roughly 5-15 minutes

---

## API Endpoints

New router: `backend/app/routers/connections.py`

### PUT `/api/connections/{profile_id}`

**Purpose:** Frontend sets connection status (queue, flag as connected, cancel, reset).

**Request body:**
```json
{ "status": "queued" | "connected" | "none" }
```

**Logic:**
- If `status = "queued"`: check 50/day limit, calculate `connection_scheduled_at`, set `connection_queued_at = now`
- If `status = "connected"`: set status directly, clear scheduled/queued timestamps
- If `status = "none"`: reset all connection fields to defaults

**Response:**
```json
{
  "profile_id": 42,
  "connection_status": "queued",
  "connection_scheduled_at": "2026-04-18T14:34:12Z",
  "daily_usage": { "used": 12, "limit": 50 }
}
```

**Errors:**
- 404 if profile_id not found
- 429 if daily limit (50) reached and status is "queued"

### GET `/api/connections/queue`

**Purpose:** Extension polls this to get the next ready item.

**Logic:** Query for oldest `queued` profile where `connection_scheduled_at <= now`.

**Response:**
```json
{
  "item": {
    "profile_id": 42,
    "profile_url": "https://linkedin.com/in/alice",
    "name": "Alice Smith"
  }
}
```
Returns `{ "item": null }` when nothing is ready.

### PUT `/api/connections/{profile_id}/result`

**Purpose:** Extension reports outcome after attempting to send connection.

**Request body:**
```json
{ "status": "sent" | "failed", "error": "optional error message" }
```

**Logic:**
- If `sent`: set `connection_status = "sent"`, `connection_sent_at = now`, increment `connection_usage`
- If `failed`: set `connection_status = "failed"`, do NOT increment usage

**Response:**
```json
{ "profile_id": 42, "connection_status": "sent" }
```

### GET `/api/connections/usage`

**Purpose:** Connection quota for today.

**Response:**
```json
{ "used": 12, "limit": 50, "date": "2026-04-18" }
```

### PUT `/api/connections/bulk`

**Purpose:** Queue multiple profiles at once.

**Request body:**
```json
{ "profile_ids": [42, 43, 44, 45] }
```

**Logic:** For each ID, calculate staggered `connection_scheduled_at`. Reject if adding these would exceed 50/day.

**Response:**
```json
{
  "queued": [
    { "profile_id": 42, "connection_scheduled_at": "2026-04-18T14:34:12Z" },
    { "profile_id": 43, "connection_scheduled_at": "2026-04-18T14:35:28Z" }
  ],
  "daily_usage": { "used": 16, "limit": 50 }
}
```

---

## Backend Models (Pydantic)

Add to `backend/app/models.py`:

```python
class ConnectionStatusUpdate(BaseModel):
    status: Literal["queued", "connected", "none"]

class ConnectionResultUpdate(BaseModel):
    status: Literal["sent", "failed"]
    error: str | None = None

class ConnectionBulkRequest(BaseModel):
    profile_ids: list[int] = Field(min_length=1)

class ConnectionResponse(BaseModel):
    profile_id: int
    connection_status: str
    connection_scheduled_at: str | None = None
    daily_usage: dict | None = None

class ConnectionQueueItem(BaseModel):
    profile_id: int
    profile_url: str
    name: str

class ConnectionQueueResponse(BaseModel):
    item: ConnectionQueueItem | None

class ConnectionUsageResponse(BaseModel):
    used: int
    limit: int
    date: str

class ConnectionBulkResponse(BaseModel):
    queued: list[ConnectionResponse]
    daily_usage: dict
```

---

## Backend Database Functions

Add to `backend/app/database.py`:

- `update_connection_status(profile_id, status, scheduled_at=None)` — updates the connection columns on a profile
- `get_next_queued_connection()` — returns oldest queued item where scheduled_at <= now
- `get_last_scheduled_at()` — returns the max `connection_scheduled_at` from queued items
- `report_connection_result(profile_id, status)` — sets sent/failed, timestamps
- `get_connection_usage(date_str)` — daily send count
- `increment_connection_usage(date_str)` — increment daily send count

---

## Frontend Changes

### Updated `Profile` type (`types.ts`)

Add fields:
```typescript
connection_status: "none" | "queued" | "sent" | "connected" | "failed";
connection_scheduled_at: string | null;
```

### Updated `ProfileResponse` model (`models.py`)

Add fields:
```python
connection_status: str = "none"
connection_scheduled_at: str | None = None
```

### New API functions (`api.ts`)

- `updateConnectionStatus(profileId, status)` — PUT `/api/connections/{id}`
- `bulkQueueConnections(profileIds)` — PUT `/api/connections/bulk`
- `getConnectionUsage()` — GET `/api/connections/usage`

### ResultsTable changes

**New column: "Status"** (last column in the table)

Each row gets a dropdown button component (`ConnectionButton.tsx`):

| Current Status | Button Label | Button Style | Dropdown Options |
|----------------|-------------|-------------|-----------------|
| `none` | "Connect" | Gray border, neutral | Send Connection, Already Connected |
| `queued` | "Queued - 2:34 PM" | Amber bg, white text | Cancel |
| `sent` | "Sent" | Green bg, white text | Reset |
| `connected` | "Connected" | Blue bg, white text | Reset |
| `failed` | "Failed" | Red bg, white text | Retry, Already Connected |

**Time display:** `connection_scheduled_at` (UTC from backend) converted to local time using:
```typescript
new Date(scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
```

**Dropdown behavior:**
- Click button or chevron to open dropdown
- Click outside to close
- After selecting an option, dropdown closes, API call fires, button updates optimistically

### New component: `ConnectionButton.tsx`

Standalone component receiving `profile` and `onStatusChange` callback. Self-contained dropdown logic. Calls API functions directly.

### Checkbox + bulk action

- New checkbox column (first column)
- Select all checkbox in header
- When 1+ profiles selected, floating action bar appears at bottom of table:
  - "Send Connection to N profiles" button
  - Only counts profiles with `connection_status = "none"` or `"failed"`
- Calls `bulkQueueConnections()`, updates all selected rows

### Header — connection quota badge

Next to the existing search quota badge:
- "12/50 connections" — same color logic (green/amber/red)
- Fetched from `GET /api/connections/usage`
- Refreshes when connections are queued or results reported

---

## Chrome Extension

### File structure

```
extension/
  manifest.json
  background.js
  content.js
  icon16.png
  icon48.png
  icon128.png
```

### manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "LinkedIn X-Ray Connector",
  "version": "1.0.0",
  "description": "Sends LinkedIn connection requests from X-Ray Search dashboard",
  "permissions": ["tabs", "activeTab", "storage"],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "http://localhost:8000/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/in/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  }
}
```

### background.js

**Responsibilities:**
1. Poll `GET /api/connections/queue` every 10 seconds
2. When an item is returned, open the profile URL in a new background tab
3. Listen for messages from content.js with the result
4. Call `PUT /api/connections/{id}/result` with the outcome
5. Close the tab
6. Update badge text with queue count

**CAPTCHA/rate-limit handling:**
- If content.js reports a LinkedIn restriction page, pause polling for 5 minutes
- Set badge to red with "!" during pause

**Badge states:**
- No queue items: green icon, no text
- Queue processing: amber icon, number shows remaining count
- Paused (rate limited): red icon, "!" text

### content.js

**Responsibilities:**
1. Activated on `linkedin.com/in/*` pages
2. Waits for page load (LinkedIn is SPA, need to wait for DOM)
3. Finds the primary "Connect" button on the profile
4. If found: clicks it, waits for modal, clicks "Send without a note", reports `sent`
5. If not found (already connected, pending, or no button): reports `failed` with reason
6. If CAPTCHA or restriction detected: reports `failed` with `captcha` flag

**DOM selectors (LinkedIn as of 2026):**
- Connect button: `button[aria-label*="Connect"]` or `button.pvs-profile-actions__action` containing "Connect"
- Modal "Send without a note": `button[aria-label="Send without a note"]` or `button.artdeco-modal__confirm-dialog-btn`
- These selectors need to be maintainable — LinkedIn changes DOM frequently. Content script should try multiple selector strategies and report `failed` if none work.

**Timing:**
- Wait up to 5 seconds for page to fully render
- Wait up to 3 seconds for modal to appear after clicking Connect
- Report timeout as `failed`

---

## Daily Limit & Safety

- **50 connections/day** hard limit enforced in backend
- Backend rejects queuing if `connection_usage.send_count >= 50` for today
- Random delay between sends: **30-90 seconds** (uniform random)
- Extension respects scheduled times — never sends early
- If LinkedIn shows CAPTCHA: extension pauses 5 minutes, user sees badge change
- Failed connections do NOT count against daily limit
- User can cancel queued connections before they're sent

---

## Testing Strategy

**Backend:**
- Unit tests for new database functions (connection status CRUD, queue ordering, usage tracking)
- Unit tests for scheduled time calculation (random delay staggering)
- Integration tests for all 5 new API endpoints
- Test daily limit enforcement (reject at 50)

**Frontend:**
- ConnectionButton renders correct state for each status
- Dropdown options match the status
- Time display converts UTC to local correctly
- Bulk selection + queue works

**Extension:**
- Manual testing against LinkedIn (automated testing not practical for DOM interaction)
- Test with various profile states: open to connect, already connected, pending invite, restricted profile

---

## Files Created or Modified

### New files:
- `backend/app/routers/connections.py` — new router with 5 endpoints
- `frontend/src/components/ConnectionButton.tsx` — dropdown button component
- `extension/manifest.json` — Chrome extension manifest
- `extension/background.js` — service worker (poll + tab management)
- `extension/content.js` — LinkedIn DOM interaction
- `extension/icon16.png`, `icon48.png`, `icon128.png` — extension icons
- `backend/tests/test_connections.py` — tests for connection endpoints and DB functions

### Modified files:
- `backend/app/database.py` — new table, new columns (migration), 6 new functions
- `backend/app/models.py` — 8 new Pydantic models
- `backend/app/main.py` — include `connections.router`
- `frontend/src/lib/types.ts` — updated Profile interface, new connection types
- `frontend/src/lib/api.ts` — 3 new API functions
- `frontend/src/components/ResultsTable.tsx` — checkbox column, Status column, bulk action bar
- `frontend/src/components/Header.tsx` — connection quota badge
- `frontend/src/app/page.tsx` — pass refetch callback for connection updates
- `backend/app/routers/results.py` — include new connection fields in profile response
