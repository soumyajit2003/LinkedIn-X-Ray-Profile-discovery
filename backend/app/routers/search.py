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
from app.services.profile_image import fetch_profile_images_via_serper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/search")
async def search(body: SearchRequest):
    api_key = await resolve_api_key()
    cx_id = await resolve_cx_id()

    if not api_key:
        raise HTTPException(status_code=400, detail="Serper API key must be configured in Settings.")

    async def event_generator():
        today = date.today().isoformat()
        total_new = 0
        keywords_completed = 0

        # Pre-link: find existing profiles matching these keywords and link to this project (saves API credits)
        pre_linked = 0
        if body.project_id:
            for keyword in body.keywords:
                existing = await database.get_profiles_by_keyword_not_in_project(keyword, body.project_id)
                for p in existing:
                    await database.link_profile_to_project(body.project_id, p["id"])
                    pre_linked += 1
            if pre_linked > 0:
                yield {
                    "event": "log",
                    "data": json.dumps({
                        "timestamp": datetime.now().isoformat(),
                        "level": "INFO",
                        "message": f"Pre-linked {pre_linked} existing profiles to this project (0 credits used)",
                    }),
                }

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
                        raw = await fetch_search_page(keyword, api_key, cx_id, start, client, body.locations)
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
                        location_str = ", ".join(body.locations) if body.locations else ""
                        for r in results:
                            await database.upsert_profile(r["name"], r["profile_url"], r["snippet"], keyword, r.get("thumbnail_url", ""), location_str)
                            profile_row = await database.get_profile_by_url(r["profile_url"])
                            if profile_row:
                                if body.project_id:
                                    await database.link_profile_to_project(body.project_id, profile_row["id"])
                                if r.get("followers"):
                                    existing = await database.get_enrichment(profile_row["id"])
                                    if not existing or not existing.get("followers"):
                                        await database.save_enrichment(
                                            profile_id=profile_row["id"],
                                            followers=r["followers"],
                                            location=None,
                                            education=None,
                                            experience=None,
                                            last_post_date=None,
                                        )
                            total_new += 1
                            keyword_profiles += 1

                        # Fetch profile images via Serper images API
                        no_thumb = [r for r in results if not r.get("thumbnail_url")]
                        if no_thumb:
                            images = await fetch_profile_images_via_serper(no_thumb, api_key, client)
                            for url, img_url in images.items():
                                await database.update_profile_thumbnail(url, img_url)
                                await database.increment_daily_usage(today)

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
                "pre_linked": pre_linked,
                "keywords_completed": keywords_completed,
            }),
        }

    return EventSourceResponse(event_generator())
