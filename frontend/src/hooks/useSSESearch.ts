"use client";

import { useState, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/constants";
import type { SSEProgress, SSEKeywordDone, SSEError, SSEDone, SSELog } from "@/lib/types";

export interface SearchState {
  isSearching: boolean;
  progress: Map<string, SSEProgress>;
  completedKeywords: SSEKeywordDone[];
  errors: SSEError[];
  logs: SSELog[];
  result: SSEDone | null;
}

const initialState: SearchState = {
  isSearching: false,
  progress: new Map(),
  completedKeywords: [],
  errors: [],
  logs: [],
  result: null,
};

export function useSSESearch() {
  const [state, setState] = useState<SearchState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const startSearch = useCallback(async (keywords: string[], maxPages: number, locations: string[] = [], projectId?: number | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      isSearching: true,
      progress: new Map(),
      completedKeywords: [],
      errors: [],
      logs: [],
      result: null,
    });

    try {
      const response = await fetch(`${API_BASE}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, max_pages: maxPages, locations, project_id: projectId || undefined }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        setState((prev) => ({
          ...prev,
          isSearching: false,
          errors: [...prev.errors, { message: `Search failed: ${text}`, recoverable: false }],
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:") && currentEvent) {
            const data = JSON.parse(line.slice(5).trim());

            switch (currentEvent) {
              case "progress":
                setState((prev) => {
                  const newProgress = new Map(prev.progress);
                  newProgress.set(data.keyword, data as SSEProgress);
                  return { ...prev, progress: newProgress };
                });
                break;
              case "keyword_done":
                setState((prev) => ({
                  ...prev,
                  completedKeywords: [...prev.completedKeywords, data as SSEKeywordDone],
                }));
                break;
              case "error":
                setState((prev) => ({
                  ...prev,
                  errors: [...prev.errors, data as SSEError],
                }));
                break;
              case "done":
                setState((prev) => ({
                  ...prev,
                  isSearching: false,
                  result: data as SSEDone,
                }));
                break;
              case "log":
                setState((prev) => ({
                  ...prev,
                  logs: [...prev.logs, data as SSELog],
                }));
                break;
            }
            currentEvent = "";
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        isSearching: false,
        errors: [...prev.errors, { message: String(err), recoverable: false }],
      }));
    }
  }, []);

  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isSearching: false }));
  }, []);

  return { ...state, startSearch, cancelSearch };
}
