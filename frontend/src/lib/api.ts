import { API_BASE } from "./constants";
import type { ProfileListResponse, Settings, Quota, ConnectionResponse, ConnectionBulkResponse, ConnectionUsage, EnrichmentResponse, AISettings, Project, ProjectListResponse } from "./types";

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getResults(limit = 50, offset = 0, projectId?: number | null): Promise<ProfileListResponse> {
  let url = `/api/results?limit=${limit}&offset=${offset}`;
  if (projectId) url += `&project_id=${projectId}`;
  return fetchJSON(url);
}

export async function getSettings(): Promise<Settings> {
  return fetchJSON("/api/settings");
}

export async function updateSettings(data: { api_key?: string; cx_id?: string }): Promise<Settings> {
  return fetchJSON("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getQuota(): Promise<Quota> {
  return fetchJSON("/api/quota");
}

export async function exportFiltered(profileIds: number[], filename = "linkedin_profiles.xlsx"): Promise<void> {
  const res = await fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_ids: profileIds }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function notifyExtensionStartPolling() {
  window.postMessage({ type: "START_POLLING" }, "*");
}

export async function updateConnectionStatus(
  profileId: number,
  status: "queued" | "connected" | "none"
): Promise<ConnectionResponse> {
  const result = await fetchJSON<ConnectionResponse>(`/api/connections/${profileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, client_date: getLocalDateISO() }),
  });
  if (status === "queued") notifyExtensionStartPolling();
  return result;
}

export async function bulkQueueConnections(
  profileIds: number[]
): Promise<ConnectionBulkResponse> {
  const result = await fetchJSON<ConnectionBulkResponse>("/api/connections/bulk", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_ids: profileIds, client_date: getLocalDateISO() }),
  });
  if (profileIds.length > 0) notifyExtensionStartPolling();
  return result;
}

function getLocalDateISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getConnectionUsage(): Promise<ConnectionUsage> {
  return fetchJSON(`/api/connections/usage?client_date=${getLocalDateISO()}`);
}

export async function backfillImages(
  onProgress?: (fetched: number, total: number) => void,
  projectId?: number | null
): Promise<{ fetched: number; total: number }> {
  const params = projectId ? `?project_id=${projectId}` : "";
  const res = await fetch(`${API_BASE}/api/backfill-images${params}`, { method: "POST" });
  if (!res.ok) throw new Error(`API error ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let result = { fetched: 0, total: 0 };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          const count = data.fetched ?? data.updated ?? 0;
          result = { fetched: count, total: data.total };
          onProgress?.(count, data.total);
        } catch {}
      }
    }
  }

  return result;
}

export async function getEnrichment(profileId: number): Promise<EnrichmentResponse> {
  return fetchJSON(`/api/profiles/${profileId}/enrichment`);
}

export async function populateFromSlugs(): Promise<{ created_sent: number; created_connected: number }> {
  return fetchJSON("/api/connections/populate-from-slugs", { method: "POST" });
}

export async function deleteProfiles(profileIds: number[]): Promise<{ deleted: number }> {
  return fetchJSON("/api/delete-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_ids: profileIds }),
  });
}

export async function getAISettings(): Promise<AISettings> {
  return fetchJSON("/api/chat/settings");
}

export async function updateAISettings(data: {
  openai_key?: string;
  openai_model?: string;
  anthropic_key?: string;
  anthropic_model?: string;
  gemini_key?: string;
  gemini_model?: string;
  bedrock_key?: string;
  bedrock_region?: string;
  bedrock_model?: string;
}): Promise<AISettings> {
  return fetchJSON("/api/chat/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function getChatStreamUrl(): string {
  return `${API_BASE}/api/chat`;
}

// ---- Projects ----

export async function getProjects(): Promise<ProjectListResponse> {
  return fetchJSON("/api/projects");
}

export async function createProject(name: string, description = "", keywords: string[] = []): Promise<Project> {
  return fetchJSON("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, keywords }),
  });
}

export async function updateProject(id: number, data: { name?: string; description?: string; keywords?: string[] }): Promise<Project> {
  return fetchJSON(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: number): Promise<void> {
  await fetchJSON(`/api/projects/${id}`, { method: "DELETE" });
}
