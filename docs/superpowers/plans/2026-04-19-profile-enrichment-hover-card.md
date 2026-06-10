# Profile Enrichment Hover Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover card to the results table that shows enriched LinkedIn profile data (followers, location, education, experience, last post date) scraped on-demand via the Chrome extension, with lazy background pre-fetching and rate limiting.

**Architecture:** Backend stores enrichment data in a new `profile_enrichment` table with two REST endpoints (GET/PUT). Frontend renders a hover card component on profile name/avatar hover, communicates with the extension via `window.postMessage`. Extension opens LinkedIn profile pages in background tabs, scrapes DOM for structured data, reports back to the API. Lazy pre-fetch queues nearby profiles at 1 per 8 seconds.

**Tech Stack:** FastAPI (backend), React/TypeScript/Tailwind (frontend), Chrome Extension MV3 (scraping)

---

### Task 1: Backend — Database Schema & Functions

**Files:**
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add profile_enrichment table creation to `init_db()`**

In `database.py`, add the new table to `SQL_CREATE_TABLES`:

```python
CREATE TABLE IF NOT EXISTS profile_enrichment (
    profile_id INTEGER PRIMARY KEY,
    followers TEXT,
    location TEXT,
    education TEXT,
    experience TEXT,
    last_post_date TEXT,
    scraped_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);
```

- [ ] **Step 2: Add `get_enrichment()` function**

```python
async def get_enrichment(profile_id: int) -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT * FROM profile_enrichment WHERE profile_id = ?",
            (profile_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
```

- [ ] **Step 3: Add `save_enrichment()` function**

```python
async def save_enrichment(
    profile_id: int,
    followers: str | None,
    location: str | None,
    education: str | None,
    experience: str | None,
    last_post_date: str | None,
) -> None:
    scraped_at = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "INSERT INTO profile_enrichment (profile_id, followers, location, education, experience, last_post_date, scraped_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(profile_id) DO UPDATE SET "
            "followers = excluded.followers, location = excluded.location, "
            "education = excluded.education, experience = excluded.experience, "
            "last_post_date = excluded.last_post_date, scraped_at = excluded.scraped_at",
            (profile_id, followers, location, education, experience, last_post_date, scraped_at),
        )
        await conn.commit()
```

- [ ] **Step 4: Run backend to verify DB init works**

Run: `cd /Users/soumyajithui/documents/linkedin-xray-search/backend && python -c "import asyncio; from app.database import init_db; asyncio.run(init_db()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py
git commit -m "feat: add profile_enrichment table and CRUD functions"
```

---

### Task 2: Backend — Pydantic Models & Enrichment Router

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/app/routers/enrichment.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add Pydantic models to `models.py`**

Append to `backend/app/models.py`:

```python
class EnrichmentData(BaseModel):
    followers: str | None = None
    location: str | None = None
    education: str | None = None
    experience: str | None = None
    last_post_date: str | None = None
    scraped_at: str | None = None


class EnrichmentResponse(BaseModel):
    status: Literal["enriched", "not_enriched"]
    data: EnrichmentData | None = None


class EnrichmentUpdate(BaseModel):
    followers: str | None = None
    location: str | None = None
    education: str | None = None
    experience: str | None = None
    last_post_date: str | None = None
```

- [ ] **Step 2: Create `backend/app/routers/enrichment.py`**

```python
from fastapi import APIRouter, HTTPException

from app import database
from app.models import EnrichmentData, EnrichmentResponse, EnrichmentUpdate

router = APIRouter(prefix="/api/profiles")


@router.get("/{profile_id}/enrichment", response_model=EnrichmentResponse)
async def get_enrichment(profile_id: int):
    row = await database.get_enrichment(profile_id)
    if row is None:
        return EnrichmentResponse(status="not_enriched", data=None)
    return EnrichmentResponse(
        status="enriched",
        data=EnrichmentData(
            followers=row["followers"],
            location=row["location"],
            education=row["education"],
            experience=row["experience"],
            last_post_date=row["last_post_date"],
            scraped_at=row["scraped_at"],
        ),
    )


@router.put("/{profile_id}/enrichment", response_model=EnrichmentResponse)
async def save_enrichment(profile_id: int, body: EnrichmentUpdate):
    await database.save_enrichment(
        profile_id=profile_id,
        followers=body.followers,
        location=body.location,
        education=body.education,
        experience=body.experience,
        last_post_date=body.last_post_date,
    )
    row = await database.get_enrichment(profile_id)
    return EnrichmentResponse(
        status="enriched",
        data=EnrichmentData(
            followers=row["followers"],
            location=row["location"],
            education=row["education"],
            experience=row["experience"],
            last_post_date=row["last_post_date"],
            scraped_at=row["scraped_at"],
        ),
    )
```

- [ ] **Step 3: Mount the router in `main.py`**

In `backend/app/main.py`, add the import and include:

```python
from app.routers import search, results, export, settings, quota, connections, enrichment
```

And add:

```python
app.include_router(enrichment.router)
```

- [ ] **Step 4: Test endpoints manually**

Run: `cd /Users/soumyajithui/documents/linkedin-xray-search && npm run dev:backend`

In another terminal:
```bash
curl http://localhost:8000/api/profiles/1/enrichment
# Expected: {"status":"not_enriched","data":null}

curl -X PUT http://localhost:8000/api/profiles/1/enrichment \
  -H "Content-Type: application/json" \
  -d '{"followers":"1,234","location":"United States","education":"MIT","experience":"CEO at Acme","last_post_date":"2026-04-15"}'
# Expected: {"status":"enriched","data":{...}}
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/routers/enrichment.py backend/app/main.py
git commit -m "feat: add enrichment API endpoints (GET/PUT /api/profiles/{id}/enrichment)"
```

---

### Task 3: Frontend — Types & API Functions

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add enrichment types to `types.ts`**

Append to `frontend/src/lib/types.ts`:

```typescript
export interface EnrichmentData {
  followers: string | null;
  location: string | null;
  education: string | null;
  experience: string | null;
  last_post_date: string | null;
  scraped_at: string | null;
}

export interface EnrichmentResponse {
  status: "enriched" | "not_enriched";
  data: EnrichmentData | null;
}
```

- [ ] **Step 2: Add API function to `api.ts`**

Append to `frontend/src/lib/api.ts`:

```typescript
import type { EnrichmentResponse } from "./types";

export async function getEnrichment(profileId: number): Promise<EnrichmentResponse> {
  return fetchJSON(`/api/profiles/${profileId}/enrichment`);
}
```

(Note: the `EnrichmentResponse` import should be added to the existing import from `"./types"` at the top of the file.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat: add enrichment types and API client function"
```

---

### Task 4: Frontend — ProfileHoverCard Component

**Files:**
- Create: `frontend/src/components/ProfileHoverCard.tsx`

- [ ] **Step 1: Create the hover card component**

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import type { Profile, EnrichmentData } from "@/lib/types";
import { getEnrichment } from "@/lib/api";

interface ProfileHoverCardProps {
  profile: Profile;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "N/A";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export default function ProfileHoverCard({ profile, anchorRect, onMouseEnter, onMouseLeave }: ProfileHoverCardProps) {
  const [data, setData] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    getEnrichment(profile.id).then((resp) => {
      if (cancelled) return;
      if (resp.status === "enriched" && resp.data) {
        setData(resp.data);
        setLoading(false);
      } else {
        window.postMessage({
          type: "ENRICH_PROFILE",
          profileId: profile.id,
          profileUrl: profile.profile_url,
        }, "*");
        let polls = 0;
        const interval = setInterval(async () => {
          polls++;
          if (polls > 7 || cancelled) {
            clearInterval(interval);
            if (!cancelled) { setLoading(false); setError(true); }
            return;
          }
          const r = await getEnrichment(profile.id);
          if (r.status === "enriched" && r.data && !cancelled) {
            setData(r.data);
            setLoading(false);
            clearInterval(interval);
          }
        }, 2000);
      }
    }).catch(() => {
      if (!cancelled) { setLoading(false); setError(true); }
    });

    return () => { cancelled = true; };
  }, [profile.id, profile.profile_url]);

  const top = anchorRect.top + window.scrollY;
  const left = anchorRect.right + 8;
  const flipLeft = left + 320 > window.innerWidth;
  const cardLeft = flipLeft ? anchorRect.left - 320 - 8 : left;

  return (
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 w-[300px] bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-4"
      style={{ top: `${top}px`, left: `${cardLeft}px` }}
    >
      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-neutral-700" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-slate-200 dark:bg-neutral-700 rounded w-3/4" />
              <div className="h-3 bg-slate-200 dark:bg-neutral-700 rounded w-1/2" />
            </div>
          </div>
          <div className="h-3 bg-slate-200 dark:bg-neutral-700 rounded w-full" />
          <div className="h-3 bg-slate-200 dark:bg-neutral-700 rounded w-2/3" />
          <div className="h-3 bg-slate-200 dark:bg-neutral-700 rounded w-3/4" />
          <div className="h-3 bg-slate-200 dark:bg-neutral-700 rounded w-1/2" />
        </div>
      ) : error ? (
        <div className="text-sm text-slate-500 dark:text-neutral-400 text-center py-4">
          Could not load profile data
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {profile.thumbnail_url ? (
              <img src={profile.thumbnail_url} alt={profile.name} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                {profile.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100 truncate">{profile.name}</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 flex items-center gap-1">
                <span>📍</span> {data.location || "N/A"}
              </p>
            </div>
          </div>
          <div className="border-t border-slate-100 dark:border-neutral-700 pt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300">
              <span className="text-slate-400 dark:text-neutral-500 w-4">👥</span>
              <span>{data.followers || "N/A"} {data.followers ? "followers" : ""}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300">
              <span className="text-slate-400 dark:text-neutral-500 w-4">💼</span>
              <span>{truncate(data.experience, 60)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300">
              <span className="text-slate-400 dark:text-neutral-500 w-4">🎓</span>
              <span>{truncate(data.education, 60)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300">
              <span className="text-slate-400 dark:text-neutral-500 w-4">📝</span>
              <span>Last post: {formatRelativeDate(data.last_post_date)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ProfileHoverCard.tsx
git commit -m "feat: add ProfileHoverCard component with loading/error/data states"
```

---

### Task 5: Frontend — Integrate Hover Card into ResultsTable

**Files:**
- Modify: `frontend/src/components/ResultsTable.tsx`

- [ ] **Step 1: Add hover state and import**

At the top of `ResultsTable.tsx`, add the import:

```typescript
import ProfileHoverCard from "./ProfileHoverCard";
```

Add state inside the component (after existing `useState` declarations):

```typescript
const [hoveredProfile, setHoveredProfile] = useState<Profile | null>(null);
const [hoverAnchorRect, setHoverAnchorRect] = useState<DOMRect | null>(null);
const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleProfileMouseEnter = (profile: Profile, e: React.MouseEvent) => {
  if (leaveTimeout.current) { clearTimeout(leaveTimeout.current); leaveTimeout.current = null; }
  hoverTimeout.current = setTimeout(() => {
    setHoveredProfile(profile);
    setHoverAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
  }, 300);
};

const handleProfileMouseLeave = () => {
  if (hoverTimeout.current) { clearTimeout(hoverTimeout.current); hoverTimeout.current = null; }
  leaveTimeout.current = setTimeout(() => {
    setHoveredProfile(null);
    setHoverAnchorRect(null);
  }, 200);
};

const handleCardMouseEnter = () => {
  if (leaveTimeout.current) { clearTimeout(leaveTimeout.current); leaveTimeout.current = null; }
};

const handleCardMouseLeave = () => {
  leaveTimeout.current = setTimeout(() => {
    setHoveredProfile(null);
    setHoverAnchorRect(null);
  }, 200);
};
```

- [ ] **Step 2: Wrap profile name/avatar cell with hover handlers**

Replace the Name `<td>` content (the `<div className="flex items-center gap-2 truncate">` block inside the Name cell) with:

```tsx
<td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100 overflow-hidden">
  <div
    className="flex items-center gap-2 truncate cursor-pointer"
    onMouseEnter={(e) => handleProfileMouseEnter(profile, e)}
    onMouseLeave={handleProfileMouseLeave}
  >
    <ProfileAvatar name={profile.name} thumbnailUrl={profile.thumbnail_url} />
    <span className="truncate" title={profile.name}>{profile.name}</span>
  </div>
</td>
```

- [ ] **Step 3: Render the hover card**

Right before the closing `</div>` of the root component (the first `<div className="bg-white...">`), add:

```tsx
{hoveredProfile && hoverAnchorRect && (
  <ProfileHoverCard
    profile={hoveredProfile}
    anchorRect={hoverAnchorRect}
    onMouseEnter={handleCardMouseEnter}
    onMouseLeave={handleCardMouseLeave}
  />
)}
```

- [ ] **Step 4: Test in browser**

Run: `npm run dev`
Open http://localhost:3000, hover over a profile name. Should see the loading skeleton appear after 300ms. Card disappears on mouse leave after 200ms grace period.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ResultsTable.tsx
git commit -m "feat: integrate ProfileHoverCard into ResultsTable with hover delay logic"
```

---

### Task 6: Chrome Extension — Enrichment Content Script

**Files:**
- Create: `extension/enrichment-content.js`

- [ ] **Step 1: Create the enrichment scraper content script**

```javascript
(function () {
  const API_BASE = "http://localhost:8000";

  console.log("[XRay Enrich] Content script loaded on:", window.location.href);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getFollowers() {
    const subtitles = document.querySelectorAll(".text-body-small, .pvs-header__subtitle");
    for (const el of subtitles) {
      const text = el.textContent || "";
      const match = text.match(/([\d,]+)\s*followers/i);
      if (match) return match[1];
    }
    const allText = document.body.textContent || "";
    const bodyMatch = allText.match(/([\d,]+)\s*followers/i);
    return bodyMatch ? bodyMatch[1] : null;
  }

  function getLocation() {
    const locationEl = document.querySelector(".text-body-small.inline.t-black--light.break-words");
    if (locationEl) return locationEl.textContent?.trim() || null;
    const profileHeader = document.querySelector(".mt2.relative");
    if (profileHeader) {
      const spans = profileHeader.querySelectorAll("span.text-body-small");
      for (const span of spans) {
        const text = span.textContent?.trim() || "";
        if (text && !text.includes("followers") && !text.includes("connections") && text.length < 80) {
          return text;
        }
      }
    }
    return null;
  }

  function getExperience() {
    const expSection = document.querySelector("#experience");
    if (!expSection) return null;
    const container = expSection.closest("section");
    if (!container) return null;
    const titleEl = container.querySelector(".t-bold span[aria-hidden='true']");
    const companyEl = container.querySelector(".t-normal span[aria-hidden='true']");
    const title = titleEl?.textContent?.trim() || "";
    const company = companyEl?.textContent?.trim() || "";
    if (title && company) return `${title} at ${company}`;
    if (title) return title;
    return null;
  }

  function getEducation() {
    const eduSection = document.querySelector("#education");
    if (!eduSection) return null;
    const container = eduSection.closest("section");
    if (!container) return null;
    const schoolEl = container.querySelector(".t-bold span[aria-hidden='true']");
    return schoolEl?.textContent?.trim() || null;
  }

  function getLastPostDate() {
    const activitySection = document.querySelector("#content_collections");
    if (!activitySection) return null;
    const container = activitySection.closest("section");
    if (!container) return null;
    const timeEls = container.querySelectorAll("time, .feed-shared-actor__sub-description span[aria-hidden='true']");
    for (const el of timeEls) {
      const text = el.textContent?.trim() || "";
      if (text) {
        const dateMatch = text.match(/(\d{1,2}[dwmyh])\b/i);
        if (dateMatch) {
          return estimateDate(dateMatch[1]);
        }
      }
    }
    const spans = container.querySelectorAll("span[aria-hidden='true']");
    for (const span of spans) {
      const text = span.textContent?.trim() || "";
      const relMatch = text.match(/(\d+)\s*(day|week|month|year|hour|minute)s?\s*ago/i);
      if (relMatch) {
        return estimateDate(`${relMatch[1]}${relMatch[2][0]}`);
      }
    }
    return null;
  }

  function estimateDate(shorthand) {
    const now = new Date();
    const num = parseInt(shorthand);
    const unit = shorthand.replace(/\d+/, "").toLowerCase();
    switch (unit) {
      case "h": now.setHours(now.getHours() - num); break;
      case "d": now.setDate(now.getDate() - num); break;
      case "w": now.setDate(now.getDate() - num * 7); break;
      case "m": now.setMonth(now.getMonth() - num); break;
      case "y": now.setFullYear(now.getFullYear() - num); break;
    }
    return now.toISOString().split("T")[0];
  }

  async function scrapeProfile() {
    await sleep(3000);

    const data = {
      followers: getFollowers(),
      location: getLocation(),
      experience: getExperience(),
      education: getEducation(),
      last_post_date: getLastPostDate(),
    };

    console.log("[XRay Enrich] Scraped data:", JSON.stringify(data));
    return data;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SCRAPE_PROFILE") {
      console.log("[XRay Enrich] Received SCRAPE_PROFILE for profileId:", message.profileId);
      scrapeProfile().then((data) => {
        chrome.runtime.sendMessage({
          type: "ENRICHMENT_RESULT",
          profileId: message.profileId,
          data: data,
        });
      });
      sendResponse({ received: true });
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add extension/enrichment-content.js
git commit -m "feat: add enrichment content script for LinkedIn profile scraping"
```

---

### Task 7: Chrome Extension — Dashboard Listener Content Script

**Files:**
- Create: `extension/dashboard-content.js`

- [ ] **Step 1: Create dashboard content script that bridges window.postMessage to extension**

```javascript
(function () {
  console.log("[XRay Dashboard] Content script loaded on dashboard");

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "ENRICH_PROFILE") {
      console.log("[XRay Dashboard] Forwarding ENRICH_PROFILE to background:", event.data);
      chrome.runtime.sendMessage({
        type: "ENRICH_PROFILE",
        profileId: event.data.profileId,
        profileUrl: event.data.profileUrl,
      });
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add extension/dashboard-content.js
git commit -m "feat: add dashboard content script to bridge postMessage to extension"
```

---

### Task 8: Chrome Extension — Update background.js for Enrichment

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Add enrichment queue state and constants at top of background.js**

After existing constants (`const PAUSE_DURATION = 5 * 60 * 1000;`), add:

```javascript
const ENRICH_INTERVAL_MS = 8000;
const ENRICH_SESSION_LIMIT = 50;

let enrichQueue = [];
let enrichProcessing = false;
let enrichSessionCount = 0;
let enrichPaused = false;
let enrichCurrentTabId = null;
```

- [ ] **Step 2: Add enrichment message handler**

Before the existing `chrome.runtime.onMessage.addListener`, or inside it, add handling for the new message types. Replace the entire `chrome.runtime.onMessage.addListener` with:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("Received message:", JSON.stringify(message));

  if (message.type === "CONNECTION_RESULT") {
    const profileId = currentItem?.profile_id;
    if (!profileId) {
      log("No currentItem, ignoring result");
      return;
    }

    reportResult(profileId, message.status, message.error).then(() => {
      const keepTab = message.status !== "sent";
      cleanup(keepTab);

      if (message.status === "sent") {
        setBadge("OK", "#22c55e");
        setTimeout(clearBadge, 3000);
      } else if (message.error === "captcha") {
        setBadge("!", "#ef4444");
        paused = true;
        setTimeout(() => {
          paused = false;
          clearBadge();
        }, PAUSE_DURATION);
      } else {
        setBadge("X", "#ef4444");
        setTimeout(clearBadge, 3000);
      }
    });

    sendResponse({ received: true });
  }

  if (message.type === "ENRICH_PROFILE") {
    log("Enrich request for profile:", message.profileId);
    const alreadyQueued = enrichQueue.some((q) => q.profileId === message.profileId);
    if (!alreadyQueued) {
      enrichQueue.push({ profileId: message.profileId, profileUrl: message.profileUrl });
      processEnrichQueue();
    }
    sendResponse({ received: true });
  }

  if (message.type === "ENRICHMENT_RESULT") {
    log("Enrichment scraped data for profile:", message.profileId, JSON.stringify(message.data));
    saveEnrichment(message.profileId, message.data).then(() => {
      if (enrichCurrentTabId) {
        chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
        enrichCurrentTabId = null;
      }
      enrichProcessing = false;
      setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
    });
    sendResponse({ received: true });
  }
});
```

- [ ] **Step 3: Add enrichment processing functions**

Append before the `chrome.tabs.onRemoved.addListener` block:

```javascript
async function saveEnrichment(profileId, data) {
  try {
    await fetch(`${API_BASE}/api/profiles/${profileId}/enrichment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    log("Enrichment saved for profile:", profileId);
  } catch (err) {
    log("Failed to save enrichment:", err.message);
  }
}

async function processEnrichQueue() {
  if (enrichProcessing || enrichPaused || enrichQueue.length === 0) return;
  if (enrichSessionCount >= ENRICH_SESSION_LIMIT) {
    log("Enrichment session limit reached:", enrichSessionCount);
    return;
  }

  enrichProcessing = true;
  const item = enrichQueue.shift();
  enrichSessionCount++;
  log("Processing enrichment for:", item.profileId, item.profileUrl);

  try {
    const tab = await chrome.tabs.create({ url: item.profileUrl, active: false });
    enrichCurrentTabId = tab.id;

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === enrichCurrentTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        log("Enrichment tab loaded, sending SCRAPE_PROFILE to tab:", tabId);

        chrome.tabs.sendMessage(tabId, {
          type: "SCRAPE_PROFILE",
          profileId: item.profileId,
        }).catch((err) => {
          log("Enrichment sendMessage failed, injecting script:", err.message);
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["enrichment-content.js"],
          }).then(() => {
            chrome.tabs.sendMessage(tabId, {
              type: "SCRAPE_PROFILE",
              profileId: item.profileId,
            }).catch((err2) => {
              log("Enrichment retry failed:", err2.message);
              if (enrichCurrentTabId) chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
              enrichCurrentTabId = null;
              enrichProcessing = false;
              setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
            });
          }).catch((err3) => {
            log("Enrichment script injection failed:", err3.message);
            if (enrichCurrentTabId) chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
            enrichCurrentTabId = null;
            enrichProcessing = false;
            setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
          });
        });
      }
    });

    // Timeout: if scraping takes more than 15s, abandon
    setTimeout(() => {
      if (enrichProcessing && enrichCurrentTabId === tab.id) {
        log("Enrichment timeout for profile:", item.profileId);
        chrome.tabs.remove(tab.id).catch(() => {});
        enrichCurrentTabId = null;
        enrichProcessing = false;
        setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
      }
    }, 15000);
  } catch (err) {
    log("Enrich tab creation failed:", err.message);
    enrichProcessing = false;
    setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
  }
}
```

- [ ] **Step 4: Update the `chrome.tabs.onRemoved` listener to handle enrichment tabs**

Replace the existing `chrome.tabs.onRemoved.addListener` with:

```javascript
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId && processing) {
    log("Tab closed manually:", tabId);
    const profileId = currentItem?.profile_id;
    if (profileId) {
      reportResult(profileId, "failed", "tab_closed_manually");
    }
    cleanup();
    setBadge("X", "#ef4444");
    setTimeout(clearBadge, 3000);
  }
  if (tabId === enrichCurrentTabId && enrichProcessing) {
    log("Enrichment tab closed manually:", tabId);
    enrichCurrentTabId = null;
    enrichProcessing = false;
    setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add extension/background.js
git commit -m "feat: add enrichment queue processing to extension background worker"
```

---

### Task 9: Chrome Extension — Update manifest.json

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Update manifest to include new content scripts**

Replace the `content_scripts` array in `manifest.json` with:

```json
"content_scripts": [
  {
    "matches": ["https://*.linkedin.com/in/*", "https://*.linkedin.com/preload/custom-invite/*"],
    "js": ["content.js", "enrichment-content.js"],
    "run_at": "document_idle"
  },
  {
    "matches": ["http://localhost:3000/*"],
    "js": ["dashboard-content.js"],
    "run_at": "document_idle"
  }
]
```

Also add `"http://localhost:3000/*"` to `host_permissions`:

```json
"host_permissions": [
  "https://*.linkedin.com/*",
  "http://localhost:8000/*",
  "http://localhost:3000/*"
]
```

- [ ] **Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "feat: update manifest with enrichment and dashboard content scripts"
```

---

### Task 10: Frontend — Lazy Pre-fetch Logic

**Files:**
- Modify: `frontend/src/components/ResultsTable.tsx`

- [ ] **Step 1: Add pre-fetch trigger after hover**

Inside the `ResultsTable` component, after the existing hover handler functions, add:

```typescript
const prefetchSent = useRef<Set<number>>(new Set());

useEffect(() => {
  if (!hoveredProfile) return;

  const currentIndex = paginated.findIndex((p) => p.id === hoveredProfile.id);
  if (currentIndex === -1) return;

  const toPrefetch = paginated
    .slice(currentIndex + 1, currentIndex + 6)
    .filter((p) => !prefetchSent.current.has(p.id));

  for (const p of toPrefetch) {
    prefetchSent.current.add(p.id);
    window.postMessage({
      type: "ENRICH_PROFILE",
      profileId: p.id,
      profileUrl: p.profile_url,
    }, "*");
  }
}, [hoveredProfile, paginated]);
```

- [ ] **Step 2: Test full flow in browser**

1. Run `npm run dev`
2. Open http://localhost:3000
3. Ensure the extension is loaded in Chrome (reload it to pick up manifest changes)
4. Hover over a profile name
5. Verify: loading skeleton appears → after 3-5s data populates the card
6. Verify: next 5 profiles in the list get enriched in background (check extension logs in chrome://extensions service worker console)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ResultsTable.tsx
git commit -m "feat: add lazy pre-fetch of nearby profiles on hover"
```

---

### Task 11: Final Integration Test & Polish

**Files:**
- Multiple (no new files)

- [ ] **Step 1: Test complete flow end-to-end**

1. Start backend: `npm run dev:backend`
2. Start frontend: `npm run dev:frontend`
3. Reload extension in Chrome (chrome://extensions → reload)
4. Search for profiles (if not already populated)
5. Hover over a profile name → verify card appears with skeleton → data loads
6. Move mouse into the card → verify it stays visible
7. Move mouse away → verify card disappears after 200ms
8. Hover over another profile → verify different data loads
9. Check extension console for rate-limiting logs (8s between scrapes)

- [ ] **Step 2: Run existing backend tests to ensure no regressions**

Run: `cd /Users/soumyajithui/documents/linkedin-xray-search/backend && python -m pytest tests/ -v`
Expected: All existing tests pass.

- [ ] **Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "feat: profile enrichment hover card — complete integration"
```
