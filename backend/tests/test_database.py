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
