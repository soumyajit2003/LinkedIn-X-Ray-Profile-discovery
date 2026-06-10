from typing import Literal

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    keywords: list[str] = Field(min_length=1)
    max_pages: int = Field(default=5, ge=1, le=10)
    locations: list[str] = Field(default_factory=list)
    project_id: int | None = None


class ProfileResponse(BaseModel):
    id: int
    name: str
    profile_url: str
    snippet: str | None
    thumbnail_url: str = ""
    matched_keywords: list[str]
    connection_status: str = "none"
    connection_scheduled_at: str | None = None
    followers: str | None = None
    location: str | None = None
    project_ids: list[int] = []
    created_at: str
    updated_at: str


class ProfileListResponse(BaseModel):
    profiles: list[ProfileResponse]
    total: int


class SettingsResponse(BaseModel):
    api_key_set: bool
    api_key_masked: str
    cx_id: str


class SettingsUpdate(BaseModel):
    api_key: str | None = None
    cx_id: str | None = None


class QuotaResponse(BaseModel):
    used: int
    limit: int
    date: str


class ConnectionStatusUpdate(BaseModel):
    status: Literal["queued", "connected", "none"]
    client_date: str | None = None


class ConnectionResultUpdate(BaseModel):
    status: Literal["sent", "failed"]
    error: str | None = None


class ConnectionBulkRequest(BaseModel):
    profile_ids: list[int] = Field(min_length=1)
    client_date: str | None = None


class ConnectionResponse(BaseModel):
    profile_id: int
    connection_status: str
    connection_scheduled_at: str | None = None
    daily_usage: dict | None = None


class ConnectionQueueItem(BaseModel):
    profile_id: int
    profile_url: str
    name: str


class ConnectionQueueResponse(BaseModel):
    item: ConnectionQueueItem | None


class ConnectionUsageResponse(BaseModel):
    used: int
    limit: int
    date: str


class ConnectionBulkResponse(BaseModel):
    queued: list[ConnectionResponse]
    daily_usage: dict


class SyncSentRequest(BaseModel):
    pending_slugs: list[str]


class SyncSentResponse(BaseModel):
    promoted: int
    promoted_profiles: list[str]


class PostScanSyncRequest(BaseModel):
    sent_slugs: list[str]
    connected_slugs: list[str]


class PostScanSyncResponse(BaseModel):
    moved_to_sent: int
    moved_to_connected: int
    sent_profiles: list[str]
    connected_profiles: list[str]


class IncrementalSlugsRequest(BaseModel):
    slugs: list[str]


class IncrementalSlugsResponse(BaseModel):
    added: int
    total: int


class KnownSlugsResponse(BaseModel):
    slugs: list[str]


class SyncFromCacheResponse(BaseModel):
    moved_to_sent: int
    moved_to_connected: int
    promoted_to_connected: int = 0


class EnrichmentData(BaseModel):
    followers: str | None = None
    location: str | None = None
    education: str | None = None
    experience: str | None = None
    last_post_date: str | None = None
    about: str | None = None
    scraped_at: str | None = None


class EnrichmentResponse(BaseModel):
    status: Literal["enriched", "not_enriched"]
    data: EnrichmentData | None = None


class EnrichmentUpdate(BaseModel):
    name: str | None = None
    followers: str | None = None
    location: str | None = None
    education: str | None = None
    experience: str | None = None
    last_post_date: str | None = None
    about: str | None = None


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    keywords: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    keywords: list[str] | None = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    keywords: list[str]
    profile_count: int = 0
    created_at: str
    updated_at: str


class ProjectListResponse(BaseModel):
    projects: list[ProjectResponse]
