"use client";

import { useState, useEffect, type ReactNode } from "react";
import type { Quota, ConnectionUsage } from "@/lib/types";
import { getQuota, getConnectionUsage } from "@/lib/api";
import SettingsPanel from "./SettingsPanel";

interface HeaderProps {
  onQuotaRefresh?: () => void;
  projectSelector?: ReactNode;
}

export default function Header({ onQuotaRefresh, projectSelector }: HeaderProps) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [connUsage, setConnUsage] = useState<ConnectionUsage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const [themeAnimating, setThemeAnimating] = useState(false);

  const toggleDark = () => {
    setThemeAnimating(true);
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", next ? "dark" : "light");
    setTimeout(() => setThemeAnimating(false), 500);
  };

  const fetchQuota = async () => {
    try {
      const q = await getQuota();
      setQuota(q);
    } catch {
      // silently fail
    }
  };

  const fetchConnUsage = async () => {
    try {
      const u = await getConnectionUsage();
      setConnUsage(u);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchQuota();
    fetchConnUsage();
  }, []);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    fetchQuota();
    fetchConnUsage();
  };

  return (
    <>
      <header className="bg-white dark:bg-neutral-800 border-b border-slate-200 dark:border-neutral-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">LinkedIn Profile Discovery</h1>
            {projectSelector}
          </div>
          <div className="flex items-center gap-4">
            {quota && (
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                (quota.limit - quota.used) <= 0
                  ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : (quota.limit - quota.used) <= quota.limit * 0.2
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-slate-100 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300"
              }`}>
                {quota.limit - quota.used} credits left
              </span>
            )}
            {connUsage && (
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                connUsage.used >= connUsage.limit
                  ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : connUsage.used >= connUsage.limit * 0.8
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-slate-100 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300"
              }`}>
                {connUsage.used}/{connUsage.limit} connections
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button
              onClick={toggleDark}
              className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors overflow-hidden"
              title={dark ? "Light mode" : "Dark mode"}
            >
              <div className="relative w-5 h-5">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute inset-0 transition-all duration-500 ease-in-out ${
                    dark
                      ? "opacity-100 rotate-0 scale-100"
                      : "opacity-0 -rotate-90 scale-50"
                  }`}
                >
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                </svg>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute inset-0 transition-all duration-500 ease-in-out ${
                    dark
                      ? "opacity-0 rotate-90 scale-50"
                      : "opacity-100 rotate-0 scale-100"
                  }`}
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </div>
            </button>
          </div>
        </div>
      </header>
      <SettingsPanel isOpen={settingsOpen} onClose={handleSettingsClose} />
    </>
  );
}
