"use client";

import { useState, useRef, useEffect } from "react";
import type { Profile } from "@/lib/types";
import { updateConnectionStatus } from "@/lib/api";
import { showToast } from "./Toast";

interface ConnectionButtonProps {
  profile: Profile;
  onStatusChange: (profileId: number, status: string, scheduledAt: string | null) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  none: {
    label: "Connect",
    className: "border border-slate-300 dark:border-neutral-500 text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700",
  },
  queued: {
    label: "Queued",
    className: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700",
  },
  sent: {
    label: "Sent",
    className: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700",
  },
  connected: {
    label: "Connected",
    className: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700",
  },
};

type DropdownOption = {
  label: string;
  action: "queued" | "connected" | "none";
};

function getDropdownOptions(status: string): DropdownOption[] {
  switch (status) {
    case "none":
      return [
        { label: "Send Connection", action: "queued" },
        { label: "Already Connected", action: "connected" },
      ];
    case "queued":
      return [{ label: "Cancel", action: "none" }];
    case "sent":
      return [
        { label: "Mark Connected", action: "connected" },
        { label: "Reset", action: "none" },
      ];
    case "connected":
      return [{ label: "Reset", action: "none" }];
    case "failed":
      return [
        { label: "Retry", action: "queued" },
        { label: "Already Connected", action: "connected" },
      ];
    default:
      return [];
  }
}

function formatScheduledTime(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConnectionButton({ profile, onStatusChange }: ConnectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const config = STATUS_CONFIG[profile.connection_status] || STATUS_CONFIG.none;
  const options = getDropdownOptions(profile.connection_status);

  const displayLabel =
    profile.connection_status === "queued" && profile.connection_scheduled_at
      ? `Queued - ${formatScheduledTime(profile.connection_scheduled_at)}`
      : config.label;

  const handleAction = async (action: "queued" | "connected" | "none") => {
    setLoading(true);
    setOpen(false);
    try {
      const resp = await updateConnectionStatus(profile.id, action);
      onStatusChange(profile.id, resp.connection_status, resp.connection_scheduled_at);
      if (action === "queued" && resp.connection_scheduled_at) {
        const time = new Date(resp.connection_scheduled_at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        showToast(`${profile.name} queued — will send at ${time}`);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${config.className} ${loading ? "opacity-50" : ""}`}
      >
        {loading ? "..." : displayLabel}
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && options.length > 0 && (
        <div className="absolute right-0 bottom-full mb-1 w-44 bg-white dark:bg-neutral-700 border border-slate-200 dark:border-neutral-600 rounded-md shadow-lg z-50">
          {options.map((opt) => (
            <button
              key={opt.action + opt.label}
              onClick={() => handleAction(opt.action)}
              className="block w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-600 first:rounded-t-md last:rounded-b-md"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
