"use client";

import { useState, useCallback, useMemo } from "react";
import type { Profile, Project } from "@/lib/types";
import { updateConnectionStatus } from "@/lib/api";
import ProfileAvatar from "./ProfileAvatar";
import { showToast } from "./Toast";

const PROJECT_COLORS = [
  "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700",
  "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700",
  "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700",
  "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700",
  "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700",
  "bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-700",
];

interface KanbanBoardProps {
  profiles: Profile[];
  onProfileUpdate: (profileId: number, status: string, scheduledAt: string | null) => void;
  projects?: Project[];
}

type ColumnId = "none" | "queued" | "sent" | "connected" | "failed";

const COLUMNS: { id: ColumnId; label: string; headerClass: string; dotClass: string }[] = [
  {
    id: "none",
    label: "Not Connected",
    headerClass: "bg-slate-50 dark:bg-neutral-800/50 border-slate-300 dark:border-neutral-600",
    dotClass: "bg-slate-400",
  },
  {
    id: "queued",
    label: "Queued",
    headerClass: "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700",
    dotClass: "bg-amber-400",
  },
  {
    id: "sent",
    label: "Sent",
    headerClass: "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700",
    dotClass: "bg-green-400",
  },
  {
    id: "connected",
    label: "Connected",
    headerClass: "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700",
    dotClass: "bg-blue-400",
  },
  {
    id: "failed",
    label: "Failed",
    headerClass: "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700",
    dotClass: "bg-red-400",
  },
];

const ALLOWED_MOVES: Record<string, ColumnId[]> = {
  none: ["queued", "connected"],
  sent: ["connected"],
  failed: ["queued", "connected"],
};

function isMovAllowed(from: ColumnId, to: ColumnId): boolean {
  if (from === to) return false;
  return ALLOWED_MOVES[from]?.includes(to) ?? false;
}

function statusToAction(status: ColumnId): "queued" | "connected" | "none" {
  if (status === "queued") return "queued";
  if (status === "connected") return "connected";
  return "none";
}

const CARD_COLORS: Record<ColumnId, string> = {
  none: "border-l-slate-400",
  queued: "border-l-amber-400",
  sent: "border-l-green-400",
  connected: "border-l-blue-400",
  failed: "border-l-red-400",
};

export default function KanbanBoard({ profiles, onProfileUpdate, projects = [] }: KanbanBoardProps) {
  const projectMap = useMemo(() => {
    const map = new Map<number, { name: string; colorIdx: number }>();
    projects.forEach((p, i) => map.set(p.id, { name: p.name, colorIdx: i % PROJECT_COLORS.length }));
    return map;
  }, [projects]);

  const [projectTooltip, setProjectTooltip] = useState<{ names: string[]; x: number; y: number } | null>(null);
  const [draggedProfile, setDraggedProfile] = useState<Profile | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  const grouped = useMemo(() => {
    const groups: Record<ColumnId, Profile[]> = {
      none: [],
      queued: [],
      sent: [],
      connected: [],
      failed: [],
    };
    for (const p of profiles) {
      const status = (p.connection_status || "none") as ColumnId;
      if (groups[status]) {
        groups[status].push(p);
      } else {
        groups.none.push(p);
      }
    }
    return groups;
  }, [profiles]);

  const handleDragStart = useCallback((e: React.DragEvent, profile: Profile) => {
    setDraggedProfile(profile);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(profile.id));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: ColumnId) => {
    e.preventDefault();
    if (!draggedProfile) return;
    const fromStatus = (draggedProfile.connection_status || "none") as ColumnId;
    if (isMovAllowed(fromStatus, columnId)) {
      e.dataTransfer.dropEffect = "move";
    } else {
      e.dataTransfer.dropEffect = "none";
    }
    setDragOverColumn(columnId);
  }, [draggedProfile]);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetColumn: ColumnId) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedProfile) return;
    const fromStatus = (draggedProfile.connection_status || "none") as ColumnId;
    const fromLabel = COLUMNS.find((c) => c.id === fromStatus)?.label || fromStatus;
    const toLabel = COLUMNS.find((c) => c.id === targetColumn)?.label || targetColumn;

    if (fromStatus === targetColumn) {
      setDraggedProfile(null);
      return;
    }

    if (!isMovAllowed(fromStatus, targetColumn)) {
      showToast(`Can't move from ${fromLabel} to ${toLabel} — it's an automated process`);
      setDraggedProfile(null);
      return;
    }

    const profile = draggedProfile;
    setDraggedProfile(null);
    setLoadingIds((prev) => new Set(prev).add(profile.id));

    try {
      const action = statusToAction(targetColumn);
      const resp = await updateConnectionStatus(profile.id, action);
      onProfileUpdate(profile.id, resp.connection_status, resp.connection_scheduled_at);
      if (action === "queued" && resp.connection_scheduled_at) {
        const time = new Date(resp.connection_scheduled_at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        showToast(`${profile.name} queued — will send at ${time}`);
      } else if (action === "connected") {
        showToast(`${profile.name} marked as connected`);
      }
    } catch {
      showToast(`Failed to update ${profile.name}`);
    }

    setLoadingIds((prev) => {
      const next = new Set(prev);
      next.delete(profile.id);
      return next;
    });
  }, [draggedProfile, onProfileUpdate]);

  const handleDragEnd = useCallback(() => {
    setDraggedProfile(null);
    setDragOverColumn(null);
  }, []);

  const getDropIndicator = (columnId: ColumnId): string => {
    if (!draggedProfile || dragOverColumn !== columnId) return "";
    const fromStatus = (draggedProfile.connection_status || "none") as ColumnId;
    if (fromStatus === columnId) return "";
    if (isMovAllowed(fromStatus, columnId)) {
      return "ring-2 ring-blue-400 dark:ring-blue-500 bg-blue-50/50 dark:bg-blue-900/20";
    }
    return "ring-2 ring-red-300 dark:ring-red-500 bg-red-50/30 dark:bg-red-900/10";
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 px-6 py-4 scrollbar-hide" style={{ minHeight: 400 }}>
      {COLUMNS.map((col) => {
        const items = grouped[col.id];
        const dropClass = getDropIndicator(col.id);
        return (
          <div
            key={col.id}
            className={`flex flex-col flex-shrink-0 rounded-lg border border-slate-200 dark:border-neutral-700 transition-all ${dropClass}`}
            style={{ width: 312 }}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className={`px-3 py-2.5 rounded-t-lg border-b ${col.headerClass}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${col.dotClass}`} />
                  <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
                    {col.label}
                  </span>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-neutral-400 bg-white dark:bg-neutral-700 px-2 py-0.5 rounded-full">
                  {items.length}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50 dark:bg-neutral-800/30 rounded-b-lg" style={{ maxHeight: 520 }}>
              {items.length === 0 && (
                <div className="text-xs text-slate-400 dark:text-neutral-500 text-center py-8">
                  No profiles
                </div>
              )}
              {items.map((profile) => (
                <div
                  key={profile.id}
                  draggable={!loadingIds.has(profile.id)}
                  onDragStart={(e) => handleDragStart(e, profile)}
                  onDragEnd={handleDragEnd}
                  className={`bg-white dark:bg-neutral-750 dark:bg-neutral-700/60 border border-slate-200 dark:border-neutral-600 rounded-md p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow border-l-3 ${CARD_COLORS[col.id]} ${
                    loadingIds.has(profile.id) ? "opacity-50 pointer-events-none" : ""
                  } ${
                    draggedProfile?.id === profile.id ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <ProfileAvatar name={profile.name} thumbnailUrl={profile.thumbnail_url} />
                    <div className="min-w-0 flex-1">
                      <a
                        href={profile.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-900 dark:text-neutral-100 truncate block hover:text-blue-600 dark:hover:text-blue-400"
                        title={profile.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {profile.name}
                      </a>
                      {profile.followers && (
                        <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                          {profile.followers} followers
                        </span>
                      )}
                    </div>
                  </div>

                  {profile.snippet && (
                    <p className="text-xs text-slate-500 dark:text-neutral-400 line-clamp-2 mb-1.5">
                      {profile.snippet}
                    </p>
                  )}

                  {profile.matched_keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {profile.matched_keywords.slice(0, 3).map((kw) => (
                        <span
                          key={kw}
                          className="px-1.5 py-0.5 bg-slate-100 dark:bg-neutral-600 text-slate-600 dark:text-neutral-300 text-[10px] rounded border border-slate-200 dark:border-neutral-500"
                        >
                          {kw}
                        </span>
                      ))}
                      {profile.matched_keywords.length > 3 && (
                        <span className="text-[10px] text-slate-400 dark:text-neutral-500 py-0.5">
                          +{profile.matched_keywords.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {profile.project_ids && profile.project_ids.length > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 mt-1 text-[10px] text-slate-400 dark:text-neutral-500 cursor-pointer hover:text-slate-600 dark:hover:text-neutral-300"
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const names = profile.project_ids
                          .map((pid) => projectMap.get(pid)?.name)
                          .filter(Boolean) as string[];
                        if (names.length > 0) {
                          setProjectTooltip({ names, x: rect.left, y: rect.bottom + 4 });
                        }
                      }}
                      onMouseLeave={() => setProjectTooltip(null)}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      {profile.project_ids.length} project{profile.project_ids.length !== 1 ? "s" : ""}
                    </span>
                  )}

                  {profile.connection_status === "queued" && profile.connection_scheduled_at && (
                    <div className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                      Scheduled:{" "}
                      {new Date(profile.connection_scheduled_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {projectTooltip && (
        <div
          className="fixed z-50 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl py-2 text-sm"
          style={{ top: `${projectTooltip.y}px`, left: `${projectTooltip.x}px` }}
          onMouseEnter={() => setProjectTooltip(projectTooltip)}
          onMouseLeave={() => setProjectTooltip(null)}
        >
          <div className="px-3 pb-1.5 text-[10px] font-semibold text-slate-400 dark:text-neutral-500 uppercase tracking-wide">Projects</div>
          {projectTooltip.names.map((name, i) => {
            const colorClass = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return (
              <div key={name} className="flex items-center gap-2 px-3 py-1">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorClass.split(" ")[0]}`} />
                <span className="text-sm text-slate-700 dark:text-neutral-300">{name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
