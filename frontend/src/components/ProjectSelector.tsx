"use client";

import { useState, useRef, useEffect } from "react";
import type { Project } from "@/lib/types";
import { createProject, updateProject, deleteProject } from "@/lib/api";
import { showToast } from "./Toast";

interface ProjectSelectorProps {
  projects: Project[];
  activeProjectId: number | null;
  onSelect: (projectId: number | null) => void;
  onProjectsChange: () => void;
}

export default function ProjectSelector({
  projects,
  activeProjectId,
  onSelect,
  onProjectsChange,
}: ProjectSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const isDefaultProject = activeProject?.name === "LinkedIn Network";

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setFormLoading(true);
    try {
      const proj = await createProject(formName.trim(), formDesc.trim());
      onProjectsChange();
      onSelect(proj.id);
      setShowCreateForm(false);
      setFormName("");
      setFormDesc("");
      showToast(`Project "${proj.name}" created`);
    } catch {
      showToast("Failed to create project");
    }
    setFormLoading(false);
  };

  const handleEdit = async () => {
    if (!formName.trim() || !activeProjectId) return;
    setFormLoading(true);
    try {
      await updateProject(activeProjectId, { name: formName.trim(), description: formDesc.trim() });
      onProjectsChange();
      setShowEditForm(false);
      showToast("Project updated");
    } catch {
      showToast("Failed to update project");
    }
    setFormLoading(false);
  };

  const handleDelete = async () => {
    if (!activeProjectId) return;
    setFormLoading(true);
    try {
      await deleteProject(activeProjectId);
      onProjectsChange();
      const remaining = projects.filter((p) => p.id !== activeProjectId);
      onSelect(remaining.length > 0 ? remaining[0].id : null);
      setShowDeleteConfirm(false);
      showToast("Project deleted");
    } catch {
      showToast("Failed to delete project");
    }
    setFormLoading(false);
  };

  const openEdit = () => {
    if (!activeProject) return;
    setFormName(activeProject.name);
    setFormDesc(activeProject.description);
    setShowEditForm(true);
    setDropdownOpen(false);
  };

  const openCreate = () => {
    setFormName("");
    setFormDesc("");
    setShowCreateForm(true);
    setDropdownOpen(false);
  };

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 px-3 py-1.5 border border-slate-300 dark:border-neutral-600 rounded-md text-sm text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
        >
          <svg className="w-4 h-4 text-slate-500 dark:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="max-w-[180px] truncate font-medium">
            {activeProject ? activeProject.name : "All Projects"}
          </span>
          <svg className={`w-3 h-3 text-slate-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-lg shadow-xl z-50 overflow-hidden">
            <button
              onClick={() => { onSelect(null); setDropdownOpen(false); }}
              className={`flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors ${
                activeProjectId === null ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-neutral-300"
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span className="font-medium">All Projects</span>
            </button>

            <div className="border-t border-slate-100 dark:border-neutral-700" />

            <div className="max-h-48 overflow-y-auto">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => { onSelect(proj.id); setDropdownOpen(false); }}
                  className={`flex items-center justify-between w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors ${
                    activeProjectId === proj.id ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="truncate font-medium">{proj.name}</span>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-neutral-500 ml-2 shrink-0">
                    {proj.profile_count}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-slate-100 dark:border-neutral-700" />

            <button
              onClick={openCreate}
              className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">New Project</span>
            </button>

            {activeProject && (
              <>
                <div className="border-t border-slate-100 dark:border-neutral-700" />
                <div className="flex">
                  <button
                    onClick={openEdit}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-slate-600 dark:text-neutral-400 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  {!isDefaultProject && (
                    <>
                      <div className="w-px bg-slate-100 dark:bg-neutral-700" />
                      <button
                        onClick={() => { setShowDeleteConfirm(true); setDropdownOpen(false); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">New Project</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Find Pre-seed VC"
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Description <span className="text-slate-400 dark:text-neutral-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Brief description of this project..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formName.trim() || formLoading}
                className="px-4 py-2 text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 transition-colors"
              >
                {formLoading ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Edit Project</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => { if (!isDefaultProject) setFormName(e.target.value); }}
                  disabled={isDefaultProject}
                  autoFocus={!isDefaultProject}
                  className={`w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${isDefaultProject ? "opacity-60 cursor-not-allowed" : ""}`}
                  onKeyDown={(e) => { if (e.key === "Enter") handleEdit(); }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Description <span className="text-slate-400 dark:text-neutral-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowEditForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={!formName.trim() || formLoading}
                className="px-4 py-2 text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 transition-colors"
              >
                {formLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && activeProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Delete Project</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
              Are you sure you want to delete <strong>&quot;{activeProject.name}&quot;</strong>?
              Profiles that only belong to this project will also be deleted.
              Profiles shared with other projects will be kept.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={formLoading}
                className="px-4 py-2 text-sm font-medium bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700 rounded-md hover:bg-red-200 dark:hover:bg-red-900/60 disabled:opacity-50 transition-colors"
              >
                {formLoading ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
