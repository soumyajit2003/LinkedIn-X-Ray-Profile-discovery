"use client";

import { useMemo } from "react";
import type { Profile } from "@/lib/types";

interface StatsCardsProps {
  profiles: Profile[];
  total: number;
}

export default function StatsCards({ profiles, total }: StatsCardsProps) {
  const stats = useMemo(() => {
    const connected = profiles.filter((p) => p.connection_status === "connected").length;
    const sent = profiles.filter((p) => p.connection_status === "sent").length;
    const queued = profiles.filter((p) => p.connection_status === "queued").length;
    const failed = profiles.filter((p) => p.connection_status === "failed").length;
    const totalAttempted = sent + connected + failed;
    const successRate = totalAttempted > 0 ? Math.round(((sent + connected) / totalAttempted) * 100) : 0;

    return { connected, sent, queued, successRate };
  }, [profiles]);

  const cards = [
    { label: "Total Profiles", value: total },
    { label: "Connected", value: stats.connected },
    { label: "Pending Queue", value: stats.queued },
    { label: "Success Rate", value: `${stats.successRate}%` },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg px-5 py-4"
        >
          <p className="text-sm text-slate-500 dark:text-neutral-400">{card.label}</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-neutral-100 mt-1">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
