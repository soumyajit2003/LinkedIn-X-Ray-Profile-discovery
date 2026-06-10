from datetime import date

import httpx
from fastapi import APIRouter

from app import database
from app.config import DAILY_QUOTA_LIMIT
from app.models import QuotaResponse
from app.routers.settings import resolve_api_key

router = APIRouter(prefix="/api")

SERPER_ACCOUNT_URL = "https://google.serper.dev/account"


@router.get("/quota", response_model=QuotaResponse)
async def get_quota():
    today = date.today().isoformat()
    api_key = await resolve_api_key()

    # Try to get live balance from Serper
    credits_left = None
    if api_key:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    SERPER_ACCOUNT_URL,
                    headers={"X-API-KEY": api_key},
                    timeout=5.0,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    credits_left = data.get("balance")
        except Exception:
            pass

    if credits_left is not None:
        used = DAILY_QUOTA_LIMIT - credits_left
        return QuotaResponse(used=used, limit=DAILY_QUOTA_LIMIT, date=today)

    # Fallback to local tracking
    used = await database.get_daily_usage(today)
    return QuotaResponse(used=used, limit=DAILY_QUOTA_LIMIT, date=today)
