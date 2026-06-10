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


from httpx import AsyncClient, ASGITransport
from datetime import date


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


@pytest.mark.asyncio
async def test_full_connection_flow(client):
    """End-to-end: queue -> poll -> report sent -> verify status"""
    await database.upsert_profile("Alice", "https://linkedin.com/in/alice", "Bio", "AI")

    async with client as c:
        # Queue the connection
        resp = await c.put("/api/connections/1", json={"status": "queued"})
        assert resp.status_code == 200
        assert resp.json()["connection_status"] == "queued"

        # Poll — should not be ready yet (scheduled in the future)
        resp = await c.get("/api/connections/queue")
        assert resp.status_code == 200
        assert resp.json()["item"] is None

        # Manually set scheduled_at to past to simulate time passing
        past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
        await database.update_connection_status(1, "queued", scheduled_at=past)

        # Poll again — should be ready now
        resp = await c.get("/api/connections/queue")
        assert resp.status_code == 200
        assert resp.json()["item"]["profile_id"] == 1

        # Report sent
        resp = await c.put("/api/connections/1/result", json={"status": "sent"})
        assert resp.status_code == 200
        assert resp.json()["connection_status"] == "sent"

        # Usage should be incremented
        resp = await c.get("/api/connections/usage")
        assert resp.status_code == 200
        assert resp.json()["used"] == 1

        # Profile should show sent in results
        resp = await c.get("/api/results")
        assert resp.status_code == 200
        assert resp.json()["profiles"][0]["connection_status"] == "sent"
