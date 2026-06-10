# LinkedIn X-Ray Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local LinkedIn profile scraper that queries Google Custom Search API with healthcare/AI keywords, stores results in SQLite, and exports to Excel — with a professional Next.js dashboard and Python FastAPI backend.

**Architecture:** Monorepo with `frontend/` (Next.js + TypeScript + Tailwind) and `backend/` (FastAPI + SQLite + openpyxl). Backend proxies Google CSE API calls, streams progress via SSE, and persists results. Frontend provides keyword input, real-time progress, results table, settings panel, and Excel export.

**Tech Stack:** Next.js 14+, TypeScript, Tailwind CSS, Python 3.11+, FastAPI, aiosqlite, httpx, openpyxl, uvicorn

---

## File Structure

### Backend (`backend/`)

| File | Responsibility |
|---|---|
| `backend/app/__init__.py` | Package marker |
| `backend/app/main.py` | FastAPI app, CORS, lifespan (DB init), router includes |
| `backend/app/config.py` | Load `.env`, resolve settings (env → DB fallback), log config |
| `backend/app/database.py` | SQLite connection, table creation, all DB queries |
| `backend/app/models.py` | Pydantic request/response schemas |
| `backend/app/routers/__init__.py` | Package marker |
| `backend/app/routers/search.py` | `POST /api/search` — SSE streaming search |
| `backend/app/routers/results.py` | `GET /api/results` — paginated profile list |
| `backend/app/routers/export.py` | `GET /api/export` — Excel download |
| `backend/app/routers/settings.py` | `GET /api/settings`, `PUT /api/settings` |
| `backend/app/routers/quota.py` | `GET /api/quota` |
| `backend/app/services/__init__.py` | Package marker |
| `backend/app/services/google_search.py` | Google CSE API client, parsing, retry logic |
| `backend/app/services/excel_export.py` | Generate `.xlsx` from profile data |
| `backend/requirements.txt` | Python dependencies |
| `backend/tests/__init__.py` | Package marker |
| `backend/tests/test_database.py` | DB layer tests |
| `backend/tests/test_google_search.py` | Google search service tests |
| `backend/tests/test_excel_export.py` | Excel export tests |
| `backend/tests/test_routers.py` | API endpoint integration tests |

### Frontend (`frontend/`)

| File | Responsibility |
|---|---|
| `frontend/src/app/layout.tsx` | Root layout with Inter font, metadata |
| `frontend/src/app/page.tsx` | Main dashboard page, composes all sections |
| `frontend/src/app/globals.css` | Tailwind base + custom styles |
| `frontend/src/components/Header.tsx` | App title, settings gear, quota badge |
| `frontend/src/components/SettingsPanel.tsx` | Slide-out panel for API key + CX ID |
| `frontend/src/components/SearchPanel.tsx` | Keyword chips, max pages input, scan button |
| `frontend/src/components/KeywordChips.tsx` | Chip input component |
| `frontend/src/components/ProgressArea.tsx` | Per-keyword progress display during search |
| `frontend/src/components/ResultsTable.tsx` | Sortable, filterable profile table |
| `frontend/src/components/ActivityLog.tsx` | Collapsible debug log panel |
| `frontend/src/lib/api.ts` | API client functions (fetch wrappers) |
| `frontend/src/lib/types.ts` | TypeScript interfaces |
| `frontend/src/lib/constants.ts` | Default keywords, API base URL |
| `frontend/src/hooks/useSSESearch.ts` | SSE connection hook for search streaming |

### Root

| File | Responsibility |
|---|---|
| `.env.example` | Template for required env vars |
| `.env` | Actual secrets (gitignored) |
| `.gitignore` | Ignore node_modules, __pycache__, .env, data.db, logs/ |
| `README.md` | Setup and usage instructions |

---

## Task 1: Project Scaffolding & Configuration

**Files:**
- Create: `.gitignore`, `.env.example`, `backend/requirements.txt`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/tests/__init__.py`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
venv/
.venv/

# Node
node_modules/
.next/
out/

# Environment
.env

# Database
backend/data.db

# Logs
backend/logs/

# OS
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Create `.env.example`**

```env
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_CX_ID=your_programmable_search_engine_id_here
LOG_LEVEL=INFO
```

- [ ] **Step 3: Create `backend/requirements.txt`**

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
httpx==0.28.1
aiosqlite==0.20.0
openpyxl==3.1.5
python-dotenv==1.0.1
sse-starlette==2.2.1
pytest==8.3.4
pytest-asyncio==0.24.0
httpx[http2]==0.28.1
```

- [ ] **Step 4: Create `backend/app/__init__.py` and `backend/tests/__init__.py`**

Both files are empty (package markers).

- [ ] **Step 5: Create `backend/app/config.py`**

```python
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

DATABASE_PATH = Path(__file__).resolve().parent.parent / "data.db"
LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
DAILY_QUOTA_LIMIT = 100
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CX_ID = os.getenv("GOOGLE_CX_ID", "")
```

- [ ] **Step 6: Set up Python virtual environment and install dependencies**

Run:
```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example backend/requirements.txt backend/app/__init__.py backend/app/config.py backend/tests/__init__.py
git commit -m "feat: project scaffolding with config and dependencies"
```

---

## Task 2: Database Layer

**Files:**
- Create: `backend/app/database.py`, `backend/tests/test_database.py`

- [ ] **Step 1: Write failing tests for database layer**

Create `backend/tests/test_database.py`:

```python
import pytest
import asyncio
import json
import os
from pathlib import Path

TEST_DB = Path(__file__).parent / "test_data.db"


@pytest.fixture(autouse=True)
def clean_db():
    if TEST_DB.exists():
        TEST_DB.unlink()
    yield
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture
def db_module():
    from app import database
    database._db_path = TEST_DB
    return database


@pytest.mark.asyncio
async def test_init_creates_tables(db_module):
    await db_module.init_db()
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = [row[0] for row in await cursor.fetchall()]
    assert "api_usage" in tables
    assert "profiles" in tables
    assert "settings" in tables


@pytest.mark.asyncio
async def test_upsert_profile_insert(db_module):
    await db_module.init_db()
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "AI expert", "Healthcare AI")
    profiles = await db_module.get_all_profiles()
    assert len(profiles) == 1
    assert profiles[0]["name"] == "Alice Smith"
    assert profiles[0]["profile_url"] == "https://linkedin.com/in/alice"
    assert json.loads(profiles[0]["matched_keywords"]) == ["Healthcare AI"]


@pytest.mark.asyncio
async def test_upsert_profile_merges_keywords(db_module):
    await db_module.init_db()
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "AI expert", "Healthcare AI")
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "AI expert", "Medtech")
    profiles = await db_module.get_all_profiles()
    assert len(profiles) == 1
    keywords = json.loads(profiles[0]["matched_keywords"])
    assert "Healthcare AI" in keywords
    assert "Medtech" in keywords


@pytest.mark.asyncio
async def test_upsert_profile_updates_longer_snippet(db_module):
    await db_module.init_db()
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "Short", "Healthcare AI")
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "A much longer snippet with more details about Alice", "Medtech")
    profiles = await db_module.get_all_profiles()
    assert profiles[0]["snippet"] == "A much longer snippet with more details about Alice"


@pytest.mark.asyncio
async def test_upsert_profile_keeps_longer_existing_snippet(db_module):
    await db_module.init_db()
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "A long existing snippet here", "Healthcare AI")
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "Short", "Medtech")
    profiles = await db_module.get_all_profiles()
    assert profiles[0]["snippet"] == "A long existing snippet here"


@pytest.mark.asyncio
async def test_no_duplicate_keywords(db_module):
    await db_module.init_db()
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "AI expert", "Healthcare AI")
    await db_module.upsert_profile("Alice Smith", "https://linkedin.com/in/alice", "AI expert", "Healthcare AI")
    profiles = await db_module.get_all_profiles()
    assert json.loads(profiles[0]["matched_keywords"]) == ["Healthcare AI"]


@pytest.mark.asyncio
async def test_get_profiles_paginated(db_module):
    await db_module.init_db()
    for i in range(25):
        await db_module.upsert_profile(f"User {i}", f"https://linkedin.com/in/user{i}", f"Bio {i}", "Healthcare AI")
    page1 = await db_module.get_all_profiles(limit=10, offset=0)
    page2 = await db_module.get_all_profiles(limit=10, offset=10)
    page3 = await db_module.get_all_profiles(limit=10, offset=20)
    assert len(page1) == 10
    assert len(page2) == 10
    assert len(page3) == 5


@pytest.mark.asyncio
async def test_get_profile_count(db_module):
    await db_module.init_db()
    for i in range(5):
        await db_module.upsert_profile(f"User {i}", f"https://linkedin.com/in/user{i}", f"Bio {i}", "Healthcare AI")
    count = await db_module.get_profile_count()
    assert count == 5


@pytest.mark.asyncio
async def test_settings_crud(db_module):
    await db_module.init_db()
    await db_module.set_setting("api_key", "test_key_123")
    val = await db_module.get_setting("api_key")
    assert val == "test_key_123"
    await db_module.set_setting("api_key", "updated_key")
    val = await db_module.get_setting("api_key")
    assert val == "updated_key"


@pytest.mark.asyncio
async def test_get_setting_returns_none_if_missing(db_module):
    await db_module.init_db()
    val = await db_module.get_setting("nonexistent")
    assert val is None


@pytest.mark.asyncio
async def test_api_usage_tracking(db_module):
    await db_module.init_db()
    count = await db_module.get_daily_usage("2026-04-18")
    assert count == 0
    await db_module.increment_daily_usage("2026-04-18")
    await db_module.increment_daily_usage("2026-04-18")
    count = await db_module.get_daily_usage("2026-04-18")
    assert count == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_database.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.database'`

- [ ] **Step 3: Implement `backend/app/database.py`**

```python
import json
from datetime import date
from pathlib import Path

import aiosqlite

from app.config import DATABASE_PATH

_db_path: Path = DATABASE_PATH

SQL_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    profile_url TEXT UNIQUE NOT NULL,
    snippet TEXT,
    matched_keywords TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
    date TEXT UNIQUE NOT NULL,
    call_count INTEGER DEFAULT 0
);
"""


async def _connect() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(_db_path)
    conn.row_factory = aiosqlite.Row
    return conn


async def init_db() -> None:
    async with await _connect() as conn:
        await conn.executescript(SQL_CREATE_TABLES)
        await conn.commit()


async def upsert_profile(name: str, profile_url: str, snippet: str, keyword: str) -> None:
    async with await _connect() as conn:
        cursor = await conn.execute(
            "SELECT matched_keywords, snippet FROM profiles WHERE profile_url = ?",
            (profile_url,),
        )
        row = await cursor.fetchone()

        if row is None:
            await conn.execute(
                "INSERT INTO profiles (name, profile_url, snippet, matched_keywords) VALUES (?, ?, ?, ?)",
                (name, profile_url, snippet, json.dumps([keyword])),
            )
        else:
            existing_keywords = json.loads(row["matched_keywords"])
            if keyword not in existing_keywords:
                existing_keywords.append(keyword)
            existing_snippet = row["snippet"] or ""
            new_snippet = snippet if len(snippet) > len(existing_snippet) else existing_snippet
            await conn.execute(
                "UPDATE profiles SET matched_keywords = ?, snippet = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_url = ?",
                (json.dumps(existing_keywords), new_snippet, profile_url),
            )
        await conn.commit()


async def get_all_profiles(limit: int = 100, offset: int = 0) -> list[dict]:
    async with await _connect() as conn:
        cursor = await conn.execute(
            "SELECT * FROM profiles ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_profile_count() -> int:
    async with await _connect() as conn:
        cursor = await conn.execute("SELECT COUNT(*) as cnt FROM profiles")
        row = await cursor.fetchone()
        return row["cnt"]


async def set_setting(key: str, value: str) -> None:
    async with await _connect() as conn:
        await conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await conn.commit()


async def get_setting(key: str) -> str | None:
    async with await _connect() as conn:
        cursor = await conn.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None


async def get_daily_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with await _connect() as conn:
        cursor = await conn.execute(
            "SELECT call_count FROM api_usage WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["call_count"] if row else 0


async def increment_daily_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with await _connect() as conn:
        await conn.execute(
            "INSERT INTO api_usage (date, call_count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1",
            (date_str,),
        )
        await conn.commit()
        cursor = await conn.execute(
            "SELECT call_count FROM api_usage WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["call_count"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_database.py -v
```
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py backend/tests/test_database.py
git commit -m "feat: SQLite database layer with profiles, settings, and usage tracking"
```

---

## Task 3: Pydantic Models

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Create `backend/app/models.py`**

```python
from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    keywords: list[str] = Field(min_length=1)
    max_pages: int = Field(default=5, ge=1, le=10)


class ProfileResponse(BaseModel):
    id: int
    name: str
    profile_url: str
    snippet: str | None
    matched_keywords: list[str]
    created_at: str
    updated_at: str


class ProfileListResponse(BaseModel):
    profiles: list[ProfileResponse]
    total: int


class SettingsResponse(BaseModel):
    api_key_set: bool
    api_key_masked: str
    cx_id: str


class SettingsUpdate(BaseModel):
    api_key: str | None = None
    cx_id: str | None = None


class QuotaResponse(BaseModel):
    used: int
    limit: int
    date: str
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: Pydantic request/response schemas"
```

---

## Task 4: Google Search Service

**Files:**
- Create: `backend/app/services/__init__.py`, `backend/app/services/google_search.py`, `backend/tests/test_google_search.py`

- [ ] **Step 1: Create `backend/app/services/__init__.py`**

Empty file (package marker).

- [ ] **Step 2: Write failing tests for Google search service**

Create `backend/tests/test_google_search.py`:

```python
import pytest
import json

from app.services.google_search import parse_search_results, build_search_url


def test_build_search_url():
    url = build_search_url("Healthcare AI", "test_key", "test_cx", start=1)
    assert "key=test_key" in url
    assert "cx=test_cx" in url
    assert "site%3Alinkedin.com%2Fin" in url or "site:linkedin.com/in" in url
    assert "Healthcare+AI" in url or "Healthcare%20AI" in url
    assert "start=1" in url


def test_build_search_url_pagination():
    url = build_search_url("Medtech", "k", "c", start=11)
    assert "start=11" in url


def test_parse_search_results_valid():
    raw = {
        "items": [
            {
                "title": "Alice Smith - CEO - HealthCo | LinkedIn",
                "link": "https://www.linkedin.com/in/alicesmith",
                "snippet": "Alice Smith is the CEO of HealthCo, focusing on AI in healthcare...",
            },
            {
                "title": "Bob Jones - CTO | LinkedIn",
                "link": "https://www.linkedin.com/in/bobjones",
                "snippet": "Bob Jones builds medical AI systems...",
            },
        ]
    }
    results = parse_search_results(raw)
    assert len(results) == 2
    assert results[0]["name"] == "Alice Smith - CEO - HealthCo"
    assert results[0]["profile_url"] == "https://www.linkedin.com/in/alicesmith"
    assert results[0]["snippet"] == "Alice Smith is the CEO of HealthCo, focusing on AI in healthcare..."
    assert results[1]["name"] == "Bob Jones - CTO"


def test_parse_search_results_empty():
    results = parse_search_results({})
    assert results == []
    results = parse_search_results({"items": []})
    assert results == []


def test_parse_search_results_strips_linkedin_suffix():
    raw = {
        "items": [
            {
                "title": "Jane Doe | LinkedIn",
                "link": "https://www.linkedin.com/in/janedoe",
                "snippet": "Some bio",
            }
        ]
    }
    results = parse_search_results(raw)
    assert results[0]["name"] == "Jane Doe"


def test_parse_search_results_handles_missing_fields():
    raw = {
        "items": [
            {
                "title": "No Link Person | LinkedIn",
                "snippet": "Bio text",
            },
            {
                "link": "https://www.linkedin.com/in/noname",
                "snippet": "Bio text",
            },
        ]
    }
    results = parse_search_results(raw)
    assert len(results) == 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_google_search.py -v
```
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 4: Implement `backend/app/services/google_search.py`**

```python
import asyncio
import logging
import re
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

GOOGLE_CSE_BASE = "https://www.googleapis.com/customsearch/v1"


def build_search_url(keyword: str, api_key: str, cx_id: str, start: int = 1) -> str:
    params = {
        "key": api_key,
        "cx": cx_id,
        "q": f'site:linkedin.com/in "{keyword}"',
        "start": start,
    }
    return f"{GOOGLE_CSE_BASE}?{urlencode(params)}"


def parse_search_results(raw: dict) -> list[dict]:
    items = raw.get("items", [])
    results = []
    for item in items:
        title = item.get("title", "")
        link = item.get("link", "")
        snippet = item.get("snippet", "")

        if not title or not link:
            continue

        name = re.sub(r"\s*[\|\-–—]\s*LinkedIn\s*$", "", title).strip()

        results.append({
            "name": name,
            "profile_url": link,
            "snippet": snippet,
        })
    return results


async def fetch_search_page(
    keyword: str,
    api_key: str,
    cx_id: str,
    start: int,
    client: httpx.AsyncClient,
) -> dict:
    url = build_search_url(keyword, api_key, cx_id, start)
    masked_url = url.replace(api_key, "***")
    logger.debug(f"Requesting: {masked_url}")

    try:
        response = await client.get(url, timeout=10.0)
    except httpx.TimeoutException:
        logger.warning(f"Timeout fetching page start={start} for '{keyword}'")
        raise
    except httpx.HTTPError as e:
        logger.warning(f"HTTP error fetching page start={start} for '{keyword}': {e}")
        raise

    if response.status_code == 429 or response.status_code >= 500:
        logger.info(f"Retryable status {response.status_code}, retrying in 2s...")
        await asyncio.sleep(2)
        response = await client.get(url, timeout=10.0)

    if response.status_code != 200:
        logger.error(f"Google API error {response.status_code}: {response.text[:200]}")
        raise httpx.HTTPStatusError(
            f"Google API returned {response.status_code}",
            request=response.request,
            response=response,
        )

    return response.json()
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_google_search.py -v
```
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/__init__.py backend/app/services/google_search.py backend/tests/test_google_search.py
git commit -m "feat: Google Custom Search service with URL builder, parser, and async fetch"
```

---

## Task 5: Excel Export Service

**Files:**
- Create: `backend/app/services/excel_export.py`, `backend/tests/test_excel_export.py`

- [ ] **Step 1: Write failing tests for Excel export**

Create `backend/tests/test_excel_export.py`:

```python
import pytest
import json
from io import BytesIO
from openpyxl import load_workbook

from app.services.excel_export import generate_excel


def test_generate_excel_basic():
    profiles = [
        {
            "name": "Alice Smith",
            "profile_url": "https://linkedin.com/in/alice",
            "snippet": "AI expert in healthcare",
            "matched_keywords": json.dumps(["Healthcare AI", "Medtech"]),
        },
        {
            "name": "Bob Jones",
            "profile_url": "https://linkedin.com/in/bob",
            "snippet": "Medical device founder",
            "matched_keywords": json.dumps(["Medtech"]),
        },
    ]
    output = generate_excel(profiles)
    assert isinstance(output, BytesIO)

    wb = load_workbook(output)
    ws = wb.active
    assert ws.title == "LinkedIn Profiles"

    headers = [ws.cell(row=1, column=c).value for c in range(1, 5)]
    assert headers == ["Name", "Profile URL", "Bio Snippet", "Matched Keywords"]

    assert ws.cell(row=2, column=1).value == "Alice Smith"
    assert ws.cell(row=2, column=2).value == "https://linkedin.com/in/alice"
    assert ws.cell(row=2, column=3).value == "AI expert in healthcare"
    assert ws.cell(row=2, column=4).value == "Healthcare AI, Medtech"

    assert ws.cell(row=3, column=1).value == "Bob Jones"


def test_generate_excel_empty():
    output = generate_excel([])
    wb = load_workbook(output)
    ws = wb.active
    assert ws.max_row == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_excel_export.py -v
```
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `backend/app/services/excel_export.py`**

```python
import json
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment


def generate_excel(profiles: list[dict]) -> BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = "LinkedIn Profiles"

    headers = ["Name", "Profile URL", "Bio Snippet", "Matched Keywords"]
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    for row_idx, profile in enumerate(profiles, 2):
        ws.cell(row=row_idx, column=1, value=profile["name"])
        ws.cell(row=row_idx, column=2, value=profile["profile_url"])
        ws.cell(row=row_idx, column=3, value=profile.get("snippet", ""))

        keywords = profile.get("matched_keywords", "[]")
        if isinstance(keywords, str):
            keywords = json.loads(keywords)
        ws.cell(row=row_idx, column=4, value=", ".join(keywords))

    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 50
    ws.column_dimensions["C"].width = 60
    ws.column_dimensions["D"].width = 30

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_excel_export.py -v
```
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/excel_export.py backend/tests/test_excel_export.py
git commit -m "feat: Excel export service with styled headers and column formatting"
```

---

## Task 6: FastAPI App & Routers

**Files:**
- Create: `backend/app/main.py`, `backend/app/routers/__init__.py`, `backend/app/routers/search.py`, `backend/app/routers/results.py`, `backend/app/routers/export.py`, `backend/app/routers/settings.py`, `backend/app/routers/quota.py`, `backend/tests/test_routers.py`

- [ ] **Step 1: Create `backend/app/routers/__init__.py`**

Empty file.

- [ ] **Step 2: Create `backend/app/routers/settings.py`**

```python
from fastapi import APIRouter

from app import database
from app.config import GOOGLE_API_KEY, GOOGLE_CX_ID
from app.models import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/api")


async def resolve_api_key() -> str:
    db_val = await database.get_setting("api_key")
    return db_val if db_val else GOOGLE_API_KEY


async def resolve_cx_id() -> str:
    db_val = await database.get_setting("cx_id")
    return db_val if db_val else GOOGLE_CX_ID


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    api_key = await resolve_api_key()
    cx_id = await resolve_cx_id()
    masked = ""
    if api_key:
        masked = api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:] if len(api_key) > 8 else "****"
    return SettingsResponse(
        api_key_set=bool(api_key),
        api_key_masked=masked,
        cx_id=cx_id,
    )


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate):
    if body.api_key is not None:
        await database.set_setting("api_key", body.api_key)
    if body.cx_id is not None:
        await database.set_setting("cx_id", body.cx_id)
    return await get_settings()
```

- [ ] **Step 3: Create `backend/app/routers/quota.py`**

```python
from datetime import date

from fastapi import APIRouter

from app import database
from app.config import DAILY_QUOTA_LIMIT
from app.models import QuotaResponse

router = APIRouter(prefix="/api")


@router.get("/quota", response_model=QuotaResponse)
async def get_quota():
    today = date.today().isoformat()
    used = await database.get_daily_usage(today)
    return QuotaResponse(used=used, limit=DAILY_QUOTA_LIMIT, date=today)
```

- [ ] **Step 4: Create `backend/app/routers/results.py`**

```python
import json

from fastapi import APIRouter, Query

from app import database
from app.models import ProfileListResponse, ProfileResponse

router = APIRouter(prefix="/api")


@router.get("/results", response_model=ProfileListResponse)
async def get_results(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    profiles_raw = await database.get_all_profiles(limit=limit, offset=offset)
    total = await database.get_profile_count()
    profiles = [
        ProfileResponse(
            id=p["id"],
            name=p["name"],
            profile_url=p["profile_url"],
            snippet=p.get("snippet"),
            matched_keywords=json.loads(p["matched_keywords"]),
            created_at=str(p["created_at"]),
            updated_at=str(p["updated_at"]),
        )
        for p in profiles_raw
    ]
    return ProfileListResponse(profiles=profiles, total=total)
```

- [ ] **Step 5: Create `backend/app/routers/export.py`**

```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app import database
from app.services.excel_export import generate_excel

router = APIRouter(prefix="/api")


@router.get("/export")
async def export_excel():
    profiles = await database.get_all_profiles(limit=10000, offset=0)
    output = generate_excel(profiles)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=linkedin_profiles.xlsx"},
    )
```

- [ ] **Step 6: Create `backend/app/routers/search.py`**

```python
import json
import logging
from datetime import date, datetime

import httpx
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from app import database
from app.config import DAILY_QUOTA_LIMIT
from app.models import SearchRequest
from app.routers.settings import resolve_api_key, resolve_cx_id
from app.services.google_search import fetch_search_page, parse_search_results

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/search")
async def search(body: SearchRequest):
    api_key = await resolve_api_key()
    cx_id = await resolve_cx_id()

    if not api_key or not cx_id:
        raise HTTPException(status_code=400, detail="Google API key and CX ID must be configured in Settings.")

    async def event_generator():
        today = date.today().isoformat()
        total_new = 0
        keywords_completed = 0

        async with httpx.AsyncClient() as client:
            for kw_idx, keyword in enumerate(body.keywords):
                keyword_profiles = 0

                for page in range(body.max_pages):
                    usage = await database.get_daily_usage(today)
                    if usage >= DAILY_QUOTA_LIMIT:
                        yield {
                            "event": "error",
                            "data": json.dumps({
                                "message": f"Daily quota reached ({DAILY_QUOTA_LIMIT}). Collected {total_new} new profiles so far.",
                                "keyword": keyword,
                                "recoverable": False,
                            }),
                        }
                        yield {
                            "event": "done",
                            "data": json.dumps({
                                "total_profiles": await database.get_profile_count(),
                                "new_profiles": total_new,
                                "keywords_completed": keywords_completed,
                            }),
                        }
                        return

                    start = page * 10 + 1

                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "keyword": keyword,
                            "current_page": page + 1,
                            "total_pages": body.max_pages,
                            "profiles_found": keyword_profiles,
                        }),
                    }

                    try:
                        raw = await fetch_search_page(keyword, api_key, cx_id, start, client)
                        await database.increment_daily_usage(today)

                        yield {
                            "event": "log",
                            "data": json.dumps({
                                "timestamp": datetime.now().isoformat(),
                                "level": "INFO",
                                "message": f"Fetched page {page + 1}/{body.max_pages} for '{keyword}' (start={start})",
                            }),
                        }

                        results = parse_search_results(raw)
                        for r in results:
                            await database.upsert_profile(r["name"], r["profile_url"], r["snippet"], keyword)
                            total_new += 1
                            keyword_profiles += 1

                        if not results:
                            yield {
                                "event": "log",
                                "data": json.dumps({
                                    "timestamp": datetime.now().isoformat(),
                                    "level": "INFO",
                                    "message": f"No more results for '{keyword}' at page {page + 1}. Moving on.",
                                }),
                            }
                            break

                    except httpx.TimeoutException:
                        yield {
                            "event": "error",
                            "data": json.dumps({
                                "message": f"Timeout on page {page + 1} for '{keyword}'. Skipping.",
                                "keyword": keyword,
                                "recoverable": True,
                            }),
                        }
                        continue
                    except httpx.HTTPStatusError as e:
                        yield {
                            "event": "error",
                            "data": json.dumps({
                                "message": f"API error ({e.response.status_code}) on page {page + 1} for '{keyword}'. Skipping.",
                                "keyword": keyword,
                                "recoverable": True,
                            }),
                        }
                        continue
                    except Exception as e:
                        yield {
                            "event": "error",
                            "data": json.dumps({
                                "message": f"Unexpected error for '{keyword}': {str(e)}",
                                "keyword": keyword,
                                "recoverable": True,
                            }),
                        }
                        continue

                keywords_completed += 1
                yield {
                    "event": "keyword_done",
                    "data": json.dumps({
                        "keyword": keyword,
                        "total_profiles": keyword_profiles,
                    }),
                }

        total = await database.get_profile_count()
        yield {
            "event": "done",
            "data": json.dumps({
                "total_profiles": total,
                "new_profiles": total_new,
                "keywords_completed": keywords_completed,
            }),
        }

    return EventSourceResponse(event_generator())
```

- [ ] **Step 7: Create `backend/app/main.py`**

```python
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import database
from app.config import LOG_DIR, LOG_LEVEL
from app.routers import search, results, export, settings, quota


def setup_logging() -> None:
    LOG_DIR.mkdir(exist_ok=True)
    file_handler = RotatingFileHandler(
        LOG_DIR / "app.log", maxBytes=5_000_000, backupCount=3
    )
    file_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    file_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    root_logger.addHandler(file_handler)
    root_logger.addHandler(logging.StreamHandler())


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await database.init_db()
    yield


app = FastAPI(title="LinkedIn X-Ray Search API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(results.router)
app.include_router(export.router)
app.include_router(settings.router)
app.include_router(quota.router)
```

- [ ] **Step 8: Write integration tests**

Create `backend/tests/test_routers.py`:

```python
import pytest
import json
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from app import database

TEST_DB = Path(__file__).parent / "test_routers.db"


@pytest.fixture(autouse=True)
async def setup_db():
    database._db_path = TEST_DB
    await database.init_db()
    yield
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture
def client():
    from app.main import app
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_get_quota(client):
    async with client as c:
        resp = await c.get("/api/quota")
    assert resp.status_code == 200
    data = resp.json()
    assert data["used"] == 0
    assert data["limit"] == 100


@pytest.mark.asyncio
async def test_settings_roundtrip(client):
    async with client as c:
        resp = await c.put("/api/settings", json={"api_key": "test_key_12345678", "cx_id": "my_cx"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["api_key_set"] is True
        assert data["cx_id"] == "my_cx"
        assert "****" in data["api_key_masked"]

        resp = await c.get("/api/settings")
        assert resp.status_code == 200
        assert resp.json()["cx_id"] == "my_cx"


@pytest.mark.asyncio
async def test_get_results_empty(client):
    async with client as c:
        resp = await c.get("/api/results")
    assert resp.status_code == 200
    data = resp.json()
    assert data["profiles"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_get_results_with_data(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    async with client as c:
        resp = await c.get("/api/results")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["profiles"][0]["name"] == "Alice"
    assert data["profiles"][0]["matched_keywords"] == ["AI"]


@pytest.mark.asyncio
async def test_export_excel(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    async with client as c:
        resp = await c.get("/api/export")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_search_requires_credentials(client):
    async with client as c:
        resp = await c.post("/api/search", json={"keywords": ["test"], "max_pages": 1})
    assert resp.status_code == 400
```

- [ ] **Step 9: Run all tests**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add backend/app/main.py backend/app/routers/ backend/tests/test_routers.py
git commit -m "feat: FastAPI app with search, results, export, settings, and quota routers"
```

---

## Task 7: Frontend Scaffolding

**Files:**
- Create: Next.js project in `frontend/`, configure Tailwind, create type definitions and constants

- [ ] **Step 1: Create Next.js project**

Run:
```bash
cd /Users/soumyajithui/Documents/linkedin-xray-search && npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

When prompted, accept defaults.

- [ ] **Step 2: Create `frontend/src/lib/types.ts`**

```typescript
export interface Profile {
  id: number;
  name: string;
  profile_url: string;
  snippet: string | null;
  matched_keywords: string[];
  created_at: string;
  updated_at: string;
}

export interface ProfileListResponse {
  profiles: Profile[];
  total: number;
}

export interface Settings {
  api_key_set: boolean;
  api_key_masked: string;
  cx_id: string;
}

export interface Quota {
  used: number;
  limit: number;
  date: string;
}

export interface SSEProgress {
  keyword: string;
  current_page: number;
  total_pages: number;
  profiles_found: number;
}

export interface SSEKeywordDone {
  keyword: string;
  total_profiles: number;
}

export interface SSEError {
  message: string;
  keyword?: string;
  recoverable: boolean;
}

export interface SSEDone {
  total_profiles: number;
  new_profiles: number;
  keywords_completed: number;
}

export interface SSELog {
  timestamp: string;
  level: string;
  message: string;
}
```

- [ ] **Step 3: Create `frontend/src/lib/constants.ts`**

```typescript
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export const DEFAULT_KEYWORDS = [
  "Healthcare Startups",
  "Medtech",
  "Healthcare AI",
  "Medical AI",
  "Healthcare for AI",
];

export const MAX_PAGES_DEFAULT = 5;
export const MAX_PAGES_LIMIT = 10;
```

- [ ] **Step 4: Create `frontend/src/lib/api.ts`**

```typescript
import { API_BASE } from "./constants";
import type { ProfileListResponse, Settings, Quota } from "./types";

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getResults(limit = 50, offset = 0): Promise<ProfileListResponse> {
  return fetchJSON(`/api/results?limit=${limit}&offset=${offset}`);
}

export async function getSettings(): Promise<Settings> {
  return fetchJSON("/api/settings");
}

export async function updateSettings(data: { api_key?: string; cx_id?: string }): Promise<Settings> {
  return fetchJSON("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getQuota(): Promise<Quota> {
  return fetchJSON("/api/quota");
}

export function getExportUrl(): string {
  return `${API_BASE}/api/export`;
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: frontend scaffolding with types, constants, and API client"
```

---

## Task 8: SSE Search Hook

**Files:**
- Create: `frontend/src/hooks/useSSESearch.ts`

- [ ] **Step 1: Create `frontend/src/hooks/useSSESearch.ts`**

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/constants";
import type { SSEProgress, SSEKeywordDone, SSEError, SSEDone, SSELog } from "@/lib/types";

export interface SearchState {
  isSearching: boolean;
  progress: Map<string, SSEProgress>;
  completedKeywords: SSEKeywordDone[];
  errors: SSEError[];
  logs: SSELog[];
  result: SSEDone | null;
}

const initialState: SearchState = {
  isSearching: false,
  progress: new Map(),
  completedKeywords: [],
  errors: [],
  logs: [],
  result: null,
};

export function useSSESearch() {
  const [state, setState] = useState<SearchState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const startSearch = useCallback(async (keywords: string[], maxPages: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      isSearching: true,
      progress: new Map(),
      completedKeywords: [],
      errors: [],
      logs: [],
      result: null,
    });

    try {
      const response = await fetch(`${API_BASE}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, max_pages: maxPages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        setState((prev) => ({
          ...prev,
          isSearching: false,
          errors: [...prev.errors, { message: `Search failed: ${text}`, recoverable: false }],
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:") && currentEvent) {
            const data = JSON.parse(line.slice(5).trim());

            switch (currentEvent) {
              case "progress":
                setState((prev) => {
                  const newProgress = new Map(prev.progress);
                  newProgress.set(data.keyword, data as SSEProgress);
                  return { ...prev, progress: newProgress };
                });
                break;
              case "keyword_done":
                setState((prev) => ({
                  ...prev,
                  completedKeywords: [...prev.completedKeywords, data as SSEKeywordDone],
                }));
                break;
              case "error":
                setState((prev) => ({
                  ...prev,
                  errors: [...prev.errors, data as SSEError],
                }));
                break;
              case "done":
                setState((prev) => ({
                  ...prev,
                  isSearching: false,
                  result: data as SSEDone,
                }));
                break;
              case "log":
                setState((prev) => ({
                  ...prev,
                  logs: [...prev.logs, data as SSELog],
                }));
                break;
            }
            currentEvent = "";
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        isSearching: false,
        errors: [...prev.errors, { message: String(err), recoverable: false }],
      }));
    }
  }, []);

  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isSearching: false }));
  }, []);

  return { ...state, startSearch, cancelSearch };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useSSESearch.ts
git commit -m "feat: SSE search hook for real-time streaming progress"
```

---

## Task 9: Frontend Components — Header, Settings Panel, Quota Badge

**Files:**
- Create: `frontend/src/components/Header.tsx`, `frontend/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Create `frontend/src/components/SettingsPanel.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import type { Settings } from "@/lib/types";
import { getSettings, updateSettings } from "@/lib/api";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [cxId, setCxId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      getSettings().then((s) => {
        setSettings(s);
        setCxId(s.cx_id);
        setApiKey("");
      });
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const payload: { api_key?: string; cx_id?: string } = {};
      if (apiKey) payload.api_key = apiKey;
      if (cxId !== settings?.cx_id) payload.cx_id = cxId;
      if (Object.keys(payload).length === 0) {
        setMessage("No changes to save.");
        setSaving(false);
        return;
      }
      const updated = await updateSettings(payload);
      setSettings(updated);
      setApiKey("");
      setMessage("Settings saved.");
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
    setSaving(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl border-l border-slate-200 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Google API Key</label>
            {settings?.api_key_set && (
              <p className="text-xs text-slate-500 mb-1">Current: {settings.api_key_masked}</p>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.api_key_set ? "Enter new key to update" : "Enter your API key"}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Search Engine ID (CX)</label>
            <input
              type="text"
              value={cxId}
              onChange={(e) => setCxId(e.target.value)}
              placeholder="Enter your CX ID"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>

          {message && (
            <p className={`text-sm ${message.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
              {message}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/Header.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import type { Quota } from "@/lib/types";
import { getQuota } from "@/lib/api";
import SettingsPanel from "./SettingsPanel";

interface HeaderProps {
  onQuotaRefresh?: () => void;
}

export default function Header({ onQuotaRefresh }: HeaderProps) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchQuota = async () => {
    try {
      const q = await getQuota();
      setQuota(q);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchQuota();
  }, []);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    fetchQuota();
    onQuotaRefresh?.();
  };

  return (
    <>
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">LinkedIn X-Ray Search</h1>
            <p className="text-sm text-slate-500">Profile discovery</p>
          </div>
          <div className="flex items-center gap-4">
            {quota && (
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                quota.used >= quota.limit
                  ? "bg-red-50 text-red-700"
                  : quota.used >= quota.limit * 0.8
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-600"
              }`}>
                {quota.used}/{quota.limit} queries today
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
      </header>
      <SettingsPanel isOpen={settingsOpen} onClose={handleSettingsClose} />
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Header.tsx frontend/src/components/SettingsPanel.tsx
git commit -m "feat: Header with quota badge and slide-out settings panel"
```

---

## Task 10: Frontend Components — Search Panel

**Files:**
- Create: `frontend/src/components/KeywordChips.tsx`, `frontend/src/components/ProgressArea.tsx`, `frontend/src/components/SearchPanel.tsx`

- [ ] **Step 1: Create `frontend/src/components/KeywordChips.tsx`**

```tsx
"use client";

import { useState, KeyboardEvent } from "react";

interface KeywordChipsProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
}

export default function KeywordChips({ keywords, onChange, disabled }: KeywordChipsProps) {
  const [input, setInput] = useState("");

  const addKeyword = () => {
    const trimmed = input.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      onChange([...keywords, trimmed]);
    }
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
    if (e.key === "Backspace" && !input && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  };

  const removeKeyword = (index: number) => {
    onChange(keywords.filter((_, i) => i !== index));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 p-3 border border-slate-300 rounded-md bg-white min-h-[48px] ${disabled ? "opacity-60" : ""}`}>
      {keywords.map((kw, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-sm rounded-md border border-slate-200"
        >
          {kw}
          {!disabled && (
            <button
              onClick={() => removeKeyword(i)}
              className="text-slate-400 hover:text-slate-600 ml-0.5 leading-none"
            >
              &times;
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addKeyword}
        placeholder={keywords.length === 0 ? "Add keywords..." : ""}
        disabled={disabled}
        className="flex-1 min-w-[120px] outline-none text-sm text-slate-900 placeholder:text-slate-400 bg-transparent"
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/ProgressArea.tsx`**

```tsx
"use client";

import type { SSEProgress, SSEKeywordDone, SSEError } from "@/lib/types";

interface ProgressAreaProps {
  isSearching: boolean;
  progress: Map<string, SSEProgress>;
  completedKeywords: SSEKeywordDone[];
  errors: SSEError[];
}

export default function ProgressArea({ isSearching, progress, completedKeywords, errors }: ProgressAreaProps) {
  if (!isSearching && completedKeywords.length === 0 && errors.length === 0) {
    return null;
  }

  const completedSet = new Set(completedKeywords.map((k) => k.keyword));

  return (
    <div className="mt-4 space-y-2">
      {completedKeywords.map((kw, i) => (
        <div key={`done-${i}`} className="flex items-center gap-2 text-sm text-green-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>{kw.keyword} — {kw.total_profiles} profiles found</span>
        </div>
      ))}

      {Array.from(progress.entries()).map(([keyword, p]) =>
        !completedSet.has(keyword) ? (
          <div key={`prog-${keyword}`} className="flex items-center gap-2 text-sm text-slate-600">
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>{keyword} — page {p.current_page}/{p.total_pages} ({p.profiles_found} profiles)</span>
          </div>
        ) : null
      )}

      {errors.map((err, i) => (
        <div key={`err-${i}`} className="flex items-center gap-2 text-sm text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
          <span>{err.message}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/SearchPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DEFAULT_KEYWORDS, MAX_PAGES_DEFAULT, MAX_PAGES_LIMIT } from "@/lib/constants";
import KeywordChips from "./KeywordChips";
import ProgressArea from "./ProgressArea";
import type { SearchState } from "@/hooks/useSSESearch";

interface SearchPanelProps {
  searchState: SearchState;
  onSearch: (keywords: string[], maxPages: number) => void;
  onCancel: () => void;
}

export default function SearchPanel({ searchState, onSearch, onCancel }: SearchPanelProps) {
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [maxPages, setMaxPages] = useState(MAX_PAGES_DEFAULT);

  const handleScan = () => {
    if (keywords.length === 0) return;
    onSearch(keywords, maxPages);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Search Keywords</h2>

      <KeywordChips keywords={keywords} onChange={setKeywords} disabled={searchState.isSearching} />

      <div className="mt-4 flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Max pages per keyword</label>
          <input
            type="number"
            min={1}
            max={MAX_PAGES_LIMIT}
            value={maxPages}
            onChange={(e) => setMaxPages(Math.min(MAX_PAGES_LIMIT, Math.max(1, parseInt(e.target.value) || 1)))}
            disabled={searchState.isSearching}
            className="w-24 px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
        </div>

        <div className="flex gap-2">
          {searchState.isSearching ? (
            <button
              onClick={onCancel}
              className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleScan}
              disabled={keywords.length === 0}
              className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              Scan
            </button>
          )}
        </div>
      </div>

      <ProgressArea
        isSearching={searchState.isSearching}
        progress={searchState.progress}
        completedKeywords={searchState.completedKeywords}
        errors={searchState.errors}
      />

      {searchState.result && (
        <div className="mt-4 p-3 bg-slate-50 rounded-md border border-slate-200 text-sm text-slate-700">
          Search complete: {searchState.result.new_profiles} new profiles found across {searchState.result.keywords_completed} keywords. Total in database: {searchState.result.total_profiles}.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/KeywordChips.tsx frontend/src/components/ProgressArea.tsx frontend/src/components/SearchPanel.tsx
git commit -m "feat: search panel with keyword chips, progress display, and scan controls"
```

---

## Task 11: Frontend Components — Results Table

**Files:**
- Create: `frontend/src/components/ResultsTable.tsx`

- [ ] **Step 1: Create `frontend/src/components/ResultsTable.tsx`**

```tsx
"use client";

import { useState, useMemo } from "react";
import type { Profile } from "@/lib/types";
import { getExportUrl } from "@/lib/api";

interface ResultsTableProps {
  profiles: Profile[];
  total: number;
  loading: boolean;
}

type SortField = "name" | "updated_at";
type SortDir = "asc" | "desc";

export default function ResultsTable({ profiles, total, loading }: ResultsTableProps) {
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [keywordFilter, setKeywordFilter] = useState("");

  const allKeywords = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => p.matched_keywords.forEach((k) => set.add(k)));
    return Array.from(set).sort();
  }, [profiles]);

  const filtered = useMemo(() => {
    let result = profiles;
    if (keywordFilter) {
      result = result.filter((p) => p.matched_keywords.includes(keywordFilter));
    }
    result = [...result].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [profiles, keywordFilter, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            Results
            <span className="ml-2 text-slate-500 font-normal normal-case">({filtered.length} of {total} profiles)</span>
          </h2>
          {allKeywords.length > 0 && (
            <select
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
              className="text-sm border border-slate-300 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">All keywords</option>
              {allKeywords.map((kw) => (
                <option key={kw} value={kw}>{kw}</option>
              ))}
            </select>
          )}
        </div>
        {total > 0 && (
          <a
            href={getExportUrl()}
            download
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 transition-colors"
          >
            Export to Excel
          </a>
        )}
      </div>

      {loading ? (
        <div className="px-6 py-12 text-center text-slate-500 text-sm">Loading results...</div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-slate-500 text-sm">
          {total === 0 ? "No profiles yet. Run a search to get started." : "No profiles match the selected filter."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th
                  className="text-left px-6 py-3 font-medium text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                  onClick={() => toggleSort("name")}
                >
                  Name{sortIcon("name")}
                </th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Profile Link</th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Bio Snippet</th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Keywords</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-6 py-3 font-medium text-slate-900 whitespace-nowrap">{profile.name}</td>
                  <td className="px-6 py-3">
                    <a
                      href={profile.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline truncate block max-w-[250px]"
                      title={profile.profile_url}
                    >
                      {profile.profile_url.replace("https://www.linkedin.com/in/", "").replace("https://linkedin.com/in/", "")}
                    </a>
                  </td>
                  <td className="px-6 py-3 text-slate-600 max-w-[350px]">
                    <span className="line-clamp-2" title={profile.snippet || ""}>
                      {profile.snippet || "—"}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1">
                      {profile.matched_keywords.map((kw) => (
                        <span
                          key={kw}
                          className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded border border-slate-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ResultsTable.tsx
git commit -m "feat: results table with sorting, keyword filtering, and export button"
```

---

## Task 12: Frontend Components — Activity Log

**Files:**
- Create: `frontend/src/components/ActivityLog.tsx`

- [ ] **Step 1: Create `frontend/src/components/ActivityLog.tsx`**

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import type { SSELog } from "@/lib/types";

interface ActivityLogProps {
  logs: SSELog[];
}

export default function ActivityLog({ logs }: ActivityLogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isOpen]);

  if (logs.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-3 flex items-center justify-between text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
      >
        <span>Activity Log ({logs.length} entries)</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-slate-200 max-h-64 overflow-y-auto">
          <div className="px-6 py-3 space-y-1 font-mono text-xs">
            {logs.map((log, i) => {
              const time = new Date(log.timestamp).toLocaleTimeString();
              const levelColor =
                log.level === "ERROR" ? "text-red-600" :
                log.level === "WARNING" ? "text-amber-600" :
                "text-slate-500";
              return (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-400 shrink-0">{time}</span>
                  <span className={`shrink-0 ${levelColor}`}>[{log.level}]</span>
                  <span className="text-slate-700">{log.message}</span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ActivityLog.tsx
git commit -m "feat: collapsible activity log with auto-scroll and level coloring"
```

---

## Task 13: Main Dashboard Page & Layout

**Files:**
- Modify: `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`, `frontend/src/app/globals.css`

- [ ] **Step 1: Update `frontend/src/app/globals.css`**

Replace the entire file contents with:

```css
@import "tailwindcss";

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
```

- [ ] **Step 2: Update `frontend/src/app/layout.tsx`**

Replace the entire file contents with:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkedIn X-Ray Search",
  description: "Profile discovery via Google Custom Search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create the main dashboard page `frontend/src/app/page.tsx`**

Replace the entire file contents with:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import SearchPanel from "@/components/SearchPanel";
import ResultsTable from "@/components/ResultsTable";
import ActivityLog from "@/components/ActivityLog";
import { useSSESearch } from "@/hooks/useSSESearch";
import { getResults } from "@/lib/api";
import type { Profile } from "@/lib/types";

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingResults, setLoadingResults] = useState(true);

  const searchState = useSSESearch();

  const fetchResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const data = await getResults(500, 0);
      setProfiles(data.profiles);
      setTotal(data.total);
    } catch {
      // silently fail
    }
    setLoadingResults(false);
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    if (searchState.result) {
      fetchResults();
    }
  }, [searchState.result, fetchResults]);

  const handleSearch = (keywords: string[], maxPages: number) => {
    searchState.startSearch(keywords, maxPages);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onQuotaRefresh={fetchResults} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <SearchPanel
          searchState={searchState}
          onSearch={handleSearch}
          onCancel={searchState.cancelSearch}
        />
        <ResultsTable profiles={profiles} total={total} loading={loadingResults} />
        <ActivityLog logs={searchState.logs} />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/
git commit -m "feat: main dashboard page composing header, search, results, and activity log"
```

---

## Task 14: README & Final Wiring

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# LinkedIn X-Ray Search

Scrapes public LinkedIn profiles via Google Custom Search API using healthcare/AI keywords. Displays results in a dashboard and exports to Excel.

## Prerequisites

- Python 3.11+
- Node.js 18+
- Google Custom Search API key and Programmable Search Engine ID (scoped to `linkedin.com/in/*`)

## Setup

1. Clone the repo and copy environment template:

```bash
cp .env.example .env
```

2. Edit `.env` with your Google API credentials (or configure them later via the UI Settings panel).

3. Start the backend:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

4. Start the frontend (in a separate terminal):

```bash
cd frontend
npm install
npm run dev
```

5. Open http://localhost:3000

## Usage

- Add or remove keyword chips in the search panel
- Click **Scan** to start searching (progress streams in real-time)
- View results in the table — sort by name, filter by keyword
- Click **Export to Excel** to download all results
- Configure API credentials via the gear icon (top-right)
- Toggle the **Activity Log** at the bottom for debug info

## API Quota

Google Custom Search free tier allows 100 queries/day. The quota badge in the header tracks usage.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup and usage README"
```

---

## Task 15: Integration Testing — Start Both Servers & Verify

- [ ] **Step 1: Run backend tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```
Expected: All tests PASS

- [ ] **Step 2: Start backend server**

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
```
Verify: `http://localhost:8000/api/quota` returns `{"used":0,"limit":100,"date":"2026-04-18"}`

- [ ] **Step 3: Start frontend dev server**

```bash
cd frontend && npm install && npm run dev
```
Verify: `http://localhost:3000` loads the dashboard

- [ ] **Step 4: Test settings flow**

Open the gear icon, enter API key and CX ID, save. Verify the masked key appears.

- [ ] **Step 5: Test search flow**

Click "Scan" with default keywords. Verify SSE progress updates appear, results populate the table.

- [ ] **Step 6: Test export**

Click "Export to Excel". Verify `.xlsx` downloads with the correct data.

- [ ] **Step 7: Test activity log**

Expand the activity log during a search. Verify timestamped entries appear.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A && git commit -m "fix: integration testing fixes"
```
(Only if changes were needed.)
