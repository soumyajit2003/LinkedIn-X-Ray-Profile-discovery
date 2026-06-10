import json
import re
from datetime import date, datetime, timezone
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

CREATE TABLE IF NOT EXISTS profile_enrichment (
    profile_id INTEGER PRIMARY KEY,
    followers TEXT,
    location TEXT,
    education TEXT,
    experience TEXT,
    last_post_date TEXT,
    about TEXT,
    scraped_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_connection_queue
ON profiles(connection_status, connection_scheduled_at)
WHERE connection_status = 'queued';

CREATE TABLE IF NOT EXISTS linkedin_sent_slugs (
    slug TEXT PRIMARY KEY NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS linkedin_connected_slugs (
    slug TEXT PRIMARY KEY NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_profiles (
    project_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, profile_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
"""


async def init_db() -> None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.executescript(SQL_CREATE_TABLES)

        # Migrate existing profiles table to add connection columns
        cursor = await conn.execute("PRAGMA table_info(profiles)")
        columns = {row["name"] for row in await cursor.fetchall()}
        if "connection_status" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'none'")
        if "connection_queued_at" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_queued_at TIMESTAMP")
        if "connection_scheduled_at" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_scheduled_at TIMESTAMP")
        if "connection_sent_at" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN connection_sent_at TIMESTAMP")
        if "thumbnail_url" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN thumbnail_url TEXT DEFAULT ''")
        if "search_location" not in columns:
            await conn.execute("ALTER TABLE profiles ADD COLUMN search_location TEXT DEFAULT ''")

        # Migrate profile_enrichment table to add about column
        cursor = await conn.execute("PRAGMA table_info(profile_enrichment)")
        enrich_columns = {row["name"] for row in await cursor.fetchall()}
        if "about" not in enrich_columns:
            await conn.execute("ALTER TABLE profile_enrichment ADD COLUMN about TEXT")

        # Migrate existing profiles into "Untitled Project" if projects table is empty
        cursor = await conn.execute("SELECT COUNT(*) as cnt FROM projects")
        row = await cursor.fetchone()
        if row["cnt"] == 0:
            cursor2 = await conn.execute("SELECT COUNT(*) as cnt FROM profiles")
            profile_count = (await cursor2.fetchone())["cnt"]
            if profile_count > 0:
                await conn.execute(
                    "INSERT INTO projects (name, description) VALUES (?, ?)",
                    ("Untitled Project", "Auto-created for existing profiles"),
                )
                cursor3 = await conn.execute("SELECT id FROM projects WHERE name = 'Untitled Project'")
                proj = await cursor3.fetchone()
                await conn.execute(
                    "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) "
                    "SELECT ?, id FROM profiles",
                    (proj["id"],),
                )

        # Ensure "LinkedIn Network" default project exists and link all sent/connected profiles to it
        cursor = await conn.execute(
            "SELECT id FROM projects WHERE name = ?", (DEFAULT_PROJECT_NAME,)
        )
        ln_proj = await cursor.fetchone()
        if not ln_proj:
            await conn.execute(
                "INSERT INTO projects (name, description, keywords) VALUES (?, ?, '[]')",
                (DEFAULT_PROJECT_NAME, "Profiles synced from your LinkedIn account (sent invitations & connections)"),
            )
            cursor = await conn.execute(
                "SELECT id FROM projects WHERE name = ?", (DEFAULT_PROJECT_NAME,)
            )
            ln_proj = await cursor.fetchone()
        ln_project_id = ln_proj["id"]
        await conn.execute(
            "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) "
            "SELECT ?, id FROM profiles WHERE connection_status IN ('sent', 'connected')",
            (ln_project_id,),
        )

        await conn.commit()


async def upsert_profile(name: str, profile_url: str, snippet: str, keyword: str, thumbnail_url: str = "", search_location: str = "") -> None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT matched_keywords, snippet, thumbnail_url, search_location FROM profiles WHERE profile_url = ?",
            (profile_url,),
        )
        row = await cursor.fetchone()

        if row is None:
            await conn.execute(
                "INSERT INTO profiles (name, profile_url, snippet, matched_keywords, thumbnail_url, search_location) VALUES (?, ?, ?, ?, ?, ?)",
                (name, profile_url, snippet, json.dumps([keyword]), thumbnail_url, search_location),
            )
        else:
            existing_keywords = json.loads(row["matched_keywords"])
            if keyword not in existing_keywords:
                existing_keywords.append(keyword)
            existing_snippet = row["snippet"] or ""
            new_snippet = snippet if len(snippet) > len(existing_snippet) else existing_snippet
            existing_thumb = row["thumbnail_url"] or ""
            new_thumb = thumbnail_url if thumbnail_url and not existing_thumb else existing_thumb
            existing_loc = row["search_location"] or ""
            new_loc = search_location if search_location and not existing_loc else existing_loc
            await conn.execute(
                "UPDATE profiles SET matched_keywords = ?, snippet = ?, thumbnail_url = ?, search_location = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_url = ?",
                (json.dumps(existing_keywords), new_snippet, new_thumb, new_loc, profile_url),
            )
        await conn.commit()


async def update_profile_thumbnail(profile_url: str, thumbnail_url: str) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "UPDATE profiles SET thumbnail_url = ? WHERE profile_url = ?",
            (thumbnail_url, profile_url),
        )
        await conn.commit()


async def update_profile_info(profile_url: str, thumbnail_url: str | None = None, snippet: str | None = None, location: str | None = None) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        if thumbnail_url:
            await conn.execute(
                "UPDATE profiles SET thumbnail_url = ? WHERE profile_url = ? AND (thumbnail_url IS NULL OR thumbnail_url = '')",
                (thumbnail_url, profile_url),
            )
        if snippet:
            await conn.execute(
                "UPDATE profiles SET snippet = ? WHERE profile_url = ? AND (snippet IS NULL OR snippet = '' OR LENGTH(snippet) < ?)",
                (snippet, profile_url, len(snippet)),
            )
        if location:
            await conn.execute(
                "UPDATE profiles SET search_location = ? WHERE profile_url = ? AND (search_location IS NULL OR search_location = '')",
                (location, profile_url),
            )
        await conn.commit()


async def delete_profiles(profile_ids: list[int]) -> int:
    if not profile_ids:
        return 0
    async with aiosqlite.connect(_db_path) as conn:
        placeholders = ",".join("?" * len(profile_ids))
        await conn.execute(f"DELETE FROM project_profiles WHERE profile_id IN ({placeholders})", profile_ids)
        await conn.execute(f"DELETE FROM profile_enrichment WHERE profile_id IN ({placeholders})", profile_ids)
        cursor = await conn.execute(f"DELETE FROM profiles WHERE id IN ({placeholders})", profile_ids)
        await conn.commit()
        return cursor.rowcount


async def get_all_profiles(limit: int = 100, offset: int = 0) -> list[dict]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT * FROM profiles ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_profile_count() -> int:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT COUNT(*) as cnt FROM profiles")
        row = await cursor.fetchone()
        return row["cnt"]


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await conn.commit()


async def get_setting(key: str) -> str | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None


async def get_daily_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT call_count FROM api_usage WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["call_count"] if row else 0


async def increment_daily_usage(date_str: str | None = None) -> int:
    if date_str is None:
        date_str = date.today().isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
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
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT id, profile_url, name FROM profiles "
            "WHERE connection_status = 'queued' AND connection_scheduled_at <= ? "
            "ORDER BY connection_scheduled_at ASC LIMIT 1",
            (now,)
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


_SLUG_PATTERN = re.compile(r"/in/([^/?#]+)")


def _extract_slug(profile_url: str) -> str:
    match = _SLUG_PATTERN.search(profile_url)
    return match.group(1).lower() if match else profile_url.lower()


async def get_sent_profile_count() -> int:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT COUNT(*) as cnt FROM profiles WHERE connection_status = 'sent'"
        )
        row = await cursor.fetchone()
        return row["cnt"]


async def get_promotable_profiles(pending_slugs: list[str]) -> list[str]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT profile_url FROM profiles WHERE connection_status = 'sent'"
        )
        sent_profiles = await cursor.fetchall()

        pending_set = {s.lower() for s in pending_slugs}
        return [
            row["profile_url"] for row in sent_profiles
            if _extract_slug(row["profile_url"]) not in pending_set
        ]


async def promote_accepted_connections(pending_slugs: list[str]) -> list[str]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT id, profile_url FROM profiles WHERE connection_status = 'sent'"
        )
        sent_profiles = await cursor.fetchall()

        pending_set = {s.lower() for s in pending_slugs}
        promoted = []
        for row in sent_profiles:
            slug = _extract_slug(row["profile_url"])
            if slug not in pending_set:
                await conn.execute(
                    "UPDATE profiles SET connection_status = 'connected', "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                promoted.append(row["profile_url"])

        await conn.commit()
        return promoted


async def get_known_sent_slugs() -> set[str]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT slug FROM linkedin_sent_slugs")
        rows = await cursor.fetchall()
        return {row["slug"] for row in rows}


async def add_sent_slugs(slugs: list[str]) -> int:
    async with aiosqlite.connect(_db_path) as conn:
        added = 0
        for slug in slugs:
            try:
                await conn.execute(
                    "INSERT OR IGNORE INTO linkedin_sent_slugs (slug) VALUES (?)", (slug.lower(),)
                )
                added += 1
            except Exception:
                pass
        await conn.commit()
        return added


async def remove_sent_slugs(slugs: list[str]) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        for slug in slugs:
            await conn.execute("DELETE FROM linkedin_sent_slugs WHERE slug = ?", (slug.lower(),))
        await conn.commit()


async def get_known_connected_slugs() -> set[str]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT slug FROM linkedin_connected_slugs")
        rows = await cursor.fetchall()
        return {row["slug"] for row in rows}


async def add_connected_slugs(slugs: list[str]) -> int:
    async with aiosqlite.connect(_db_path) as conn:
        added = 0
        for slug in slugs:
            try:
                await conn.execute(
                    "INSERT OR IGNORE INTO linkedin_connected_slugs (slug) VALUES (?)", (slug.lower(),)
                )
                added += 1
            except Exception:
                pass
        await conn.commit()
        return added


async def sync_post_scan_from_cache() -> dict:
    project_id = await get_or_create_default_project()

    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row

        sent_cursor = await conn.execute("SELECT slug FROM linkedin_sent_slugs")
        sent_slugs = {row["slug"] for row in await sent_cursor.fetchall()}

        conn_cursor = await conn.execute("SELECT slug FROM linkedin_connected_slugs")
        connected_slugs = {row["slug"] for row in await conn_cursor.fetchall()}

        cursor = await conn.execute(
            "SELECT id, profile_url, connection_status FROM profiles WHERE connection_status IN ('none', 'sent')"
        )
        profiles_to_check = await cursor.fetchall()

        moved_to_sent = []
        moved_to_connected = []
        promoted_to_connected = []

        for row in profiles_to_check:
            slug = _extract_slug(row["profile_url"])
            if slug in connected_slugs and row["connection_status"] != "connected":
                await conn.execute(
                    "UPDATE profiles SET connection_status = 'connected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                await conn.execute(
                    "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
                    (project_id, row["id"]),
                )
                if row["connection_status"] == "sent":
                    promoted_to_connected.append(row["profile_url"])
                else:
                    moved_to_connected.append(row["profile_url"])
            elif slug in sent_slugs and row["connection_status"] == "none":
                await conn.execute(
                    "UPDATE profiles SET connection_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                await conn.execute(
                    "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
                    (project_id, row["id"]),
                )
                moved_to_sent.append(row["profile_url"])

        await conn.commit()
        return {
            "moved_to_sent": moved_to_sent,
            "moved_to_connected": moved_to_connected,
            "promoted_to_connected": promoted_to_connected,
        }


async def sync_post_scan(sent_slugs: list[str], connected_slugs: list[str]) -> dict:
    sent_set = {s.lower() for s in sent_slugs}
    connected_set = {s.lower() for s in connected_slugs}

    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT id, profile_url, connection_status FROM profiles WHERE connection_status = 'none'"
        )
        none_profiles = await cursor.fetchall()

        moved_to_sent = []
        moved_to_connected = []

        for row in none_profiles:
            slug = _extract_slug(row["profile_url"])
            if slug in connected_set:
                await conn.execute(
                    "UPDATE profiles SET connection_status = 'connected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                moved_to_connected.append(row["profile_url"])
            elif slug in sent_set:
                await conn.execute(
                    "UPDATE profiles SET connection_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                moved_to_sent.append(row["profile_url"])

        await conn.commit()
        return {
            "moved_to_sent": moved_to_sent,
            "moved_to_connected": moved_to_connected,
        }


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


async def get_enrichment(profile_id: int) -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT * FROM profile_enrichment WHERE profile_id = ?",
            (profile_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def save_enrichment(
    profile_id: int,
    followers: str | None,
    location: str | None,
    education: str | None,
    experience: str | None,
    last_post_date: str | None,
    about: str | None = None,
) -> None:
    scraped_at = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "INSERT INTO profile_enrichment (profile_id, followers, location, education, experience, last_post_date, about, scraped_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(profile_id) DO UPDATE SET "
            "followers = excluded.followers, location = excluded.location, "
            "education = excluded.education, experience = excluded.experience, "
            "last_post_date = excluded.last_post_date, about = excluded.about, scraped_at = excluded.scraped_at",
            (profile_id, followers, location, education, experience, last_post_date, about, scraped_at),
        )
        await conn.commit()


# ---- Project CRUD ----

DEFAULT_PROJECT_NAME = "LinkedIn Network"


async def get_or_create_default_project() -> int:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT id FROM projects WHERE name = ?", (DEFAULT_PROJECT_NAME,)
        )
        row = await cursor.fetchone()
        if row:
            return row["id"]
        cursor2 = await conn.execute(
            "INSERT INTO projects (name, description, keywords) VALUES (?, ?, '[]')",
            (DEFAULT_PROJECT_NAME, "Profiles synced from your LinkedIn account (sent invitations & connections)"),
        )
        await conn.commit()
        return cursor2.lastrowid


async def create_project(name: str, description: str = "", keywords: list | None = None) -> dict:
    kw_json = json.dumps(keywords or [])
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "INSERT INTO projects (name, description, keywords) VALUES (?, ?, ?)",
            (name, description, kw_json),
        )
        await conn.commit()
        cursor2 = await conn.execute("SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,))
        row = await cursor2.fetchone()
        return dict(row)


async def get_all_projects() -> list[dict]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT * FROM projects ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            cursor2 = await conn.execute(
                "SELECT COUNT(*) as cnt FROM project_profiles WHERE project_id = ?", (d["id"],)
            )
            count_row = await cursor2.fetchone()
            d["profile_count"] = count_row["cnt"]
            result.append(d)
        return result


async def get_project(project_id: int) -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_project(project_id: int, name: str | None = None, description: str | None = None, keywords: list | None = None) -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        new_name = name if name is not None else row["name"]
        new_desc = description if description is not None else row["description"]
        new_kw = json.dumps(keywords) if keywords is not None else row["keywords"]
        await conn.execute(
            "UPDATE projects SET name = ?, description = ?, keywords = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_name, new_desc, new_kw, project_id),
        )
        await conn.commit()
        cursor2 = await conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        return dict(await cursor2.fetchone())


async def delete_project(project_id: int) -> bool:
    async with aiosqlite.connect(_db_path) as conn:
        cursor = await conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not await cursor.fetchone():
            return False
        # Delete orphaned profiles (only in this project, not in any other)
        await conn.execute(
            "DELETE FROM profiles WHERE id IN ("
            "  SELECT pp.profile_id FROM project_profiles pp "
            "  WHERE pp.project_id = ? "
            "  AND pp.profile_id NOT IN ("
            "    SELECT profile_id FROM project_profiles WHERE project_id != ?"
            "  )"
            ")",
            (project_id, project_id),
        )
        await conn.execute("DELETE FROM project_profiles WHERE project_id = ?", (project_id,))
        await conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await conn.commit()
        return True


async def link_profile_to_project(project_id: int, profile_id: int) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
            (project_id, profile_id),
        )
        await conn.commit()


async def get_profiles_for_project(project_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT p.* FROM profiles p "
            "JOIN project_profiles pp ON p.id = pp.profile_id "
            "WHERE pp.project_id = ? "
            "ORDER BY p.updated_at DESC LIMIT ? OFFSET ?",
            (project_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_profile_count_for_project(project_id: int) -> int:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT COUNT(*) as cnt FROM project_profiles WHERE project_id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        return row["cnt"]


async def get_project_ids_for_profile(profile_id: int) -> list[int]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT project_id FROM project_profiles WHERE profile_id = ?", (profile_id,)
        )
        rows = await cursor.fetchall()
        return [row["project_id"] for row in rows]


async def get_profiles_by_keyword_not_in_project(keyword: str, project_id: int) -> list[dict]:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            "SELECT p.* FROM profiles p "
            "WHERE p.matched_keywords LIKE ? "
            "AND p.id NOT IN (SELECT profile_id FROM project_profiles WHERE project_id = ?)",
            (f'%"{keyword}"%', project_id),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_profile_by_url(profile_url: str) -> dict | None:
    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT * FROM profiles WHERE profile_url = ?", (profile_url,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_profile_name(profile_id: int, name: str) -> None:
    async with aiosqlite.connect(_db_path) as conn:
        await conn.execute(
            "UPDATE profiles SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (name, profile_id),
        )
        await conn.commit()


async def populate_profiles_from_slugs() -> dict:
    project_id = await get_or_create_default_project()

    async with aiosqlite.connect(_db_path) as conn:
        conn.row_factory = aiosqlite.Row

        cursor = await conn.execute("SELECT id, profile_url FROM profiles")
        existing_slugs = {}
        for row in await cursor.fetchall():
            existing_slugs[_extract_slug(row["profile_url"])] = row["id"]

        sent_cursor = await conn.execute("SELECT slug FROM linkedin_sent_slugs")
        sent_slugs = [row["slug"] for row in await sent_cursor.fetchall()]

        conn_cursor = await conn.execute("SELECT slug FROM linkedin_connected_slugs")
        connected_slugs = [row["slug"] for row in await conn_cursor.fetchall()]

        created_sent = 0
        created_connected = 0
        new_profile_ids = []

        for slug in sent_slugs:
            if slug in existing_slugs:
                # Link existing profile to default project too
                await conn.execute(
                    "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
                    (project_id, existing_slugs[slug]),
                )
                continue
            name = slug.replace("-", " ").title()
            parts = name.rsplit(" ", 1)
            if len(parts) > 1 and len(parts[-1]) > 6 and any(c.isdigit() for c in parts[-1]):
                name = parts[0]
            url = f"https://www.linkedin.com/in/{slug}/"
            cur = await conn.execute(
                "INSERT INTO profiles (name, profile_url, snippet, matched_keywords, connection_status) "
                "VALUES (?, ?, '', '[]', 'sent')",
                (name, url),
            )
            existing_slugs[slug] = cur.lastrowid
            new_profile_ids.append(cur.lastrowid)
            created_sent += 1

        for slug in connected_slugs:
            if slug in existing_slugs:
                await conn.execute(
                    "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
                    (project_id, existing_slugs[slug]),
                )
                continue
            name = slug.replace("-", " ").title()
            parts = name.rsplit(" ", 1)
            if len(parts) > 1 and len(parts[-1]) > 6 and any(c.isdigit() for c in parts[-1]):
                name = parts[0]
            url = f"https://www.linkedin.com/in/{slug}/"
            cur = await conn.execute(
                "INSERT INTO profiles (name, profile_url, snippet, matched_keywords, connection_status) "
                "VALUES (?, ?, '', '[]', 'connected')",
                (name, url),
            )
            existing_slugs[slug] = cur.lastrowid
            new_profile_ids.append(cur.lastrowid)
            created_connected += 1

        # Link all new profiles to default project
        for pid in new_profile_ids:
            await conn.execute(
                "INSERT OR IGNORE INTO project_profiles (project_id, profile_id) VALUES (?, ?)",
                (project_id, pid),
            )

        await conn.commit()
        return {"created_sent": created_sent, "created_connected": created_connected, "project_id": project_id}
