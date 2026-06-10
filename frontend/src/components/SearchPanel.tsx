"use client";

import { useState, useEffect, useRef } from "react";
import { MAX_PAGES_DEFAULT, MAX_PAGES_LIMIT } from "@/lib/constants";
import KeywordChips from "./KeywordChips";
import ProgressArea from "./ProgressArea";
import type { SearchState } from "@/hooks/useSSESearch";

interface SearchPanelProps {
  searchState: SearchState;
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  onSearch: (keywords: string[], maxPages: number, locations: string[]) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const COUNTRIES = [
  "United States", "India", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Netherlands", "Singapore", "UAE",
  "Israel", "Brazil", "Japan", "South Korea", "China",
  "Sweden", "Switzerland", "Ireland", "Spain", "Italy",
];

export default function SearchPanel({ searchState, keywords, onKeywordsChange, onSearch, onCancel, disabled }: SearchPanelProps) {
  const [maxPages, setMaxPages] = useState(MAX_PAGES_DEFAULT);
  const [showConfirm, setShowConfirm] = useState(false);
  const [locations, setLocations] = useState<string[]>([]);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);

  const locationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleLocation = (country: string) => {
    setLocations((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    );
  };

  const handleScan = () => {
    if (keywords.length === 0) return;
    setShowConfirm(false);
    onSearch(keywords, maxPages, locations);
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg border border-slate-200 dark:border-neutral-700 p-6">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100 uppercase tracking-wide mb-4">Search Keywords</h2>

      <div className="flex gap-3 items-start">
        {/* Keywords — 70% */}
        <div className="min-w-0" style={{ flex: "0 0 70%" }}>
          <KeywordChips keywords={keywords} onChange={onKeywordsChange} disabled={searchState.isSearching} />
        </div>

        {/* Location — 20% */}
        <div className="relative min-w-0" style={{ flex: "0 0 20%" }} ref={locationRef}>
          <button
            onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
            disabled={searchState.isSearching}
            className="flex items-center gap-2 w-full px-3 h-[48px] border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-700 hover:bg-slate-50 dark:hover:bg-neutral-600 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4 text-slate-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="truncate">{locations.length === 0 ? "Location" : `${locations.length} selected`}</span>
            <svg className={`w-3 h-3 text-slate-400 shrink-0 ml-auto transition-transform ${locationDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {locationDropdownOpen && (
            <div className="absolute z-20 mt-1 w-64 max-h-60 overflow-y-auto bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-md shadow-lg">
              {COUNTRIES.map((country) => (
                <label
                  key={country}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-neutral-700 cursor-pointer text-sm text-slate-700 dark:text-neutral-300"
                >
                  <input
                    type="checkbox"
                    checked={locations.includes(country)}
                    onChange={() => toggleLocation(country)}
                    className="rounded border-slate-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
                  />
                  {country}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Max Pages — 10% */}
        <div className="relative min-w-0" style={{ flex: "0 0 calc(10% - 24px)" }}>
          <span className="absolute left-3 top-1 text-[9px] font-medium text-slate-400 dark:text-neutral-500 uppercase tracking-wide pointer-events-none">Max Pages</span>
          <input
            type="number"
            min={1}
            max={MAX_PAGES_LIMIT}
            value={maxPages}
            onChange={(e) => setMaxPages(Math.min(MAX_PAGES_LIMIT, Math.max(1, parseInt(e.target.value) || 1)))}
            disabled={searchState.isSearching}
            className="w-full h-[48px] px-3 pt-3.5 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mt-4">
        {searchState.isSearching ? (
          <button
            onClick={onCancel}
            className="px-10 py-2 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 text-sm font-medium rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            disabled={keywords.length === 0 || disabled}
            className="px-10 py-2 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 text-sm font-medium rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 transition-colors"
          >
            Scan
          </button>
        )}
      </div>

      <ProgressArea
        isSearching={searchState.isSearching}
        progress={searchState.progress}
        completedKeywords={searchState.completedKeywords}
        errors={searchState.errors}
      />

      {searchState.result && (
        <div className="mt-4 p-3 bg-slate-50 dark:bg-neutral-700 rounded-md border border-slate-200 dark:border-neutral-600 text-sm text-slate-700 dark:text-neutral-300">
          Search complete: {searchState.result.new_profiles} new profiles found across {searchState.result.keywords_completed} keywords.
          {searchState.result.pre_linked > 0 && ` ${searchState.result.pre_linked} existing profiles linked (0 credits used).`}
          {" "}Total in database: {searchState.result.total_profiles}.
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Confirm Scan</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
              This will use API credits: {keywords.length * maxPages} for search + additional credits for profile photo fetching. Estimated {keywords.length * maxPages * 2}-{keywords.length * maxPages * 3} total credits. Continue?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 border border-slate-300 dark:border-neutral-600 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleScan}
                className="px-4 py-2 text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
              >
                Yes, Scan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
