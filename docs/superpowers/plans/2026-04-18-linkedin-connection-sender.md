# LinkedIn Connection Sender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chrome extension-based LinkedIn connection sending with per-profile status tracking, scheduled queue with random delays, 50/day limit, and bulk actions — all managed through the existing dashboard.

**Architecture:** Backend adds connection columns to the profiles table plus a connection_usage table, with 5 new API endpoints in a connections router. Frontend adds a ConnectionButton dropdown per row and checkbox bulk selection. A Manifest V3 Chrome extension polls the backend queue and automates clicking Connect on LinkedIn.

**Tech Stack:** FastAPI, aiosqlite, Chrome Extension Manifest V3, Next.js/React, Tailwind CSS

---

## File Structure

### New files:
| File | Responsibility |
|------|---------------|
| `backend/app/routers/connections.py` | 5 API endpoints for connection status management |
| `backend/tests/test_connections.py` | Unit + integration tests for connection DB functions and endpoints |
| `frontend/src/components/ConnectionButton.tsx` | Dropdown button component for per-profile connection status |
| `extension/manifest.json` | Chrome extension manifest (Manifest V3) |
| `extension/background.js` | Service worker: polls backend queue, manages tabs |
| `extension/content.js` | Content script: finds and clicks Connect on LinkedIn profiles |

### Modified files:
| File | Changes |
|------|---------|
| `backend/app/database.py` | Add connection_usage table, migrate profiles columns, 6 new functions |
| `backend/app/models.py` | 8 new Pydantic models for connection endpoints |
| `backend/app/config.py` | Add `DAILY_CONNECTION_LIMIT = 50` |
| `backend/app/main.py` | Include `connections.router` |
| `backend/app/routers/results.py` | Include connection_status and connection_scheduled_at in ProfileResponse |
| `frontend/src/lib/types.ts` | Update Profile interface, add ConnectionResponse/ConnectionUsage types |
| `frontend/src/lib/api.ts` | 3 new API functions |
| `frontend/src/components/ResultsTable.tsx` | Checkbox column, Status column, bulk action bar |
| `frontend/src/components/Header.tsx` | Connection quota badge |
| `frontend/src/app/page.tsx` | Pass fetchResults to ResultsTable for connection updates |

---

### Task 1: Database — connection_usage table and profiles migration

**Files:**
- Modify: `backend/app/database.py:11-31` (SQL_CREATE_TABLES)
- Modify: `backend/app/database.py:34-38` (init_db)
- Test: `backend/tests/test_connections.py` (create)

- [ ] **Step 1: Write the failing tests for DB migration**

Create `backend/tests/test_connections.py`:

```python
import pytest
from pathlib import Path

from app import database

TEST_DB = Path(__file__).parent / "test_connections.db"


@pytest.fixture(autouse=True)
async def clean_db():
    if TEST_DB.exists():
        TEST_DB.unlink()
    database._db_path = TEST_DB
    await database.init_db()
    yield
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.mark.asyncio
async def test_profiles_table_has_connection_columns():
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        cursor = await conn.execute("PRAGMA table_info(profiles)")
        columns = {row[1] for row in await cursor.fetchall()}
    assert "connection_status" in columns
    assert "connection_queued_at" in columns
    assert "connection_scheduled_at" in columns
    assert "connection_sent_at" in columns


@pytest.mark.asyncio
async def test_connection_usage_table_exists():
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='connection_usage'"
        )
        row = await cursor.fetchone()
    assert row is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py -v`
Expected: FAIL — `connection_status` not in columns, `connection_usage` table doesn't exist

- [ ] **Step 3: Add migration SQL and update init_db**

In `backend/app/database.py`, replace `SQL_CREATE_TABLES` (lines 11-31) with:

```python
SQL_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    profile_url TEXT UNIQUE NOT NULL,
    snippet TEXT,
    matched_keywords TEXT NOT NULL DEFAULT '[]',
    connection_status TEXT NOT NULL DEFAULT 'none',
    connection_queued_at TIMESTAMP,
    connection_scheduled_at TIMESTAMP,
    connection_sent_at TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS connection_usage (
    date TEXT UNIQUE NOT NULL,
    send_count INTEGER DEFAULT 0
);
"""
```

In `init_db()` (line 34), add migration logic after `executescript`:

```python
async def init_db() -> None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.executescript(SQL_CREATE_TABLES)

        # Migrate existing profiles table to add connection columns
        cursor = await conn.execute("PRAGMA table_info(profiles)")
        columns = {row["name"] for row in await cursor.fetchall()}
        if "connection_status" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'none'")
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_queued_at TIMESTAMP")
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_scheduled_at TIMESTAMP")
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_sent_at TIMESTAMP")

        await conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py -v`
Expected: 2 passed

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All 24+ tests pass (existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add backend/app/database.py backend/tests/test_connections.py
git commit -m "feat: add connection_usage table and profiles connection columns"
```

---

### Task 2: Database — connection helper functions

**Files:**
- Modify: `backend/app/database.py` (append new functions)
- Modify: `backend/app/config.py:11` (add constant)
- Test: `backend/tests/test_connections.py` (append)

- [ ] **Step 1: Add DAILY_CONNECTION_LIMIT to config**

In `backend/app/config.py`, after line 11 (`SERPER_API_KEY = ...`), add:

```python
DAILY_CONNECTION_LIMIT = 50
```

- [ ] **Step 2: Write failing tests for connection DB functions**

Append to `backend/tests/test_connections.py`:

```python
from datetime import datetime, timedelta, timezone


@pytest.mark.asyncio
async def test_update_connection_status_to_queued():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    scheduled = datetime.now(timezone.utc) + timedelta(seconds=60)
    await database.update_connection_status(1, "queued", scheduled_at=scheduled.isoformat())
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT connection_status, connection_scheduled_at FROM profiles WHERE id = 1")
        row = await cursor.fetchone()
    assert row["connection_status"] == "queued"
    assert row["connection_scheduled_at"] is not None


@pytest.mark.asyncio
async def test_update_connection_status_to_connected():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    await database.update_connection_status(1, "connected")
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT connection_status FROM profiles WHERE id = 1")
        row = await cursor.fetchone()
    assert row["connection_status"] == "connected"


@pytest.mark.asyncio
async def test_update_connection_status_to_none_resets_fields():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    scheduled = datetime.now(timezone.utc) + timedelta(seconds=60)
    await database.update_connection_status(1, "queued", scheduled_at=scheduled.isoformat())
    await database.update_connection_status(1, "none")
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT connection_status, connection_queued_at, connection_scheduled_at, connection_sent_at FROM profiles WHERE id = 1")
        row = await cursor.fetchone()
    assert row["connection_status"] == "none"
    assert row["connection_queued_at"] is None
    assert row["connection_scheduled_at"] is None
    assert row["connection_sent_at"] is None


@pytest.mark.asyncio
async def test_get_next_queued_connection_returns_ready_item():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    item = await database.get_next_queued_connection()
    assert item is not None
    assert item["id"] == 1
    assert item["profile_url"] == "https://linkedin.com/in/alice"


@pytest.mark.asyncio
async def test_get_next_queued_connection_skips_future_items():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    future = (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=future)
    item = await database.get_next_queued_connection()
    assert item is None


@pytest.mark.asyncio
async def test_get_next_queued_connection_returns_oldest_first():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    await database.upsert_profile("Bob", "https://linkedin.com/in/bob", "Bio", "AI")
    earlier = (datetime.now(timezone.utc) - timedelta(seconds=20)).isoformat()
    later = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=later)
    await database.update_connection_status(2, "queued", scheduled_at=earlier)
    item = await database.get_next_queued_connection()
    assert item["id"] == 2


@pytest.mark.asyncio
async def test_get_last_scheduled_at_returns_none_when_empty():
    result = await database.get_last_scheduled_at()
    assert result is None


@pytest.mark.asyncio
async def test_get_last_scheduled_at_returns_latest():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    await database.upsert_profile("Bob", "https://linkedin.com/in/bob", "Bio", "AI")
    t1 = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    t2 = (datetime.now(timezone.utc) + timedelta(seconds=90)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=t1)
    await database.update_connection_status(2, "queued", scheduled_at=t2)
    result = await database.get_last_scheduled_at()
    assert result == t2


@pytest.mark.asyncio
async def test_report_connection_result_sent():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    await database.report_connection_result(1, "sent")
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT connection_status, connection_sent_at FROM profiles WHERE id = 1")
        row = await cursor.fetchone()
    assert row["connection_status"] == "sent"
    assert row["connection_sent_at"] is not None


@pytest.mark.asyncio
async def test_report_connection_result_failed():
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    await database.report_connection_result(1, "failed")
    import aiosqlite
    async with aiosqlite.connect(TEST_DB) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT connection_status FROM profiles WHERE id = 1")
        row = await cursor.fetchone()
    assert row["connection_status"] == "failed"


@pytest.mark.asyncio
async def test_connection_usage_tracking():
    count = await database.get_connection_usage("2026-04-18")
    assert count == 0
    await database.increment_connection_usage("2026-04-18")
    await database.increment_connection_usage("2026-04-18")
    count = await database.get_connection_usage("2026-04-18")
    assert count == 2


@pytest.mark.asyncio
async def test_update_connection_status_returns_false_for_missing_profile():
    result = await database.update_connection_status(999, "queued")
    assert result is False
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py -v`
Expected: FAIL — functions not defined

- [ ] **Step 4: Implement the 6 database functions**

Append to `backend/app/database.py`:

```python
async def update_connection_status(
    profile_id: int, status: str, scheduled_at: str | None = None
) -> bool:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT id FROM profiles WHERE id = ?", (profile_id,))
        if not await cursor.fetchone():
            return False

        if status == "none":
            await conn.execute(
                "UPDATE profiles SET connection_status = 'none', connection_queued_at = NULL, "
                "connection_scheduled_at = NULL, connection_sent_at = NULL WHERE id = ?",
                (profile_id,),
            )
        elif status == "queued":
            now = datetime.now(timezone.utc).isoformat()
            await conn.execute(
                "UPDATE profiles SET connection_status = 'queued', connection_queued_at = ?, "
                "connection_scheduled_at = ?, connection_sent_at = NULL WHERE id = ?",
                (now, scheduled_at, profile_id),
            )
        elif status == "connected":
            await conn.execute(
                "UPDATE profiles SET connection_status = 'connected', connection_queued_at = NULL, "
                "connection_scheduled_at = NULL, connection_sent_at = NULL WHERE id = ?",
                (profile_id,),
            )
        else:
            await conn.execute(
                "UPDATE profiles SET connection_status = ? WHERE id = ?",
                (status, profile_id),
            )
        await conn.commit()
        return True


async def get_next_queued_connection() -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT id, profile_url, name FROM profiles "
            "WHERE connection_status = 'queued' AND connection_scheduled_at <= datetime('now') "
            "ORDER BY connection_scheduled_at ASC LIMIT 1"
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_last_scheduled_at() -> str | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT MAX(connection_scheduled_at) as last_scheduled "
            "FROM profiles WHERE connection_status = 'queued'"
        )
        row = await cursor.fetchone()
        return row["last_scheduled"] if row and row["last_scheduled"] else None


async def report_connection_result(profile_id: int, status: str) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        if status == "sent":
            now = datetime.now(timezone.utc).isoformat()
            await conn.execute(
                "UPDATE profiles SET connection_status = 'sent', connection_sent_at = ? WHERE id = ?",
                (now, profile_id),
            )
        else:
            await conn.execute(
                "UPDATE profiles SET connection_status = 'failed' WHERE id = ?",
                (profile_id,),
            )
        await conn.commit()


async def get_connection_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT send_count FROM connection_usage WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["send_count"] if row else 0


async def increment_connection_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute(
            "INSERT INTO connection_usage (date, send_count) VALUES (?, 1) "
            "ON CONFLICT(date) DO UPDATE SET send_count = send_count + 1",
            (date_str,),
        )
        await conn.commit()
        cursor = await conn.execute(
            "SELECT send_count FROM connection_usage WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["send_count"]
```

Also add the missing import at the top of `database.py` — change `from datetime import date` to:

```python
from datetime import date, datetime, timezone
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py -v`
Expected: All 15 tests pass

- [ ] **Step 6: Run all tests**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/database.py backend/app/config.py backend/tests/test_connections.py
git commit -m "feat: add connection status DB functions and usage tracking"
```

---

### Task 3: Backend — Pydantic models for connection endpoints

**Files:**
- Modify: `backend/app/models.py:1-2` (add Literal import)
- Modify: `backend/app/models.py` (append models)

- [ ] **Step 1: Add Literal import and new models**

In `backend/app/models.py`, change line 1 from:

```python
from pydantic import BaseModel, Field
```

to:

```python
from typing import Literal

from pydantic import BaseModel, Field
```

Append to the end of `backend/app/models.py`:

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

Also update `ProfileResponse` — add connection fields after `updated_at`:

```python
class ProfileResponse(BaseModel):
    id: int
    name: str
    profile_url: str
    snippet: str | None
    matched_keywords: list[str]
    connection_status: str = "none"
    connection_scheduled_at: str | None = None
    created_at: str
    updated_at: str
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add Pydantic models for connection endpoints"
```

---

### Task 4: Backend — update results router to include connection fields

**Files:**
- Modify: `backend/app/routers/results.py:15-26`

- [ ] **Step 1: Update the ProfileResponse construction in results.py**

Replace lines 15-26 in `backend/app/routers/results.py`:

```python
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
```

with:

```python
    profiles = [
        ProfileResponse(
            id=p["id"],
            name=p["name"],
            profile_url=p["profile_url"],
            snippet=p.get("snippet"),
            matched_keywords=json.loads(p["matched_keywords"]),
            connection_status=p.get("connection_status", "none"),
            connection_scheduled_at=p.get("connection_scheduled_at"),
            created_at=str(p["created_at"]),
            updated_at=str(p["updated_at"]),
        )
        for p in profiles_raw
    ]
```

- [ ] **Step 2: Run tests to verify the change works**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_routers.py -v`
Expected: All 6 router tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/results.py
git commit -m "feat: include connection_status in profile API responses"
```

---

### Task 5: Backend — connections router (all 5 endpoints)

**Files:**
- Create: `backend/app/routers/connections.py`
- Modify: `backend/app/main.py:11,46-50`
- Test: `backend/tests/test_connections.py` (append integration tests)

- [ ] **Step 1: Write failing integration tests**

Append to `backend/tests/test_connections.py`:

```python
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def client():
    from app.main import app
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_put_connection_status_queued(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    async with client as c:
        resp = await c.put("/api/connections/1", json={"status": "queued"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["connection_status"] == "queued"
    assert data["connection_scheduled_at"] is not None
    assert data["daily_usage"]["used"] == 0
    assert data["daily_usage"]["limit"] == 50


@pytest.mark.asyncio
async def test_put_connection_status_connected(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    async with client as c:
        resp = await c.put("/api/connections/1", json={"status": "connected"})
    assert resp.status_code == 200
    assert resp.json()["connection_status"] == "connected"


@pytest.mark.asyncio
async def test_put_connection_status_not_found(client):
    async with client as c:
        resp = await c.put("/api/connections/999", json={"status": "queued"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_put_connection_status_daily_limit(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    today = date.today().isoformat()
    for _ in range(50):
        await database.increment_connection_usage(today)
    async with client as c:
        resp = await c.put("/api/connections/1", json={"status": "queued"})
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_get_connection_queue_empty(client):
    async with client as c:
        resp = await c.get("/api/connections/queue")
    assert resp.status_code == 200
    assert resp.json()["item"] is None


@pytest.mark.asyncio
async def test_get_connection_queue_returns_ready_item(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    async with client as c:
        resp = await c.get("/api/connections/queue")
    assert resp.status_code == 200
    data = resp.json()
    assert data["item"]["profile_id"] == 1
    assert data["item"]["name"] == "Alice"


@pytest.mark.asyncio
async def test_put_connection_result_sent(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    async with client as c:
        resp = await c.put("/api/connections/1/result", json={"status": "sent"})
    assert resp.status_code == 200
    assert resp.json()["connection_status"] == "sent"


@pytest.mark.asyncio
async def test_put_connection_result_failed(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)
    async with client as c:
        resp = await c.put("/api/connections/1/result", json={"status": "failed", "error": "button not found"})
    assert resp.status_code == 200
    assert resp.json()["connection_status"] == "failed"


@pytest.mark.asyncio
async def test_get_connection_usage(client):
    async with client as c:
        resp = await c.get("/api/connections/usage")
    assert resp.status_code == 200
    data = resp.json()
    assert data["used"] == 0
    assert data["limit"] == 50


@pytest.mark.asyncio
async def test_bulk_queue_connections(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    await database.upsert_profile("Bob", "https://linkedin.com/in/bob", "Bio", "AI")
    await database.upsert_profile("Carol", "https://linkedin.com/in/carol", "Bio", "AI")
    async with client as c:
        resp = await c.put("/api/connections/bulk", json={"profile_ids": [1, 2, 3]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["queued"]) == 3
    # Verify staggered times — each should be later than the previous
    times = [q["connection_scheduled_at"] for q in data["queued"]]
    assert times[0] < times[1] < times[2]


@pytest.mark.asyncio
async def test_bulk_queue_rejects_if_over_limit(client):
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")
    today = date.today().isoformat()
    for _ in range(49):
        await database.increment_connection_usage(today)
    async with client as c:
        resp = await c.put("/api/connections/bulk", json={"profile_ids": [1, 1]})
    assert resp.status_code == 429
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py::test_put_connection_status_queued -v`
Expected: FAIL — 404 (no route registered)

- [ ] **Step 3: Create the connections router**

Create `backend/app/routers/connections.py`:

```python
import random
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException

from app import database
from app.config import DAILY_CONNECTION_LIMIT
from app.models import (
    ConnectionBulkRequest,
    ConnectionBulkResponse,
    ConnectionQueueItem,
    ConnectionQueueResponse,
    ConnectionResponse,
    ConnectionResultUpdate,
    ConnectionStatusUpdate,
    ConnectionUsageResponse,
)

router = APIRouter(prefix="/api/connections")

DELAY_MIN = 30
DELAY_MAX = 90


def _calculate_scheduled_at(last_scheduled: str | None) -> str:
    delay = random.randint(DELAY_MIN, DELAY_MAX)
    now = datetime.now(timezone.utc)
    if last_scheduled:
        base = max(datetime.fromisoformat(last_scheduled), now)
    else:
        base = now
    return (base + timedelta(seconds=delay)).isoformat()


async def _get_usage_dict() -> dict:
    today = date.today().isoformat()
    used = await database.get_connection_usage(today)
    return {"used": used, "limit": DAILY_CONNECTION_LIMIT}


@router.put("/{profile_id}", response_model=ConnectionResponse)
async def update_connection_status(profile_id: int, body: ConnectionStatusUpdate):
    if body.status == "queued":
        today = date.today().isoformat()
        used = await database.get_connection_usage(today)
        if used >= DAILY_CONNECTION_LIMIT:
            raise HTTPException(status_code=429, detail="Daily connection limit (50) reached.")

        last = await database.get_last_scheduled_at()
        scheduled_at = _calculate_scheduled_at(last)
        ok = await database.update_connection_status(profile_id, "queued", scheduled_at=scheduled_at)
    elif body.status == "connected":
        ok = await database.update_connection_status(profile_id, "connected")
        scheduled_at = None
    else:
        ok = await database.update_connection_status(profile_id, "none")
        scheduled_at = None

    if not ok:
        raise HTTPException(status_code=404, detail="Profile not found.")

    usage = await _get_usage_dict()
    return ConnectionResponse(
        profile_id=profile_id,
        connection_status=body.status,
        connection_scheduled_at=scheduled_at,
        daily_usage=usage,
    )


@router.get("/queue", response_model=ConnectionQueueResponse)
async def get_queue():
    item = await database.get_next_queued_connection()
    if item is None:
        return ConnectionQueueResponse(item=None)
    return ConnectionQueueResponse(
        item=ConnectionQueueItem(
            profile_id=item["id"],
            profile_url=item["profile_url"],
            name=item["name"],
        )
    )


@router.put("/{profile_id}/result", response_model=ConnectionResponse)
async def report_result(profile_id: int, body: ConnectionResultUpdate):
    await database.report_connection_result(profile_id, body.status)
    if body.status == "sent":
        today = date.today().isoformat()
        await database.increment_connection_usage(today)
    return ConnectionResponse(
        profile_id=profile_id,
        connection_status=body.status,
    )


@router.get("/usage", response_model=ConnectionUsageResponse)
async def get_usage():
    today = date.today().isoformat()
    used = await database.get_connection_usage(today)
    return ConnectionUsageResponse(used=used, limit=DAILY_CONNECTION_LIMIT, date=today)


@router.put("/bulk", response_model=ConnectionBulkResponse)
async def bulk_queue(body: ConnectionBulkRequest):
    today = date.today().isoformat()
    used = await database.get_connection_usage(today)
    if used + len(body.profile_ids) > DAILY_CONNECTION_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Bulk queue would exceed daily limit. {DAILY_CONNECTION_LIMIT - used} slots remaining.",
        )

    last = await database.get_last_scheduled_at()
    queued = []
    for pid in body.profile_ids:
        scheduled_at = _calculate_scheduled_at(last)
        ok = await database.update_connection_status(pid, "queued", scheduled_at=scheduled_at)
        if ok:
            queued.append(ConnectionResponse(
                profile_id=pid,
                connection_status="queued",
                connection_scheduled_at=scheduled_at,
            ))
            last = scheduled_at

    usage = await _get_usage_dict()
    return ConnectionBulkResponse(queued=queued, daily_usage=usage)
```

- [ ] **Step 4: Register the router in main.py**

In `backend/app/main.py`, change line 11:

```python
from app.routers import search, results, export, settings, quota
```

to:

```python
from app.routers import search, results, export, settings, quota, connections
```

And after line 50 (`app.include_router(quota.router)`), add:

```python
app.include_router(connections.router)
```

- [ ] **Step 5: Run all connection tests**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py -v`
Expected: All 27 tests pass

- [ ] **Step 6: Run full test suite**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/connections.py backend/app/main.py backend/tests/test_connections.py
git commit -m "feat: add connections router with queue, status, bulk, and usage endpoints"
```

---

### Task 6: Frontend — types and API functions

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Update Profile interface and add connection types**

In `frontend/src/lib/types.ts`, replace the `Profile` interface (lines 1-9) with:

```typescript
export interface Profile {
  id: number;
  name: string;
  profile_url: string;
  snippet: string | null;
  matched_keywords: string[];
  connection_status: "none" | "queued" | "sent" | "connected" | "failed";
  connection_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}
```

Append to the end of `frontend/src/lib/types.ts`:

```typescript

export interface ConnectionResponse {
  profile_id: number;
  connection_status: string;
  connection_scheduled_at: string | null;
  daily_usage: { used: number; limit: number } | null;
}

export interface ConnectionUsage {
  used: number;
  limit: number;
  date: string;
}

export interface ConnectionBulkResponse {
  queued: ConnectionResponse[];
  daily_usage: { used: number; limit: number };
}
```

- [ ] **Step 2: Add API functions**

Append to `frontend/src/lib/api.ts`:

```typescript

export async function updateConnectionStatus(
  profileId: number,
  status: "queued" | "connected" | "none"
): Promise<ConnectionResponse> {
  return fetchJSON(`/api/connections/${profileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function bulkQueueConnections(
  profileIds: number[]
): Promise<ConnectionBulkResponse> {
  return fetchJSON("/api/connections/bulk", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_ids: profileIds }),
  });
}

export async function getConnectionUsage(): Promise<ConnectionUsage> {
  return fetchJSON("/api/connections/usage");
}
```

Also update the import line at the top of `api.ts` (line 2):

```typescript
import type { ProfileListResponse, Settings, Quota, ConnectionResponse, ConnectionBulkResponse, ConnectionUsage } from "./types";
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npx next build`
Expected: Compiled successfully

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat: add connection types and API functions to frontend"
```

---

### Task 7: Frontend — ConnectionButton component

**Files:**
- Create: `frontend/src/components/ConnectionButton.tsx`

- [ ] **Step 1: Create the ConnectionButton component**

Create `frontend/src/components/ConnectionButton.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import type { Profile } from "@/lib/types";
import { updateConnectionStatus } from "@/lib/api";

interface ConnectionButtonProps {
  profile: Profile;
  onStatusChange: (profileId: number, status: string, scheduledAt: string | null) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  none: {
    label: "Connect",
    className: "border border-slate-300 text-slate-700 hover:bg-slate-50",
  },
  queued: {
    label: "Queued",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
  },
  sent: {
    label: "Sent",
    className: "bg-green-100 text-green-800 border border-green-200",
  },
  connected: {
    label: "Connected",
    className: "bg-blue-100 text-blue-800 border border-blue-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 border border-red-200",
  },
};

type DropdownOption = {
  label: string;
  action: "queued" | "connected" | "none";
};

function getDropdownOptions(status: string): DropdownOption[] {
  switch (status) {
    case "none":
      return [
        { label: "Send Connection", action: "queued" },
        { label: "Already Connected", action: "connected" },
      ];
    case "queued":
      return [{ label: "Cancel", action: "none" }];
    case "sent":
      return [{ label: "Reset", action: "none" }];
    case "connected":
      return [{ label: "Reset", action: "none" }];
    case "failed":
      return [
        { label: "Retry", action: "queued" },
        { label: "Already Connected", action: "connected" },
      ];
    default:
      return [];
  }
}

function formatScheduledTime(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConnectionButton({ profile, onStatusChange }: ConnectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const config = STATUS_CONFIG[profile.connection_status] || STATUS_CONFIG.none;
  const options = getDropdownOptions(profile.connection_status);

  const displayLabel =
    profile.connection_status === "queued" && profile.connection_scheduled_at
      ? `Queued - ${formatScheduledTime(profile.connection_scheduled_at)}`
      : config.label;

  const handleAction = async (action: "queued" | "connected" | "none") => {
    setLoading(true);
    setOpen(false);
    try {
      const resp = await updateConnectionStatus(profile.id, action);
      onStatusChange(profile.id, resp.connection_status, resp.connection_scheduled_at);
    } catch {
      // silently fail — UI stays at current state
    }
    setLoading(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${config.className} ${loading ? "opacity-50" : ""}`}
      >
        {loading ? "..." : displayLabel}
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && options.length > 0 && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-md shadow-lg z-20">
          {options.map((opt) => (
            <button
              key={opt.action + opt.label}
              onClick={() => handleAction(opt.action)}
              className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 first:rounded-t-md last:rounded-b-md"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npx next build`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ConnectionButton.tsx
git commit -m "feat: add ConnectionButton dropdown component"
```

---

### Task 8: Frontend — ResultsTable with Status column, checkboxes, and bulk action

**Files:**
- Modify: `frontend/src/components/ResultsTable.tsx`

- [ ] **Step 1: Rewrite ResultsTable with new columns**

Replace the entire content of `frontend/src/components/ResultsTable.tsx` with:

```tsx
"use client";

import { useState, useMemo } from "react";
import type { Profile } from "@/lib/types";
import { getExportUrl, bulkQueueConnections } from "@/lib/api";
import ConnectionButton from "./ConnectionButton";

interface ResultsTableProps {
  profiles: Profile[];
  total: number;
  loading: boolean;
  onProfileUpdate: (profileId: number, status: string, scheduledAt: string | null) => void;
}

type SortField = "name" | "updated_at";
type SortDir = "asc" | "desc";

export default function ResultsTable({ profiles, total, loading, onProfileUpdate }: ResultsTableProps) {
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

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

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  const queueableSelected = useMemo(() => {
    return filtered.filter(
      (p) => selected.has(p.id) && (p.connection_status === "none" || p.connection_status === "failed")
    );
  }, [filtered, selected]);

  const handleBulkQueue = async () => {
    if (queueableSelected.length === 0) return;
    setBulkLoading(true);
    try {
      const resp = await bulkQueueConnections(queueableSelected.map((p) => p.id));
      for (const item of resp.queued) {
        onProfileUpdate(item.profile_id, item.connection_status, item.connection_scheduled_at);
      }
      setSelected(new Set());
    } catch {
      // silently fail
    }
    setBulkLoading(false);
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
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th
                  className="text-left px-6 py-3 font-medium text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                  onClick={() => toggleSort("name")}
                >
                  Name{sortIcon("name")}
                </th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Profile Link</th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Bio Snippet</th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Keywords</th>
                <th className="text-left px-6 py-3 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(profile.id)}
                      onChange={() => toggleSelect(profile.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
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
                      {profile.snippet || "\u2014"}
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
                  <td className="px-6 py-3">
                    <ConnectionButton profile={profile} onStatusChange={onProfileUpdate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {queueableSelected.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-slate-600">
            {queueableSelected.length} profile{queueableSelected.length > 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleBulkQueue}
            disabled={bulkLoading}
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? "Queuing..." : `Send Connection to ${queueableSelected.length} profiles`}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npx next build`
Expected: Build will FAIL because `page.tsx` doesn't pass `onProfileUpdate` prop yet. That's expected — Task 10 fixes it.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ResultsTable.tsx
git commit -m "feat: add checkbox selection, Status column, and bulk action bar to ResultsTable"
```

---

### Task 9: Frontend — connection quota badge in Header

**Files:**
- Modify: `frontend/src/components/Header.tsx`

- [ ] **Step 1: Add connection quota badge**

Replace the entire content of `frontend/src/components/Header.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import type { Quota, ConnectionUsage } from "@/lib/types";
import { getQuota, getConnectionUsage } from "@/lib/api";
import SettingsPanel from "./SettingsPanel";

interface HeaderProps {
  onQuotaRefresh?: () => void;
}

export default function Header({ onQuotaRefresh }: HeaderProps) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [connUsage, setConnUsage] = useState<ConnectionUsage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchQuota = async () => {
    try {
      const q = await getQuota();
      setQuota(q);
    } catch {
      // silently fail
    }
  };

  const fetchConnUsage = async () => {
    try {
      const u = await getConnectionUsage();
      setConnUsage(u);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchQuota();
    fetchConnUsage();
  }, []);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    fetchQuota();
    fetchConnUsage();
    onQuotaRefresh?.();
  };

  return (
    <>
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">LinkedIn X-Ray Search</h1>
            <p className="text-sm text-slate-500">Healthcare &amp; AI profile discovery</p>
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
            {connUsage && (
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                connUsage.used >= connUsage.limit
                  ? "bg-red-50 text-red-700"
                  : connUsage.used >= connUsage.limit * 0.8
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-600"
              }`}>
                {connUsage.used}/{connUsage.limit} connections
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

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npx next build`
Expected: Build will FAIL (same reason as Task 8 — `page.tsx` not yet updated). That's expected.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Header.tsx
git commit -m "feat: add connection quota badge to header"
```

---

### Task 10: Frontend — wire up page.tsx with profile update callback

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Update page.tsx to handle profile status updates**

Replace the entire content of `frontend/src/app/page.tsx` with:

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

  const handleProfileUpdate = useCallback(
    (profileId: number, status: string, scheduledAt: string | null) => {
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                connection_status: status as Profile["connection_status"],
                connection_scheduled_at: scheduledAt,
              }
            : p
        )
      );
    },
    []
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onQuotaRefresh={fetchResults} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <SearchPanel
          searchState={searchState}
          onSearch={handleSearch}
          onCancel={searchState.cancelSearch}
        />
        <ResultsTable
          profiles={profiles}
          total={total}
          loading={loadingResults}
          onProfileUpdate={handleProfileUpdate}
        />
        <ActivityLog logs={searchState.logs} />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npx next build`
Expected: Compiled successfully (all props now wired up)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: wire up connection status updates in page.tsx"
```

---

### Task 11: Chrome Extension — manifest and background service worker

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`

- [ ] **Step 1: Create extension directory and manifest**

Run: `mkdir -p extension`

Create `extension/manifest.json`:

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

- [ ] **Step 2: Create the background service worker**

Create `extension/background.js`:

```javascript
const API_BASE = "http://localhost:8000";
const POLL_INTERVAL = 10000;
const PAUSE_DURATION = 5 * 60 * 1000;

let polling = true;
let paused = false;
let currentTabId = null;
let currentItem = null;

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

async function pollQueue() {
  if (!polling || paused) return;

  try {
    const resp = await fetch(`${API_BASE}/api/connections/queue`);
    if (!resp.ok) return;

    const data = await resp.json();
    if (!data.item) {
      clearBadge();
      return;
    }

    currentItem = data.item;
    setBadge("...", "#f59e0b");

    const tab = await chrome.tabs.create({
      url: data.item.profile_url,
      active: false,
    });
    currentTabId = tab.id;
  } catch (err) {
    console.error("Poll error:", err);
  }
}

async function reportResult(profileId, status, error) {
  try {
    await fetch(`${API_BASE}/api/connections/${profileId}/result`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status, error: error || null }),
    });
  } catch (err) {
    console.error("Report error:", err);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CONNECTION_RESULT") {
    const profileId = currentItem?.profile_id;
    if (!profileId) return;

    reportResult(profileId, message.status, message.error).then(() => {
      if (currentTabId) {
        chrome.tabs.remove(currentTabId).catch(() => {});
        currentTabId = null;
      }
      currentItem = null;

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
});

setInterval(pollQueue, POLL_INTERVAL);
pollQueue();
```

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json extension/background.js
git commit -m "feat: add Chrome extension manifest and background service worker"
```

---

### Task 12: Chrome Extension — content script

**Files:**
- Create: `extension/content.js`

- [ ] **Step 1: Create the content script**

Create `extension/content.js`:

```javascript
(function () {
  const MAX_WAIT_PAGE = 5000;
  const MAX_WAIT_MODAL = 3000;
  const POLL_MS = 300;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findConnectButton() {
    const selectors = [
      'button[aria-label*="Invite"][aria-label*="connect"]',
      'button[aria-label*="Connect"]',
      'button.pvs-profile-actions__action',
    ];

    for (const sel of selectors) {
      const buttons = document.querySelectorAll(sel);
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || "";
        if (text.includes("connect") && !text.includes("message")) {
          return btn;
        }
      }
    }
    return null;
  }

  function findSendWithoutNoteButton() {
    const selectors = [
      'button[aria-label="Send without a note"]',
      'button[aria-label="Send now"]',
      'button.artdeco-modal__confirm-dialog-btn',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }

    const allButtons = document.querySelectorAll("button");
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (text === "send without a note" || text === "send now") {
        return btn;
      }
    }
    return null;
  }

  function isCaptchaPage() {
    return (
      document.title.toLowerCase().includes("security verification") ||
      document.querySelector('iframe[src*="captcha"]') !== null ||
      document.querySelector(".challenge-dialog") !== null
    );
  }

  function isRestrictionPage() {
    const body = document.body?.textContent?.toLowerCase() || "";
    return body.includes("you've reached the weekly invitation limit");
  }

  async function waitForElement(finder, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = finder();
      if (el) return el;
      await sleep(POLL_MS);
    }
    return null;
  }

  async function run() {
    await sleep(2000);

    if (isCaptchaPage()) {
      chrome.runtime.sendMessage({
        type: "CONNECTION_RESULT",
        status: "failed",
        error: "captcha",
      });
      return;
    }

    if (isRestrictionPage()) {
      chrome.runtime.sendMessage({
        type: "CONNECTION_RESULT",
        status: "failed",
        error: "captcha",
      });
      return;
    }

    const connectBtn = await waitForElement(findConnectButton, MAX_WAIT_PAGE);
    if (!connectBtn) {
      chrome.runtime.sendMessage({
        type: "CONNECTION_RESULT",
        status: "failed",
        error: "connect_button_not_found",
      });
      return;
    }

    connectBtn.click();

    const sendBtn = await waitForElement(findSendWithoutNoteButton, MAX_WAIT_MODAL);
    if (sendBtn) {
      sendBtn.click();
      await sleep(1000);
      chrome.runtime.sendMessage({
        type: "CONNECTION_RESULT",
        status: "sent",
        error: null,
      });
    } else {
      await sleep(500);
      chrome.runtime.sendMessage({
        type: "CONNECTION_RESULT",
        status: "sent",
        error: null,
      });
    }
  }

  run();
})();
```

- [ ] **Step 2: Create placeholder extension icons**

Run:
```bash
cd extension
# Create simple 1x1 pixel PNGs as placeholders (replace with real icons later)
python3 -c "
import struct, zlib
def make_png(size):
    raw = b''
    for _ in range(size):
        raw += b'\x00' + b'\x4a\x7b\xb5' * size  # blue pixel row
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
for s in [16, 48, 128]:
    with open(f'icon{s}.png', 'wb') as f:
        f.write(make_png(s))
"
```

- [ ] **Step 3: Commit**

```bash
git add extension/content.js extension/icon16.png extension/icon48.png extension/icon128.png
git commit -m "feat: add Chrome extension content script and placeholder icons"
```

---

### Task 13: Integration test — full end-to-end backend flow

**Files:**
- Modify: `backend/tests/test_connections.py` (append)

- [ ] **Step 1: Write end-to-end integration test**

Append to `backend/tests/test_connections.py`:

```python
@pytest.mark.asyncio
async def test_full_connection_flow(client):
    """End-to-end: queue -> poll -> report sent -> verify status"""
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")

    # Queue the connection
    async with client as c:
        resp = await c.put("/api/connections/1", json={"status": "queued"})
    assert resp.status_code == 200
    assert resp.json()["connection_status"] == "queued"

    # Poll — should not be ready yet (scheduled in the future)
    async with client as c:
        resp = await c.get("/api/connections/queue")
    assert resp.status_code == 200
    assert resp.json()["item"] is None

    # Manually set scheduled_at to past to simulate time passing
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    await database.update_connection_status(1, "queued", scheduled_at=past)

    # Poll again — should be ready now
    async with client as c:
        resp = await c.get("/api/connections/queue")
    assert resp.status_code == 200
    assert resp.json()["item"]["profile_id"] == 1

    # Report sent
    async with client as c:
        resp = await c.put("/api/connections/1/result", json={"status": "sent"})
    assert resp.status_code == 200
    assert resp.json()["connection_status"] == "sent"

    # Usage should be incremented
    async with client as c:
        resp = await c.get("/api/connections/usage")
    assert resp.status_code == 200
    assert resp.json()["used"] == 1

    # Profile should show sent in results
    async with client as c:
        resp = await c.get("/api/results")
    assert resp.status_code == 200
    assert resp.json()["profiles"][0]["connection_status"] == "sent"
```

- [ ] **Step 2: Run the test**

Run: `source backend/venv/bin/activate && pytest backend/tests/test_connections.py::test_full_connection_flow -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_connections.py
git commit -m "test: add end-to-end integration test for connection flow"
```

---

### Task 14: Final build verification and cleanup

**Files:**
- No new files

- [ ] **Step 1: Run all backend tests**

Run: `source backend/venv/bin/activate && pytest backend/tests/ -v`
Expected: All tests pass (should be ~40+ tests now)

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npx next build`
Expected: Compiled successfully

- [ ] **Step 3: Start the dev server and verify the UI**

Run: `npm run dev`

Manual checks:
1. Open http://localhost:3000
2. Verify the header shows two badges: "0/2500 queries today" and "0/50 connections"
3. If profiles exist in the table, verify each row has a checkbox and a "Connect" dropdown button
4. Click a "Connect" button — dropdown should show "Send Connection" and "Already Connected"
5. Click "Already Connected" — button should change to blue "Connected"
6. Click the dropdown again — should show "Reset"
7. Click "Reset" — should go back to gray "Connect"
8. Select multiple checkboxes — floating bar should appear at bottom with "Send Connection to N profiles"

- [ ] **Step 4: Commit any final fixes if needed**

```bash
git add -A
git commit -m "chore: final build verification and cleanup"
```
