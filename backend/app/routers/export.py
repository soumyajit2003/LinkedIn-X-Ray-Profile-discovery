from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import database
from app.services.excel_export import generate_excel

router = APIRouter(prefix="/api")


class ExportRequest(BaseModel):
    profile_ids: list[int] | None = None


@router.get("/export")
async def export_excel():
    profiles = await database.get_all_profiles(limit=10000, offset=0)
    output = generate_excel(profiles)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=linkedin_profiles.xlsx"},
    )


@router.post("/export")
async def export_filtered_excel(body: ExportRequest):
    all_profiles = await database.get_all_profiles(limit=10000, offset=0)
    if body.profile_ids is not None:
        id_set = set(body.profile_ids)
        profiles = [p for p in all_profiles if p["id"] in id_set]
        ordered = {pid: i for i, pid in enumerate(body.profile_ids)}
        profiles.sort(key=lambda p: ordered.get(p["id"], 0))
    else:
        profiles = all_profiles
    output = generate_excel(profiles)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=linkedin_profiles.xlsx"},
    )
