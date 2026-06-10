"use client";

import { useState, useRef, useEffect } from "react";
import type { SSELog } from "@/lib/types";

interface ActivityLogProps {
  logs: SSELog[];
}

export default function ActivityLog({ logs }: ActivityLogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isOpen]);

  if (logs.length === 0) return null;

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg border border-slate-200 dark:border-neutral-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-3 flex items-center justify-between text-sm font-medium text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
      >
        <span>Activity Log ({logs.length} entries)</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-slate-200 dark:border-neutral-700 max-h-64 overflow-y-auto">
          <div className="px-6 py-3 space-y-1 font-mono text-xs">
            {logs.map((log, i) => {
              const time = new Date(log.timestamp).toLocaleTimeString();
              const levelColor =
                log.level === "ERROR" ? "text-red-600 dark:text-red-400" :
                log.level === "WARNING" ? "text-amber-600 dark:text-amber-400" :
                "text-slate-500 dark:text-neutral-500";
              return (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-400 dark:text-neutral-500 shrink-0">{time}</span>
                  <span className={`shrink-0 ${levelColor}`}>[{log.level}]</span>
                  <span className="text-slate-700 dark:text-neutral-300">{log.message}</span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
