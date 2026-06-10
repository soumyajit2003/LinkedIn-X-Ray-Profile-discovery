"use client";

import { useState, useEffect, useRef } from "react";
import type { ChatMessage, AISettings } from "@/lib/types";
import { getAISettings } from "@/lib/api";
import { API_BASE } from "@/lib/constants";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionQueued?: () => void;
  onAddKeywords?: (keywords: string[]) => void;
  onStartScan?: (keywords: string[], maxPages: number) => void;
}

type ConsentType = "db" | "web";

interface PendingAction {
  profileIds: number[];
  rawBlock: string;
}

interface PendingKeywords {
  keywords: string[];
}

interface PendingScan {
  keywords: string[];
  pages: number;
}

export default function ChatPanel({ isOpen, onClose, onConnectionQueued, onAddKeywords, onStartScan }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [aiSettings, setAISettings] = useState<AISettings | null>(null);
  const [provider, setProvider] = useState<string>("auto");
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [dbAccessGranted, setDbAccessGranted] = useState(false);
  const [webSearchGranted, setWebSearchGranted] = useState(false);
  const [showConsentPrompt, setShowConsentPrompt] = useState<ConsentType | null>(null);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[] | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingKeywords, setPendingKeywords] = useState<PendingKeywords | null>(null);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [actionExecuting, setActionExecuting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setAnimating(true);
      requestAnimationFrame(() => setVisible(true));
      getAISettings().then((s) => {
        setAISettings(s);
        if (s.openai_key_set) setProvider("openai");
        else if (s.anthropic_key_set) setProvider("anthropic");
        else if (s.gemini_key_set) setProvider("gemini");
        else if (s.bedrock_key_set) setProvider("bedrock");
        else setProvider("auto");
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const hasAnyKey = aiSettings && (aiSettings.openai_key_set || aiSettings.anthropic_key_set || aiSettings.gemini_key_set || aiSettings.bedrock_key_set);

  const getActiveModel = (): string => {
    if (!aiSettings) return "";
    if (provider === "openai") return aiSettings.openai_model;
    if (provider === "anthropic") return aiSettings.anthropic_model;
    if (provider === "gemini") return aiSettings.gemini_model;
    if (provider === "bedrock") return aiSettings.bedrock_model;
    if (aiSettings.openai_key_set) return aiSettings.openai_model;
    if (aiSettings.anthropic_key_set) return aiSettings.anthropic_model;
    if (aiSettings.gemini_key_set) return aiSettings.gemini_model;
    if (aiSettings.bedrock_key_set) return aiSettings.bedrock_model;
    return "";
  };

  const extractSearchQuery = (msgs: ChatMessage[]): string => {
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return "";
    return lastUserMsg.content;
  };

  const parseActionBlock = (content: string): PendingAction | null => {
    const actionMatch = content.match(/\[\[ACTION:QUEUE_CONNECTION\]\]\s*\n\s*IDS:\s*([\d,\s]+)\s*\n\s*\[\[\/ACTION\]\]/);
    if (!actionMatch) return null;
    const ids = actionMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (ids.length === 0) return null;
    return { profileIds: ids, rawBlock: actionMatch[0] };
  };

  const parseKeywordsAction = (content: string): PendingKeywords | null => {
    const match = content.match(/\[\[ACTION:ADD_KEYWORDS\]\]\s*\n\s*KEYWORDS:\s*(.+?)\s*\n\s*\[\[\/ACTION\]\]/);
    if (!match) return null;
    const keywords = match[1].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (keywords.length === 0) return null;
    return { keywords };
  };

  const parseScanAction = (content: string): PendingScan | null => {
    const match = content.match(/\[\[ACTION:START_SCAN\]\]\s*\n\s*KEYWORDS:\s*(.+?)\s*\n\s*PAGES:\s*(\d+)\s*\n\s*\[\[\/ACTION\]\]/);
    if (!match) return null;
    const keywords = match[1].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const pages = Math.min(Math.max(parseInt(match[2], 10) || 3, 1), 10);
    if (keywords.length === 0) return null;
    return { keywords, pages };
  };

  const cleanMessageContent = (content: string): string => {
    return content
      .replace(/```\s*\[\[ACTION:QUEUE_CONNECTION\]\]\s*\n\s*IDS:[\d,\s]+\s*\n\s*\[\[\/ACTION\]\]\s*```/g, "")
      .replace(/\[\[ACTION:QUEUE_CONNECTION\]\]\s*\n\s*IDS:[\d,\s]+\s*\n\s*\[\[\/ACTION\]\]/g, "")
      .replace(/```\s*\[\[ACTION:ADD_KEYWORDS\]\]\s*\n\s*KEYWORDS:.+?\s*\n\s*\[\[\/ACTION\]\]\s*```/g, "")
      .replace(/\[\[ACTION:ADD_KEYWORDS\]\]\s*\n\s*KEYWORDS:.+?\s*\n\s*\[\[\/ACTION\]\]/g, "")
      .replace(/```\s*\[\[ACTION:START_SCAN\]\]\s*\n\s*KEYWORDS:.+?\s*\n\s*PAGES:\s*\d+\s*\n\s*\[\[\/ACTION\]\]\s*```/g, "")
      .replace(/\[\[ACTION:START_SCAN\]\]\s*\n\s*KEYWORDS:.+?\s*\n\s*PAGES:\s*\d+\s*\n\s*\[\[\/ACTION\]\]/g, "")
      .trim();
  };

  const sendToAI = async (chatMessages: ChatMessage[], includeDb: boolean, includeWeb: boolean) => {
    setStreaming(true);
    const assistantMessage: ChatMessage = { role: "assistant", content: "" };
    setMessages([...chatMessages, assistantMessage]);

    try {
      const searchQuery = includeWeb ? extractSearchQuery(chatMessages) : undefined;

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          provider,
          include_db_context: includeDb,
          include_web_search: includeWeb,
          web_search_query: searchQuery,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.content) {
                fullContent += parsed.content;
                setMessages([...chatMessages, { role: "assistant", content: fullContent }]);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      // Check if AI is requesting DB access
      if (fullContent.includes("[[REQUEST:DB_ACCESS]]")) {
        setMessages(chatMessages);
        setPendingMessages(chatMessages);
        setShowConsentPrompt("db");
        setStreaming(false);
        return;
      }

      // Check for action blocks in the final content
      const cleaned = cleanMessageContent(fullContent);
      let hasAction = false;

      const connectionAction = parseActionBlock(fullContent);
      if (connectionAction) {
        setMessages([...chatMessages, { role: "assistant", content: cleaned }]);
        setPendingAction(connectionAction);
        hasAction = true;
      }

      const keywordsAction = parseKeywordsAction(fullContent);
      if (keywordsAction && !hasAction) {
        setMessages([...chatMessages, { role: "assistant", content: cleaned }]);
        setPendingKeywords(keywordsAction);
        hasAction = true;
      }

      const scanAction = parseScanAction(fullContent);
      if (scanAction && !hasAction) {
        setMessages([...chatMessages, { role: "assistant", content: cleaned }]);
        setPendingScan(scanAction);
        hasAction = true;
      }

      if (!hasAction && cleaned !== fullContent) {
        setMessages([...chatMessages, { role: "assistant", content: cleaned }]);
      }
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setMessages(chatMessages);
    }
    setStreaming(false);
  };

  const handleExecuteAction = async () => {
    if (!pendingAction) return;
    setActionExecuting(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat/execute-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "queue_connection",
          profile_ids: pendingAction.profileIds,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }

      const result = await response.json();
      const skipped = result.results.filter((r: { status: string }) => r.status.startsWith("already_"));
      let confirmText = `✓ Done! Queued ${result.queued_count} connection${result.queued_count !== 1 ? "s" : ""}. They'll be sent automatically with random delays.`;
      if (skipped.length > 0) {
        confirmText += `\n⚠ ${skipped.length} profile${skipped.length !== 1 ? "s" : ""} skipped (already ${skipped.map((s: { status: string }) => s.status.replace("already_", "")).join(", ")}).`;
      }
      if (result.queued_count === 0 && skipped.length > 0) {
        confirmText = `⚠ No connections queued — ${skipped.length} profile${skipped.length !== 1 ? "s were" : " was"} already ${skipped.map((s: { status: string }) => s.status.replace("already_", "")).join(", ")}.`;
      }
      const confirmMsg: ChatMessage = { role: "assistant", content: confirmText };
      setMessages((prev) => [...prev, confirmMsg]);
      if (result.queued_count > 0) {
        window.postMessage({ type: "START_POLLING" }, "*");
      }
      onConnectionQueued?.();
    } catch (e) {
      setError(`Action failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    setPendingAction(null);
    setActionExecuting(false);
  };

  const handleDenyAction = () => {
    const denyMsg: ChatMessage = {
      role: "assistant",
      content: "Connection requests cancelled. No connections were queued.",
    };
    setMessages((prev) => [...prev, denyMsg]);
    setPendingAction(null);
  };

  const handleAcceptKeywords = () => {
    if (!pendingKeywords) return;
    onAddKeywords?.(pendingKeywords.keywords);
    const confirmMsg: ChatMessage = {
      role: "assistant",
      content: `✓ Keywords added to Search Panel: ${pendingKeywords.keywords.join(", ")}\n\nWould you like me to start scanning LinkedIn for these profiles? Just say "scan" or "go ahead".`,
    };
    setMessages((prev) => [...prev, confirmMsg]);
    setPendingKeywords(null);
  };

  const handleDenyKeywords = () => {
    const denyMsg: ChatMessage = {
      role: "assistant",
      content: "No keywords were added. Let me know if you'd like different suggestions.",
    };
    setMessages((prev) => [...prev, denyMsg]);
    setPendingKeywords(null);
  };

  const handleAcceptScan = () => {
    if (!pendingScan) return;
    const confirmMsg: ChatMessage = {
      role: "assistant",
      content: `✓ Starting scan with keywords: ${pendingScan.keywords.join(", ")} (${pendingScan.pages} pages each). Check the search panel for progress.`,
    };
    setMessages((prev) => [...prev, confirmMsg]);
    onStartScan?.(pendingScan.keywords, pendingScan.pages);
    setPendingScan(null);
  };

  const handleDenyScan = () => {
    const denyMsg: ChatMessage = {
      role: "assistant",
      content: "Scan cancelled. Let me know when you're ready to search.",
    };
    setMessages((prev) => [...prev, denyMsg]);
    setPendingScan(null);
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    if (!hasAnyKey) {
      setError("No AI API key configured. Please add an API key in Settings (gear icon).");
      return;
    }

    setError("");
    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    if (webSearchEnabled && !webSearchGranted) {
      setPendingMessages(newMessages);
      setShowConsentPrompt("web");
      return;
    }

    await sendToAI(newMessages, dbAccessGranted, webSearchEnabled && webSearchGranted);
  };

  const handleConsentAllow = async () => {
    const consentType = showConsentPrompt;
    setShowConsentPrompt(null);

    if (consentType === "db") {
      setDbAccessGranted(true);
      if (pendingMessages) {
        if (webSearchEnabled && !webSearchGranted) {
          setShowConsentPrompt("web");
          return;
        }
        await sendToAI(pendingMessages, true, webSearchEnabled && webSearchGranted);
        setPendingMessages(null);
      }
    } else if (consentType === "web") {
      setWebSearchGranted(true);
      if (pendingMessages) {
        await sendToAI(pendingMessages, dbAccessGranted, true);
        setPendingMessages(null);
      }
    }
  };

  const handleConsentDeny = async () => {
    const consentType = showConsentPrompt;
    setShowConsentPrompt(null);

    if (consentType === "db") {
      if (pendingMessages) {
        const denyMsg: ChatMessage = {
          role: "assistant",
          content: "I need access to your profile database to help with that request. You can grant access anytime by asking again.",
        };
        setMessages([...pendingMessages, denyMsg]);
        setPendingMessages(null);
      }
    } else if (consentType === "web") {
      if (pendingMessages) {
        await sendToAI(pendingMessages, dbAccessGranted, false);
        setPendingMessages(null);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen && !animating) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-lg bg-white dark:bg-neutral-800 shadow-xl border-l border-slate-200 dark:border-neutral-700 flex flex-col transition-transform duration-300 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-neutral-700">
          <div className="flex items-center gap-2 flex-wrap">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">AI Chat</h2>
            {getActiveModel() && (
              <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-neutral-700 text-slate-600 dark:text-neutral-300 rounded-full">
                {getActiveModel()}
              </span>
            )}
            {dbAccessGranted && (
              <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                DB
              </span>
            )}
            {webSearchGranted && (
              <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-full">
                Web
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-400 dark:hover:text-neutral-200 text-xl leading-none">&times;</button>
        </div>

        {/* Provider selector + Web search toggle */}
        {hasAnyKey && (
          <div className="px-4 py-2 border-b border-slate-200 dark:border-neutral-700 flex gap-2 items-center">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="custom-select flex-1 px-3 py-1.5 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              <option value="auto">Auto (first available)</option>
              {aiSettings?.openai_key_set && <option value="openai">OpenAI — {aiSettings.openai_model}</option>}
              {aiSettings?.anthropic_key_set && <option value="anthropic">Anthropic — {aiSettings.anthropic_model}</option>}
              {aiSettings?.gemini_key_set && <option value="gemini">Gemini — {aiSettings.gemini_model}</option>}
              {aiSettings?.bedrock_key_set && <option value="bedrock">Bedrock — {aiSettings.bedrock_model}</option>}
            </select>
            <button
              onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              title={webSearchEnabled ? "Web search enabled" : "Enable web search"}
              className={`px-2.5 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                webSearchEnabled
                  ? "bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400"
                  : "border-slate-300 dark:border-neutral-600 text-slate-500 dark:text-neutral-400 hover:bg-slate-50 dark:hover:bg-neutral-700"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        )}

        {/* Consent Popup (DB / Web) */}
        {showConsentPrompt && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-l-lg">
            <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-xl shadow-2xl p-6 mx-6 max-w-sm w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  showConsentPrompt === "db"
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : "bg-purple-100 dark:bg-purple-900/30"
                }`}>
                  {showConsentPrompt === "db" ? (
                    <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  {showConsentPrompt === "db" ? "Database Access Request" : "Web Search Request"}
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-neutral-300 mb-5">
                {showConsentPrompt === "db"
                  ? "Your AI wants to access your LinkedIn X-Ray Search DB to analyze profiles and provide recommendations. Want to proceed?"
                  : "Your AI wants to search the internet for more information about this person/topic. This will use your Serper API credits. Want to proceed?"
                }
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleConsentDeny}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-neutral-600 text-slate-700 dark:text-neutral-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                >
                  No
                </button>
                <button
                  onClick={handleConsentAllow}
                  className={`flex-1 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${
                    showConsentPrompt === "db"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-purple-600 hover:bg-purple-700"
                  }`}
                >
                  Yes, Allow
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Confirmation Popup (Send Connections) */}
        {pendingAction && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-l-lg">
            <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-xl shadow-2xl p-6 mx-6 max-w-sm w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Send Connections?</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-neutral-300 mb-5">
                AI wants to queue <strong>{pendingAction.profileIds.length} connection request{pendingAction.profileIds.length !== 1 ? "s" : ""}</strong>. They&apos;ll be sent automatically with random delays (30–90s apart). Proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDenyAction}
                  disabled={actionExecuting}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-neutral-600 text-slate-700 dark:text-neutral-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteAction}
                  disabled={actionExecuting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {actionExecuting ? "Queuing..." : "Yes, Send"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Keywords Confirmation Popup */}
        {pendingKeywords && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-l-lg">
            <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-xl shadow-2xl p-6 mx-6 max-w-sm w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Add Search Keywords?</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-neutral-300 mb-3">
                AI suggests these keywords to find relevant profiles:
              </p>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {pendingKeywords.keywords.map((kw) => (
                  <span key={kw} className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-800">
                    {kw}
                  </span>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleDenyKeywords}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-neutral-600 text-slate-700 dark:text-neutral-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                >
                  No
                </button>
                <button
                  onClick={handleAcceptKeywords}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  Yes, Add Keywords
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scan Confirmation Popup */}
        {pendingScan && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-l-lg">
            <div className="bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-xl shadow-2xl p-6 mx-6 max-w-sm w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Start LinkedIn Scan?</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-neutral-300 mb-3">
                Scan LinkedIn with these keywords ({pendingScan.pages} pages each):
              </p>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {pendingScan.keywords.map((kw) => (
                  <span key={kw} className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-full border border-indigo-200 dark:border-indigo-800">
                    {kw}
                  </span>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleDenyScan}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-neutral-600 text-slate-700 dark:text-neutral-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAcceptScan}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Yes, Start Scan
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!hasAnyKey && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-6">
                <svg className="w-12 h-12 mx-auto text-slate-300 dark:text-neutral-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-slate-600 dark:text-neutral-400 font-medium mb-1">No AI API key configured</p>
                <p className="text-xs text-slate-500 dark:text-neutral-500">Add an OpenAI, Anthropic, Gemini, or AWS Bedrock key in Settings (gear icon) to start chatting.</p>
              </div>
            </div>
          )}

          {hasAnyKey && messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-6">
                <svg className="w-12 h-12 mx-auto text-slate-300 dark:text-neutral-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm text-slate-600 dark:text-neutral-400 font-medium">Ask me anything about your profiles</p>
                <p className="text-xs text-slate-500 dark:text-neutral-500 mt-1">Try: &ldquo;Find 10 best profiles in healthcare AI and send connections&rdquo;</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-neutral-700 text-slate-900 dark:text-neutral-100"
                }`}
              >
                {msg.content || (streaming && i === messages.length - 1 && msg.role === "assistant" && (
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-neutral-400 italic">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {webSearchEnabled && webSearchGranted ? "Searching the web..." : "Thinking..."}
                  </span>
                ))}
                {msg.content && streaming && i === messages.length - 1 && msg.role === "assistant" && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-slate-400 dark:bg-neutral-400 animate-pulse" />
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 border-t border-slate-200 dark:border-neutral-700">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-neutral-700">
          {webSearchEnabled && (
            <p className="text-xs text-purple-600 dark:text-purple-400 mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Web search enabled — AI will search the internet for your query
            </p>
          )}
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasAnyKey ? (webSearchEnabled ? "Ask about a person to search the web..." : "Type a message...") : "Configure an AI key in Settings first"}
              disabled={!hasAnyKey || streaming || !!showConsentPrompt || !!pendingAction}
              rows={1}
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 resize-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!hasAnyKey || streaming || !input.trim() || !!showConsentPrompt || !!pendingAction}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
