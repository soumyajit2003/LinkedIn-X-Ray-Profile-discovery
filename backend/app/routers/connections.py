import logging
import random
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

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
    IncrementalSlugsRequest,
    IncrementalSlugsResponse,
    KnownSlugsResponse,
    PostScanSyncRequest,
    PostScanSyncResponse,
    SyncFromCacheResponse,
    SyncSentRequest,
    SyncSentResponse,
)

router = APIRouter(prefix="/api/connections")


def _resolve_date(client_date: str | None = None) -> str:
    if client_date:
        try:
            date.fromisoformat(client_date)
            return client_date
        except ValueError:
            pass
    return date.today().isoformat()

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


async def _get_usage_dict(client_date: str | None = None) -> dict:
    today = _resolve_date(client_date)
    used = await database.get_connection_usage(today)
    return {"used": used, "limit": DAILY_CONNECTION_LIMIT}


# Define literal routes BEFORE parameterized routes to avoid conflicts
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


@router.get("/usage", response_model=ConnectionUsageResponse)
async def get_usage(client_date: str | None = Query(None)):
    today = _resolve_date(client_date)
    used = await database.get_connection_usage(today)
    return ConnectionUsageResponse(used=used, limit=DAILY_CONNECTION_LIMIT, date=today)


@router.post("/sync-sent", response_model=SyncSentResponse)
async def sync_sent_connections(body: SyncSentRequest):
    if not body.pending_slugs:
        logger.warning("Sync aborted — received empty slug list")
        return SyncSentResponse(promoted=0, promoted_profiles=[])

    sent_count = await database.get_sent_profile_count()
    logger.info("Sync: received %d scraped slugs, DB has %d sent profiles", len(body.pending_slugs), sent_count)

    would_promote = await database.get_promotable_profiles(body.pending_slugs)
    logger.info("Sync: would promote %d profiles: %s", len(would_promote), would_promote)

    promoted = await database.promote_accepted_connections(body.pending_slugs)
    logger.info("Sync: promoted %d profiles to connected", len(promoted))
    return SyncSentResponse(
        promoted=len(promoted),
        promoted_profiles=promoted,
    )


@router.get("/known-sent-slugs", response_model=KnownSlugsResponse)
async def get_known_sent_slugs():
    slugs = await database.get_known_sent_slugs()
    return KnownSlugsResponse(slugs=list(slugs))


@router.post("/sent-slugs", response_model=IncrementalSlugsResponse)
async def add_sent_slugs(body: IncrementalSlugsRequest):
    added = await database.add_sent_slugs(body.slugs)
    all_slugs = await database.get_known_sent_slugs()
    return IncrementalSlugsResponse(added=added, total=len(all_slugs))


@router.get("/known-connected-slugs", response_model=KnownSlugsResponse)
async def get_known_connected_slugs():
    slugs = await database.get_known_connected_slugs()
    return KnownSlugsResponse(slugs=list(slugs))


@router.post("/connected-slugs", response_model=IncrementalSlugsResponse)
async def add_connected_slugs(body: IncrementalSlugsRequest):
    added = await database.add_connected_slugs(body.slugs)
    all_slugs = await database.get_known_connected_slugs()
    return IncrementalSlugsResponse(added=added, total=len(all_slugs))


@router.post("/sync-from-cache", response_model=SyncFromCacheResponse)
async def sync_from_cache():
    result = await database.sync_post_scan_from_cache()
    promoted = len(result.get("promoted_to_connected", []))
    logger.info("Sync from cache: moved %d to sent, %d to connected, %d promoted",
                len(result["moved_to_sent"]), len(result["moved_to_connected"]), promoted)
    return SyncFromCacheResponse(
        moved_to_sent=len(result["moved_to_sent"]),
        moved_to_connected=len(result["moved_to_connected"]),
        promoted_to_connected=promoted,
    )


@router.post("/sync-post-scan", response_model=PostScanSyncResponse)
async def sync_post_scan(body: PostScanSyncRequest):
    logger.info("Post-scan sync: received %d sent slugs, %d connected slugs", len(body.sent_slugs), len(body.connected_slugs))

    result = await database.sync_post_scan(body.sent_slugs, body.connected_slugs)

    logger.info("Post-scan sync: moved %d to sent, %d to connected",
                len(result["moved_to_sent"]), len(result["moved_to_connected"]))
    return PostScanSyncResponse(
        moved_to_sent=len(result["moved_to_sent"]),
        moved_to_connected=len(result["moved_to_connected"]),
        sent_profiles=result["moved_to_sent"],
        connected_profiles=result["moved_to_connected"],
    )


@router.post("/populate-from-slugs")
async def populate_from_slugs():
    result = await database.populate_profiles_from_slugs()
    logger.info("Populate from slugs: created %d sent, %d connected",
                result["created_sent"], result["created_connected"])
    return result


@router.put("/bulk", response_model=ConnectionBulkResponse)
async def bulk_queue(body: ConnectionBulkRequest):
    today = _resolve_date(body.client_date)
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

    usage = await _get_usage_dict(body.client_date)
    return ConnectionBulkResponse(queued=queued, daily_usage=usage)


# Parameterized routes come after literal routes
@router.put("/{profile_id}", response_model=ConnectionResponse)
async def update_connection_status(profile_id: int, body: ConnectionStatusUpdate):
    if body.status == "queued":
        today = _resolve_date(body.client_date)
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

    usage = await _get_usage_dict(body.client_date)
    return ConnectionResponse(
        profile_id=profile_id,
        connection_status=body.status,
        connection_scheduled_at=scheduled_at,
        daily_usage=usage,
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
