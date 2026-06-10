"use client";

import { useState, useEffect, useCallback } from "react";

export interface ToastMessage {
  id: number;
  text: string;
}

let toastId = 0;
let addToastFn: ((text: string) => void) | null = null;

export function showToast(text: string) {
  addToastFn?.(text);
}

export default function Toast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string) => {
    const id = ++toastId;
    setMessages((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (messages.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className="bg-slate-800 dark:bg-neutral-700 text-white text-sm px-4 py-3 rounded-lg shadow-lg animate-[fadeIn_0.2s_ease-out]"
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
}
