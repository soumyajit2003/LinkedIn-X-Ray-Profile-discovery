"use client";

import { useState, KeyboardEvent } from "react";

interface KeywordChipsProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
}

export default function KeywordChips({ keywords, onChange, disabled }: KeywordChipsProps) {
  const [input, setInput] = useState("");

  const addKeyword = () => {
    const trimmed = input.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      onChange([...keywords, trimmed]);
    }
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
    if (e.key === "Backspace" && !input && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  };

  const removeKeyword = (index: number) => {
    onChange(keywords.filter((_, i) => i !== index));
  };

  return (
    <div className={`flex items-center gap-2 p-3 border border-slate-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 h-[48px] ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 scrollbar-hide">
        {keywords.map((kw, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-neutral-600 text-slate-700 dark:text-neutral-200 text-sm rounded-md border border-slate-200 dark:border-neutral-500 whitespace-nowrap shrink-0"
          >
            {kw}
            {!disabled && (
              <button
                onClick={() => removeKeyword(i)}
                className="text-slate-400 hover:text-slate-600 dark:text-neutral-400 dark:hover:text-neutral-200 ml-0.5 leading-none"
              >
                &times;
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addKeyword}
          placeholder={keywords.length === 0 ? "Add keywords..." : ""}
          disabled={disabled}
          className="min-w-[120px] outline-none text-sm text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 dark:placeholder:text-neutral-500 bg-transparent shrink-0"
        />
      </div>
    </div>
  );
}
