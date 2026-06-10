from fastapi import APIRouter

from app import database
from app.config import SERPER_API_KEY
from app.models import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/api")


async def resolve_api_key() -> str:
    db_val = await database.get_setting("api_key")
    return db_val.strip() if db_val else SERPER_API_KEY


async def resolve_cx_id() -> str:
    db_val = await database.get_setting("cx_id")
    return db_val.strip() if db_val else ""


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    api_key = await resolve_api_key()
    cx_id = await resolve_cx_id()
    masked = ""
    if api_key:
        masked = api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:] if len(api_key) > 8 else "****"
    return SettingsResponse(
        api_key_set=bool(api_key),
        api_key_masked=masked,
        cx_id=cx_id,
    )


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate):
    if body.api_key is not None:
        await database.set_setting("api_key", body.api_key.strip())
    if body.cx_id is not None:
        await database.set_setting("cx_id", body.cx_id.strip())
    return await get_settings()
