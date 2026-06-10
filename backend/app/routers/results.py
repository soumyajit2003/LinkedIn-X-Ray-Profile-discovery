import json

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app import database
from app.models import ProfileListResponse, ProfileResponse
from app.routers.settings import resolve_api_key
from app.services.profile_image import fetch_profile_images_via_serper, fetch_profile_info_via_serper

router = APIRouter(prefix="/api")


@router.get("/results", response_model=ProfileListResponse)
async def get_results(
    limit: int = Query(50, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    project_id: int | None = Query(None),
):
    if project_id:
        profiles_raw = await database.get_profiles_for_project(project_id, limit=limit, offset=offset)
        total = await database.get_profile_count_for_project(project_id)
    else:
        profiles_raw = await database.get_all_profiles(limit=limit, offset=offset)
        total = await database.get_profile_count()
    profiles = []
    for p in profiles_raw:
        enrichment = await database.get_enrichment(p["id"])
        snippet = p.get("snippet")
        if enrichment and enrichment.get("about"):
            snippet = enrichment["about"]
        proj_ids = await database.get_project_ids_for_profile(p["id"])
        profiles.append(
            ProfileResponse(
                id=p["id"],
                name=p["name"],
                profile_url=p["profile_url"],
                snippet=snippet,
                thumbnail_url=p.get("thumbnail_url") or "",
                matched_keywords=json.loads(p["matched_keywords"]),
                connection_status=p.get("connection_status", "none"),
                connection_scheduled_at=p.get("connection_scheduled_at"),
                followers=enrichment["followers"] if enrichment and enrichment.get("followers") else None,
                location=enrichment["location"] if enrichment and enrichment.get("location") else (p.get("search_location") or None),
                project_ids=proj_ids,
                created_at=str(p["created_at"]),
                updated_at=str(p["updated_at"]),
            )
        )
    return ProfileListResponse(profiles=profiles, total=total)


class DeleteProfilesRequest(BaseModel):
    profile_ids: list[int]


@router.post("/delete-profiles")
async def delete_profiles(body: DeleteProfilesRequest):
    deleted = await database.delete_profiles(body.profile_ids)
    return {"deleted": deleted}


@router.post("/backfill-images")
async def backfill_images(project_id: int | None = Query(None)):
    """Fetch profile info (thumbnail, snippet, location) for profiles missing photo+snippet."""
    api_key = await resolve_api_key()
    if not api_key:
        return {"error": "No API key configured"}

    if project_id:
        all_profiles = await database.get_profiles_for_project(project_id, limit=10000, offset=0)
    else:
        all_profiles = await database.get_all_profiles(limit=10000, offset=0)
    missing = [
        p for p in all_profiles
        if not p.get("thumbnail_url") and not p.get("snippet")
    ]

    async def event_generator():
        updated = 0
        async with httpx.AsyncClient() as client:
            batch_size = 5
            for i in range(0, len(missing), batch_size):
                batch = missing[i : i + batch_size]
                profiles_data = [{"name": p["name"], "profile_url": p["profile_url"]} for p in batch]
                results = await fetch_profile_info_via_serper(profiles_data, api_key, client)
                for info in results:
                    await database.update_profile_info(
                        profile_url=info["profile_url"],
                        thumbnail_url=info.get("thumbnail_url"),
                        snippet=info.get("snippet"),
                        location=info.get("location"),
                    )
                    updated += 1
                yield {
                    "event": "progress",
                    "data": json.dumps({"updated": updated, "total": len(missing), "batch": i + len(batch)}),
                }
        yield {
            "event": "done",
            "data": json.dumps({"updated": updated, "total": len(missing)}),
        }

    return EventSourceResponse(event_generator())
