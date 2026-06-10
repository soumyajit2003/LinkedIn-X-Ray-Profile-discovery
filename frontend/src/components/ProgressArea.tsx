"use client";

import type { SSEProgress, SSEKeywordDone, SSEError } from "@/lib/types";

interface ProgressAreaProps {
  isSearching: boolean;
  progress: Map<string, SSEProgress>;
  completedKeywords: SSEKeywordDone[];
  errors: SSEError[];
}

export default function ProgressArea({ isSearching, progress, completedKeywords, errors }: ProgressAreaProps) {
  if (!isSearching && completedKeywords.length === 0 && errors.length === 0) {
    return null;
  }

  const completedSet = new Set(completedKeywords.map((k) => k.keyword));

  return (
    <div className="mt-4 space-y-2">
      {completedKeywords.map((kw, i) => (
        <div key={`done-${i}`} className="flex items-center gap-2 text-sm text-green-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>{kw.keyword} — {kw.total_profiles} profiles found</span>
        </div>
      ))}

      {Array.from(progress.entries()).map(([keyword, p]) =>
        !completedSet.has(keyword) ? (
          <div key={`prog-${keyword}`} className="flex items-center gap-2 text-sm text-slate-600">
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>{keyword} — page {p.current_page}/{p.total_pages} ({p.profiles_found} profiles)</span>
          </div>
        ) : null
      )}

      {errors.map((err, i) => (
        <div key={`err-${i}`} className="flex items-center gap-2 text-sm text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
          <span>{err.message}</span>
        </div>
      ))}
    </div>
  );
}
