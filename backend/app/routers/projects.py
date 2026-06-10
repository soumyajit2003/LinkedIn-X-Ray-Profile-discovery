import json

from fastapi import APIRouter, HTTPException

from app import database
from app.models import (
    ProjectCreate,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
)

router = APIRouter(prefix="/api/projects")


def _to_response(row: dict) -> ProjectResponse:
    keywords = row.get("keywords", "[]")
    if isinstance(keywords, str):
        keywords = json.loads(keywords)
    return ProjectResponse(
        id=row["id"],
        name=row["name"],
        description=row.get("description") or "",
        keywords=keywords,
        profile_count=row.get("profile_count", 0),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects():
    rows = await database.get_all_projects()
    return ProjectListResponse(projects=[_to_response(r) for r in rows])


@router.post("", response_model=ProjectResponse)
async def create_project(body: ProjectCreate):
    row = await database.create_project(body.name, body.description, body.keywords)
    row["profile_count"] = 0
    return _to_response(row)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: int):
    row = await database.get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    count = await database.get_profile_count_for_project(project_id)
    row["profile_count"] = count
    return _to_response(row)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: int, body: ProjectUpdate):
    project = await database.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project["name"] == database.DEFAULT_PROJECT_NAME and body.name and body.name != database.DEFAULT_PROJECT_NAME:
        raise HTTPException(status_code=403, detail="Cannot rename the default LinkedIn Network project")
    row = await database.update_project(
        project_id,
        name=body.name if project["name"] != database.DEFAULT_PROJECT_NAME else None,
        description=body.description,
        keywords=body.keywords,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    count = await database.get_profile_count_for_project(project_id)
    row["profile_count"] = count
    return _to_response(row)


@router.delete("/{project_id}")
async def delete_project(project_id: int):
    project = await database.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project["name"] == database.DEFAULT_PROJECT_NAME:
        raise HTTPException(status_code=403, detail="Cannot delete the default LinkedIn Network project")
    ok = await database.delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}
