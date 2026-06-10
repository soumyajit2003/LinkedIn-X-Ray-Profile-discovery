"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import SearchPanel from "@/components/SearchPanel";
import StatsCards from "@/components/StatsCards";
import ResultsTable from "@/components/ResultsTable";
import ActivityLog from "@/components/ActivityLog";
import Toast, { showToast } from "@/components/Toast";
import ChatPanel from "@/components/ChatPanel";
import ProjectSelector from "@/components/ProjectSelector";
import { useSSESearch } from "@/hooks/useSSESearch";
import { getResults, getProjects, updateProject, createProject, populateFromSlugs } from "@/lib/api";
import type { Profile, Project } from "@/lib/types";

function CreateProjectInline({ onCreated }: { onCreated: (proj: Project) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const proj = await createProject(name.trim(), desc.trim());
      onCreated(proj);
    } catch {
      // silently fail
    }
    setLoading(false);
  };

  return (
    <div className="text-left space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
          Project Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Find Pre-seed VC"
          autoFocus
          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
          Description <span className="text-slate-400 dark:text-neutral-500 font-normal">(optional)</span>
        </label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Brief description..."
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || loading}
        className="w-full px-4 py-2 text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 transition-colors"
      >
        {loading ? "Creating..." : "Create Project"}
      </button>
    </div>
  );
}

function SyncOverlay({ onDone }: { onDone: (movedToSent: number, movedToConnected: number, promotedToConnected: number) => void }) {
  const [status, setStatus] = useState("Syncing sent");
  const [progress, setProgress] = useState("");
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (countdown <= 0) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [countdown > 0]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "POST_SCAN_SYNC_DONE") {
        onDone(event.data.movedToSent || 0, event.data.movedToConnected || 0, event.data.promotedToConnected || 0);
      }
      if (event.data?.type === "SYNC_PROGRESS") {
        const { source, scraped, batch, waiting } = event.data;
        if (source === "sent") {
          setStatus("Sent done");
          setProgress(scraped > 0 ? `+${scraped} new` : "No new profiles");
        } else if (source === "connections") {
          if (batch === 0) {
            setStatus("Syncing connections");
            setProgress("");
          } else if (waiting) {
            setStatus(`Batch ${batch} saved`);
            setProgress(`${scraped} profiles`);
            setCountdown(waiting);
          } else {
            setStatus(`Batch ${batch}`);
            setProgress(`${scraped} profiles saved`);
            setCountdown(0);
          }
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-2xl px-8 py-6 max-w-xs w-full mx-4 text-center">
        <svg className="w-8 h-8 mx-auto text-blue-500 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-sm font-medium text-slate-800 dark:text-neutral-200">{status}</p>
        {progress && (
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">{progress}</p>
        )}
        {countdown > 0 && (
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-1 tabular-nums">Wait {countdown}s</p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingResults, setLoadingResults] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);

  const [projects, setProjectsList] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [showForceCreate, setShowForceCreate] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const searchState = useSSESearch();

  const fetchProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjectsList(data.projects);
      return data.projects;
    } catch {
      return [];
    }
  }, []);

  // Initial load: fetch projects, then select active
  useEffect(() => {
    fetchProjects().then((projs) => {
      if (projs.length === 0) {
        setShowForceCreate(true);
        setProjectsLoaded(true);
        return;
      }
      const savedId = localStorage.getItem("activeProjectId");
      if (savedId && projs.some((p: Project) => p.id === Number(savedId))) {
        setActiveProjectId(Number(savedId));
      } else {
        setActiveProjectId(projs[0].id);
      }
      setProjectsLoaded(true);
    });
  }, [fetchProjects]);

  // Load keywords from project when active project changes
  useEffect(() => {
    if (!projectsLoaded) return;
    const proj = projects.find((p) => p.id === activeProjectId);
    if (proj) {
      setKeywords(proj.keywords || []);
    } else {
      setKeywords([]);
    }
  }, [activeProjectId, projectsLoaded, projects]);

  // Save keywords to project when they change
  const handleKeywordsChange = useCallback((newKeywords: string[]) => {
    setKeywords(newKeywords);
    if (activeProjectId) {
      updateProject(activeProjectId, { keywords: newKeywords }).catch(() => {});
    }
  }, [activeProjectId]);

  const handleSelectProject = useCallback((id: number | null) => {
    setActiveProjectId(id);
    if (id) {
      localStorage.setItem("activeProjectId", String(id));
    } else {
      localStorage.removeItem("activeProjectId");
    }
  }, []);

  const handleProjectsChange = useCallback(() => {
    fetchProjects().then((projs) => {
      if (projs.length > 0 && showForceCreate) {
        setShowForceCreate(false);
        setActiveProjectId(projs[projs.length - 1].id);
        localStorage.setItem("activeProjectId", String(projs[projs.length - 1].id));
      }
    });
  }, [fetchProjects, showForceCreate]);

  const fetchResults = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingResults(true);
    try {
      const data = await getResults(5000, 0, activeProjectId);
      setProfiles(data.profiles);
      setTotal(data.total);
    } catch {
      // silently fail
    }
    if (showLoading) setLoadingResults(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (projectsLoaded) {
      fetchResults();
    }
  }, [fetchResults, projectsLoaded]);

  const handleSyncDone = useCallback(async (movedToSent: number, movedToConnected: number, promotedToConnected: number) => {
    setSyncing(false);
    await populateFromSlugs().catch(() => {});
    fetchResults();
    if (promotedToConnected > 0) {
      showToast(`${promotedToConnected} profile${promotedToConnected > 1 ? "s" : ""} promoted to Connected (accepted your invite)`);
    }
    if (movedToSent > 0 || movedToConnected > 0) {
      console.log(`[Sync] Moved ${movedToSent} to Sent, ${movedToConnected} to Connected`);
    }
  }, [fetchResults]);

  useEffect(() => {
    if (searchState.result) {
      fetchResults().then(() => {
        fetchProjects();
        setSyncing(true);
        window.postMessage({ type: "TRIGGER_POST_SCAN_SYNC" }, "*");
      });
    }
  }, [searchState.result, fetchResults, fetchProjects]);

  useEffect(() => {
    const hasQueued = profiles.some((p) => p.connection_status === "queued");
    if (!hasQueued) return;

    window.postMessage({ type: "START_POLLING" }, "*");

    const interval = setInterval(() => {
      fetchResults(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [profiles, fetchResults]);

  const handleSearch = (kws: string[], maxPages: number, locations: string[] = []) => {
    searchState.startSearch(kws, maxPages, locations, activeProjectId);
  };

  const handleAddKeywords = (newKeywords: string[]) => {
    setKeywords((prev) => {
      const combined = [...prev];
      for (const kw of newKeywords) {
        if (!combined.some((existing) => existing.toLowerCase() === kw.toLowerCase())) {
          combined.push(kw);
        }
      }
      if (activeProjectId) {
        updateProject(activeProjectId, { keywords: combined }).catch(() => {});
      }
      return combined;
    });
  };

  const handleProfileUpdate = useCallback(
    (profileId: number, status: string, scheduledAt: string | null) => {
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                connection_status: status as Profile["connection_status"],
                connection_scheduled_at: scheduledAt,
              }
            : p
        )
      );
    },
    []
  );

  useEffect(() => {
    if (!syncing) return;
    const timeout = setTimeout(() => {
      setSyncing(false);
      fetchResults();
    }, 600000);
    return () => clearTimeout(timeout);
  }, [syncing, fetchResults]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
      {syncing && <SyncOverlay onDone={handleSyncDone} />}
      <Header
        onQuotaRefresh={fetchResults}
        projectSelector={
          <ProjectSelector
            projects={projects}
            activeProjectId={activeProjectId}
            onSelect={handleSelectProject}
            onProjectsChange={handleProjectsChange}
          />
        }
      />
      <Toast />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {showForceCreate ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-sm">
              <svg className="w-16 h-16 mx-auto text-slate-300 dark:text-neutral-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100 mb-1">Create your first project</h2>
              <p className="text-sm text-slate-500 dark:text-neutral-400 mb-6">
                Projects organize your LinkedIn searches. Create one to get started with scanning and connecting.
              </p>
              <CreateProjectInline
                onCreated={(proj) => {
                  handleProjectsChange();
                  handleSelectProject(proj.id);
                  setShowForceCreate(false);
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <StatsCards profiles={profiles} total={total} />
            {!(activeProjectId && projects.find((p) => p.id === activeProjectId && p.name === "LinkedIn Network")) && (
              <SearchPanel
                searchState={searchState}
                keywords={keywords}
                onKeywordsChange={handleKeywordsChange}
                onSearch={handleSearch}
                onCancel={searchState.cancelSearch}
                disabled={!activeProjectId}
              />
            )}
            <ResultsTable
              profiles={profiles}
              total={total}
              loading={loadingResults}
              onProfileUpdate={handleProfileUpdate}
              onRefresh={() => fetchResults()}
              projects={projects}
              activeProjectId={activeProjectId}
            />
            <ActivityLog logs={searchState.logs} />
          </>
        )}
      </main>

      {!showForceCreate && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
          title="AI Chat"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}

      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onConnectionQueued={() => fetchResults(false)}
        onAddKeywords={handleAddKeywords}
        onStartScan={(kws, maxPages) => {
          handleAddKeywords(kws);
          searchState.startSearch(kws, maxPages);
        }}
      />
    </div>
  );
}
