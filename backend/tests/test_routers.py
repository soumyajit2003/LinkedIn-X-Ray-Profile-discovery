import pytest
import json
from pathlib import Path
from httpx import AsyncClient, ASGITransport

TEST_DB = Path(__file__).parent / "test_routers.db"

# CRITICAL: Set test DB path before importing any app modules
from app import database
database._db_path = TEST_DB


@pytest.fixture(autouse=True)
async def setup_db():
    if TEST_DB.exists():
        TEST_DB.unlink()
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
    assert data["limit"] == 2500


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
