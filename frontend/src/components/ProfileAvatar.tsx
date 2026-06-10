"use client";

import { useState } from "react";

interface ProfileAvatarProps {
  name: string;
  thumbnailUrl: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0]?.[0] || "?").toUpperCase();
}

const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function ProfileAvatar({ name, thumbnailUrl }: ProfileAvatarProps) {
  const [imgError, setImgError] = useState(false);

  if (thumbnailUrl && !imgError) {
    return (
      <img
        src={thumbnailUrl}
        alt={name}
        onError={() => setImgError(true)}
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      />
    );
  }

  const initials = getInitials(name);
  const color = getColor(name);

  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold ${color}`}
    >
      {initials}
    </div>
  );
}
