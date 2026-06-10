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
            about=row.get("about"),
            scraped_at=row["scraped_at"],
        ),
    )


@router.put("/{profile_id}/enrichment", response_model=EnrichmentResponse)
async def save_enrichment(profile_id: int, body: EnrichmentUpdate):
    if body.name:
        await database.update_profile_name(profile_id, body.name)
    await database.save_enrichment(
        profile_id=profile_id,
        followers=body.followers,
        location=body.location,
        education=body.education,
        experience=body.experience,
        last_post_date=body.last_post_date,
        about=body.about,
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
            about=row.get("about"),
            scraped_at=row["scraped_at"],
        ),
    )
