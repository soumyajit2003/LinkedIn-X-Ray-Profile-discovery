"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { Profile, Project } from "@/lib/types";
import { bulkQueueConnections, backfillImages, exportFiltered, deleteProfiles } from "@/lib/api";
import ConnectionButton from "./ConnectionButton";
import ProfileAvatar from "./ProfileAvatar";
import KanbanBoard from "./KanbanBoard";
import { showToast } from "./Toast";

interface ResultsTableProps {
  profiles: Profile[];
  total: number;
  loading: boolean;
  onProfileUpdate: (profileId: number, status: string, scheduledAt: string | null) => void;
  onRefresh: () => void;
  projects?: Project[];
  activeProjectId?: number | null;
}

type SortField = "name" | "updated_at";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "kanban";

const PROJECT_COLORS = [
  "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700",
  "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700",
  "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700",
  "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700",
  "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700",
  "bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-700",
];

export default function ResultsTable({ profiles, total, loading, onProfileUpdate, onRefresh, projects = [], activeProjectId }: ResultsTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("resultsViewMode") as ViewMode) || "table";
    }
    return "table";
  });
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationDropdownRef = useRef<HTMLDivElement>(null);
  const [nameSearch, setNameSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [bioTooltip, setBioTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [projectTooltip, setProjectTooltip] = useState<{ profileId: number; names: string[]; x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [refreshingPhotos, setRefreshingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState("");
  const [enrichDropdownOpen, setEnrichDropdownOpen] = useState(false);
  const [enrichConfirm, setEnrichConfirm] = useState<"extension" | "serper" | null>(null);
  const enrichDropdownRef = useRef<HTMLDivElement>(null);

  const projectMap = useMemo(() => {
    const map = new Map<number, { name: string; colorIdx: number }>();
    projects.forEach((p, i) => map.set(p.id, { name: p.name, colorIdx: i % PROJECT_COLORS.length }));
    return map;
  }, [projects]);

  const [colWidths, setColWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("resultTableColWidths");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [40, 200, 160, 250, 140, 130];
  });
  const resizingCol = useRef<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);


  const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colIndex;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = colWidths[colIndex];
  }, [colWidths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (resizingCol.current === null) return;
      const diff = e.clientX - resizeStartX.current;
      const newWidth = Math.max(60, resizeStartWidth.current + diff);
      setColWidths((prev) => {
        const next = [...prev];
        next[resizingCol.current!] = newWidth;
        return next;
      });
    };
    const handleMouseUp = () => {
      if (resizingCol.current !== null) {
        resizingCol.current = null;
        setColWidths((current) => {
          localStorage.setItem("resultTableColWidths", JSON.stringify(current));
          return current;
        });
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
      if (enrichDropdownRef.current && !enrichDropdownRef.current.contains(e.target as Node)) {
        setEnrichDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const allKeywords = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => p.matched_keywords.forEach((k) => set.add(k)));
    return Array.from(set).sort();
  }, [profiles]);

  const allLocations = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => {
      if (p.location) {
        p.location.split(",").forEach((loc) => {
          const trimmed = loc.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    });
    return Array.from(set).sort();
  }, [profiles]);

  const filtered = useMemo(() => {
    let result = profiles;
    if (nameSearch) {
      const q = nameSearch.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (keywordFilter) {
      result = result.filter((p) => p.matched_keywords.includes(keywordFilter));
    }
    if (statusFilter) {
      result = result.filter((p) => p.connection_status === statusFilter);
    }
    if (locationFilter.length > 0) {
      result = result.filter((p) => {
        if (!p.location) return false;
        const profileLocs = p.location.split(",").map((l) => l.trim().toLowerCase());
        return locationFilter.some((f) => profileLocs.includes(f.toLowerCase()));
      });
    }
    result = [...result].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [profiles, nameSearch, keywordFilter, statusFilter, locationFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, currentPage, perPage]);


  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === paginated.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paginated.map((p) => p.id)));
    }
  };

  const queueableSelected = useMemo(() => {
    return filtered.filter(
      (p) => selected.has(p.id) && (p.connection_status === "none" || p.connection_status === "failed")
    );
  }, [filtered, selected]);

  const missingInfoCount = useMemo(() => {
    return profiles.filter((p) => !p.thumbnail_url && !p.snippet).length;
  }, [profiles]);

  const needsEnrichmentCount = missingInfoCount;

  const handleEnrichViaSerper = async () => {
    setEnrichConfirm(null);
    setRefreshingPhotos(true);
    setPhotoProgress("Starting...");
    try {
      const result = await backfillImages((fetched, total) => {
        setPhotoProgress(`${fetched}/${total}`);
      }, activeProjectId);
      showToast(`Updated ${result.fetched} profiles`);
      onRefresh();
    } catch {
      showToast("Failed to refresh");
    }
    setRefreshingPhotos(false);
    setPhotoProgress("");
  };

  const handleEnrichViaExtension = () => {
    setEnrichConfirm(null);
    const needsEnrichment = profiles.filter((p) => !p.followers);
    if (needsEnrichment.length === 0) {
      showToast("All profiles already enriched");
      return;
    }
    for (const p of needsEnrichment) {
      window.postMessage({
        type: "ENRICH_PROFILE",
        profileId: p.id,
        profileUrl: p.profile_url,
      }, "*");
    }
    showToast(`Queued ${needsEnrichment.length} profiles for enrichment`);
  };

  const handleBulkQueue = async () => {
    if (queueableSelected.length === 0) return;
    setBulkLoading(true);
    try {
      const resp = await bulkQueueConnections(queueableSelected.map((p) => p.id));
      for (const item of resp.queued) {
        onProfileUpdate(item.profile_id, item.connection_status, item.connection_scheduled_at);
      }
      setSelected(new Set());
      if (resp.queued.length > 0) {
        showToast(`${resp.queued.length} connection${resp.queued.length > 1 ? "s" : ""} queued`);
      }
    } catch {
      // silently fail
    }
    setBulkLoading(false);
  };

  const handleDeleteProfiles = async () => {
    if (selected.size === 0) return;
    setDeleteLoading(true);
    try {
      const ids = Array.from(selected);
      const resp = await deleteProfiles(ids);
      setSelected(new Set());
      setShowDeleteConfirm(false);
      showToast(`${resp.deleted} profile${resp.deleted > 1 ? "s" : ""} deleted`);
      onRefresh();
    } catch {
      showToast("Failed to delete profiles");
    }
    setDeleteLoading(false);
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg border border-slate-200 dark:border-neutral-700">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-neutral-700 flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100 uppercase tracking-wide whitespace-nowrap">
          Results
          <span className="ml-1.5 text-slate-500 dark:text-neutral-400 font-normal normal-case">({filtered.length} of {total} profiles)</span>
        </h2>

        {total > 0 && (
          <div className="flex items-center bg-slate-100 dark:bg-neutral-700 rounded-md p-0.5">
            <button
              onClick={() => { setViewMode("table"); localStorage.setItem("resultsViewMode", "table"); }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "table"
                  ? "bg-white dark:bg-neutral-600 text-slate-900 dark:text-neutral-100 shadow-sm"
                  : "text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200"
              }`}
              title="Table view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <button
              onClick={() => { setViewMode("kanban"); localStorage.setItem("resultsViewMode", "kanban"); }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "kanban"
                  ? "bg-white dark:bg-neutral-600 text-slate-900 dark:text-neutral-100 shadow-sm"
                  : "text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200"
              }`}
              title="Kanban view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </button>
          </div>
        )}

        {allKeywords.length > 0 && (
          <select
            value={keywordFilter}
            onChange={(e) => { setKeywordFilter(e.target.value); setCurrentPage(1); }}
            className="custom-select text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="">All keywords</option>
            {allKeywords.map((kw) => (
              <option key={kw} value={kw}>{kw}</option>
            ))}
          </select>
        )}

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
          className="custom-select text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">All statuses</option>
          <option value="none">Not connected</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="connected">Connected</option>
          <option value="failed">Failed</option>
        </select>

        {allLocations.length > 0 && (
          <div className="relative" ref={locationDropdownRef}>
            <button
              onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
              className="flex items-center gap-1.5 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-50 dark:hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
            >
              <span>{locationFilter.length === 0 ? "Location" : `${locationFilter.length} selected`}</span>
              <svg className={`w-3 h-3 text-slate-400 transition-transform ${locationDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {locationDropdownOpen && (
              <div className="absolute z-20 mt-1 w-56 max-h-60 overflow-y-auto bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-md shadow-lg">
                {locationFilter.length > 0 && (
                  <button
                    onClick={() => { setLocationFilter([]); setCurrentPage(1); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-neutral-700"
                  >
                    Clear all
                  </button>
                )}
                {allLocations.map((loc) => (
                  <label
                    key={loc}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-neutral-700 cursor-pointer text-sm text-slate-700 dark:text-neutral-300"
                  >
                    <input
                      type="checkbox"
                      checked={locationFilter.includes(loc)}
                      onChange={() => {
                        setLocationFilter((prev) =>
                          prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
                        );
                        setCurrentPage(1);
                      }}
                      className="rounded border-slate-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
                    />
                    {loc}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {total > 0 && (
          <>
            {activeProjectId && projects.find((p) => p.id === activeProjectId && p.name === "LinkedIn Network") && (
              <div className="relative" ref={enrichDropdownRef}>
                <button
                  onClick={() => setEnrichDropdownOpen(!enrichDropdownOpen)}
                  disabled={refreshingPhotos}
                  className="px-3 py-1.5 border border-slate-300 dark:border-neutral-600 text-slate-700 dark:text-neutral-300 text-sm font-medium rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {refreshingPhotos ? `Enriching ${photoProgress}` : "Enrich Profiles"}
                  <svg className={`w-3 h-3 transition-transform ${enrichDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {enrichDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-lg shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => { setEnrichDropdownOpen(false); setEnrichConfirm("extension"); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                    >
                      <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">Via LinkedIn Extension</div>
                      <div className="text-xs text-slate-400 dark:text-neutral-500 mt-0.5">Free — slower, {needsEnrichmentCount} profiles</div>
                    </button>
                    <div className="border-t border-slate-100 dark:border-neutral-700" />
                    <button
                      onClick={() => { setEnrichDropdownOpen(false); setEnrichConfirm("serper"); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                    >
                      <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">Via Serper API</div>
                      <div className="text-xs text-slate-400 dark:text-neutral-500 mt-0.5">Fast — uses {missingInfoCount} API credits</div>
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={async () => {
                try {
                  const parts = ["linkedin_profiles"];
                  if (keywordFilter) parts.push(keywordFilter.replace(/\s+/g, "_"));
                  if (statusFilter) parts.push(statusFilter);
                  if (locationFilter.length > 0) parts.push(locationFilter.map((l) => l.replace(/\s+/g, "_")).join("+"));
                  if (nameSearch) parts.push(nameSearch.replace(/\s+/g, "_"));
                  const filename = parts.join("_") + ".xlsx";
                  await exportFiltered(filtered.map((p) => p.id), filename);
                } catch {
                  showToast("Export failed");
                }
              }}
              className="px-3 py-1.5 bg-slate-800 dark:bg-neutral-600 text-white text-sm font-medium rounded-md hover:bg-slate-700 dark:hover:bg-neutral-500 transition-colors"
            >
              Export
            </button>
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => { setNameSearch(e.target.value); setCurrentPage(1); }}
              placeholder="Search by name..."
              className="w-40 px-3 py-1.5 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/40 placeholder:text-slate-400 dark:placeholder:text-neutral-500"
            />
          </>
        )}
      </div>

      {loading ? (
        <div className="px-6 py-12 text-center text-slate-500 dark:text-neutral-400 text-sm">Loading results...</div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-slate-500 dark:text-neutral-400 text-sm">
          {total === 0 ? "No profiles yet. Run a search to get started." : "No profiles match the selected filter."}
        </div>
      ) : viewMode === "kanban" ? (
        <KanbanBoard profiles={filtered} onProfileUpdate={onProfileUpdate} projects={projects} />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ tableLayout: "fixed", width: colWidths.reduce((a, b) => a + b, 0) }}>
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-750 dark:bg-neutral-800/50">
                <th className="px-4 py-3 relative">
                  <input
                    type="checkbox"
                    checked={selected.size === paginated.length && paginated.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 0)} />
                </th>
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 dark:text-neutral-400 cursor-pointer hover:text-slate-900 dark:hover:text-neutral-200 select-none relative"
                  onClick={() => toggleSort("name")}
                >
                  Name{sortIcon("name")}
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 1)} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-neutral-400 relative">
                  Profile Link
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 2)} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-neutral-400 relative">
                  Bio Snippet
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 3)} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-neutral-400 relative">
                  Keywords
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 4)} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-neutral-400 relative">
                  Status
                  <div className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400" onMouseDown={(e) => handleResizeStart(e, 5)} />
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100 dark:border-neutral-700 hover:bg-slate-50/50 dark:hover:bg-neutral-700/30">
                  <td className="px-4 py-1.5 overflow-hidden">
                    <input
                      type="checkbox"
                      checked={selected.has(profile.id)}
                      onChange={() => toggleSelect(profile.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-1.5 font-medium text-slate-900 dark:text-neutral-100 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <ProfileAvatar name={profile.name} thumbnailUrl={profile.thumbnail_url} />
                      <div className="min-w-0">
                        <span className="truncate block" title={profile.name}>{profile.name}</span>
                        <div className="flex items-center gap-1.5">
                          {profile.followers && (
                            <span className="text-xs text-slate-500 dark:text-neutral-400">{profile.followers} followers</span>
                          )}
                          {profile.project_ids && profile.project_ids.length > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 text-xs text-slate-400 dark:text-neutral-500 cursor-pointer hover:text-slate-600 dark:hover:text-neutral-300"
                              onMouseEnter={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const names = profile.project_ids
                                  .map((pid) => projectMap.get(pid)?.name)
                                  .filter(Boolean) as string[];
                                if (names.length > 0) {
                                  setProjectTooltip({ profileId: profile.id, names, x: rect.left, y: rect.bottom + 4 });
                                }
                              }}
                              onMouseLeave={() => setProjectTooltip(null)}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              {profile.project_ids.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-1.5 overflow-hidden">
                    <a
                      href={profile.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline truncate block"
                      title={profile.profile_url}
                    >
                      {profile.profile_url.replace("https://www.linkedin.com/in/", "").replace("https://linkedin.com/in/", "")}
                    </a>
                  </td>
                  <td
                    className="px-4 py-1.5 text-slate-600 dark:text-neutral-400 overflow-hidden"
                    onMouseEnter={(e) => {
                      if (profile.snippet) {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setBioTooltip({ text: profile.snippet, x: rect.left, y: rect.bottom + 4 });
                      }
                    }}
                    onMouseLeave={() => setBioTooltip(null)}
                  >
                    <span className="cursor-pointer block line-clamp-3 break-words">
                      {profile.snippet || "\u2014"}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 overflow-hidden">
                    <div className="flex flex-wrap gap-1">
                      {profile.matched_keywords.map((kw) => (
                        <span
                          key={kw}
                          className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded border border-slate-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-1.5 overflow-visible">
                    <ConnectionButton profile={profile} onStatusChange={onProfileUpdate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && viewMode === "table" && (
        <div className="px-6 py-3 border-t border-slate-200 dark:border-neutral-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-neutral-400">Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-neutral-400">
              {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, filtered.length)} of {filtered.length}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm border border-slate-300 dark:border-neutral-600 rounded-md text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-sm border border-slate-300 dark:border-neutral-600 rounded-md text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selected.size > 0 && viewMode === "table" && (
        <div className="sticky bottom-0 bg-white dark:bg-neutral-800 border-t border-slate-200 dark:border-neutral-700 px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-slate-600 dark:text-neutral-400">
            {selected.size} profile{selected.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
            >
              Delete {selected.size} profile{selected.size > 1 ? "s" : ""}
            </button>
            {queueableSelected.length > 0 && (
              <button
                onClick={handleBulkQueue}
                disabled={bulkLoading}
                className="px-4 py-2 bg-slate-800 dark:bg-neutral-600 text-white text-sm font-medium rounded-md hover:bg-slate-700 dark:hover:bg-neutral-500 disabled:opacity-50 transition-colors"
              >
                {bulkLoading ? "Queuing..." : `Send Connection to ${queueableSelected.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {bioTooltip && (
        <div
          className="fixed z-50 w-[350px] max-h-[300px] overflow-y-auto bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-4 text-sm text-slate-700 dark:text-neutral-300 whitespace-pre-wrap"
          style={{ top: `${bioTooltip.y}px`, left: `${bioTooltip.x}px` }}
          onMouseEnter={() => setBioTooltip(bioTooltip)}
          onMouseLeave={() => setBioTooltip(null)}
        >
          {bioTooltip.text}
        </div>
      )}

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

      {enrichConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              {enrichConfirm === "extension" ? "Enrich via LinkedIn" : "Enrich via Serper"}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
              {enrichConfirm === "extension"
                ? `This will open ${needsEnrichmentCount} LinkedIn profile tabs one by one (8s apart, max 50 per session). May take minutes to hours.`
                : `This will use ${missingInfoCount} Serper API credits to fetch photos, bio, and location.`}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setEnrichConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={enrichConfirm === "extension" ? handleEnrichViaExtension : handleEnrichViaSerper}
                className="px-4 py-2 text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
              >
                {enrichConfirm === "extension" ? "Start Enrichment" : "Use Credits"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Delete Profiles</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
              Are you sure you want to delete {selected.size} profile{selected.size > 1 ? "s" : ""}? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProfiles}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteLoading ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
