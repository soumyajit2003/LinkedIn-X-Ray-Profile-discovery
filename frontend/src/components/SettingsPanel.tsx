"use client";

import { useState, useEffect } from "react";
import type { Settings, AISettings } from "@/lib/types";
import { getSettings, updateSettings, getAISettings, updateAISettings } from "@/lib/api";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const OPENAI_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];
const ANTHROPIC_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];
const GEMINI_MODELS = ["gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"];
const BEDROCK_MODELS = ["us.anthropic.claude-sonnet-4-6", "us.anthropic.claude-opus-4-7", "us.anthropic.claude-haiku-4-5-20251001-v1:0", "us.anthropic.claude-opus-4-6-v1"];
const BEDROCK_REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1", "ap-southeast-1"];

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [aiSettings, setAISettings] = useState<AISettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-5.4");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-6");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.1-pro-preview");
  const [bedrockKey, setBedrockKey] = useState("");
  const [bedrockRegion, setBedrockRegion] = useState("us-east-1");
  const [bedrockModel, setBedrockModel] = useState("us.anthropic.claude-sonnet-4-6");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState("");
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAnimating(true);
      requestAnimationFrame(() => setVisible(true));
      getSettings().then((s) => {
        setSettings(s);
        setApiKey("");
      });
      getAISettings().then((s) => {
        setAISettings(s);
        setOpenaiModel(s.openai_model);
        setAnthropicModel(s.anthropic_model);
        setGeminiModel(s.gemini_model);
        setBedrockRegion(s.bedrock_region);
        setBedrockModel(s.bedrock_model);
        setOpenaiKey("");
        setAnthropicKey("");
        setGeminiKey("");
        setBedrockKey("");
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const hasSerperChange = !!apiKey;
      const hasAIChange = !!openaiKey || !!anthropicKey || !!geminiKey || !!bedrockKey ||
        (aiSettings && (openaiModel !== aiSettings.openai_model || anthropicModel !== aiSettings.anthropic_model || geminiModel !== aiSettings.gemini_model || bedrockRegion !== aiSettings.bedrock_region || bedrockModel !== aiSettings.bedrock_model));

      if (!hasSerperChange && !hasAIChange) {
        setMessage("No changes to save.");
        setSaving(false);
        return;
      }

      if (hasSerperChange) {
        const updated = await updateSettings({ api_key: apiKey });
        setSettings(updated);
        setApiKey("");
      }

      if (hasAIChange) {
        const aiUpdate: Record<string, string> = {};
        if (openaiKey) aiUpdate.openai_key = openaiKey;
        if (anthropicKey) aiUpdate.anthropic_key = anthropicKey;
        if (geminiKey) aiUpdate.gemini_key = geminiKey;
        if (bedrockKey) aiUpdate.bedrock_key = bedrockKey;
        aiUpdate.openai_model = openaiModel;
        aiUpdate.anthropic_model = anthropicModel;
        aiUpdate.gemini_model = geminiModel;
        aiUpdate.bedrock_region = bedrockRegion;
        aiUpdate.bedrock_model = bedrockModel;
        const updated = await updateAISettings(aiUpdate);
        setAISettings(updated);
        setOpenaiKey("");
        setAnthropicKey("");
        setGeminiKey("");
        setBedrockKey("");
      }

      setMessage("Settings saved.");
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
    setSaving(false);
  };

  const handleRemoveKey = async (provider: string) => {
    setRemoving(provider);
    setMessage("");
    try {
      const removeData: Record<string, string> = {};
      if (provider === "openai") removeData.openai_key = "";
      else if (provider === "anthropic") removeData.anthropic_key = "";
      else if (provider === "gemini") removeData.gemini_key = "";
      else if (provider === "bedrock") removeData.bedrock_key = "";
      else if (provider === "serper") {
        await updateSettings({ api_key: "" });
        const s = await getSettings();
        setSettings(s);
        setMessage("Serper API key removed.");
        setRemoving("");
        return;
      }
      const updated = await updateAISettings(removeData);
      setAISettings(updated);
      setMessage(`${provider.charAt(0).toUpperCase() + provider.slice(1)} key removed.`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
    setRemoving("");
  };

  if (!isOpen && !animating) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-md bg-white dark:bg-neutral-800 shadow-xl border-l border-slate-200 dark:border-neutral-700 p-6 overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-400 dark:hover:text-neutral-200 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-6">
          {/* Serper API Key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Serper API Key</label>
            <p className="text-xs text-slate-500 dark:text-neutral-400 mb-2">
              Get your free key at{" "}
              <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">serper.dev</a>
              {" "}(2,500 free queries)
            </p>
            {settings?.api_key_set && (
              <div className="flex items-center justify-between mb-1 min-w-0 gap-2">
                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate min-w-0">Current: {settings.api_key_masked}</p>
                <button
                  onClick={() => handleRemoveKey("serper")}
                  disabled={removing === "serper"}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50 shrink-0"
                >
                  {removing === "serper" ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.api_key_set ? "Enter new key to update" : "Enter your Serper API key"}
              className="w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
          </div>

          {/* Divider */}
          <div className="border-t border-slate-200 dark:border-neutral-700" />

          {/* AI Chat Settings Header */}
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200 mb-1">AI Chat Settings</h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400">Configure one or more AI providers for the chat feature.</p>
          </div>

          {/* OpenAI */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300">OpenAI</label>
            {aiSettings?.openai_key_set && (
              <div className="flex items-center justify-between min-w-0 gap-2">
                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate min-w-0">Current: {aiSettings.openai_key_masked}</p>
                <button
                  onClick={() => handleRemoveKey("openai")}
                  disabled={removing === "openai"}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50 shrink-0"
                >
                  {removing === "openai" ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={aiSettings?.openai_key_set ? "Enter new key to update" : "Enter OpenAI API key"}
              className="w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
            <select
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className="custom-select w-fit px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              {OPENAI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Anthropic */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300">Anthropic</label>
            {aiSettings?.anthropic_key_set && (
              <div className="flex items-center justify-between min-w-0 gap-2">
                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate min-w-0">Current: {aiSettings.anthropic_key_masked}</p>
                <button
                  onClick={() => handleRemoveKey("anthropic")}
                  disabled={removing === "anthropic"}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50 shrink-0"
                >
                  {removing === "anthropic" ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={aiSettings?.anthropic_key_set ? "Enter new key to update" : "Enter Anthropic API key"}
              className="w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
            <select
              value={anthropicModel}
              onChange={(e) => setAnthropicModel(e.target.value)}
              className="custom-select w-fit px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Gemini */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300">Gemini</label>
            {aiSettings?.gemini_key_set && (
              <div className="flex items-center justify-between min-w-0 gap-2">
                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate min-w-0">Current: {aiSettings.gemini_key_masked}</p>
                <button
                  onClick={() => handleRemoveKey("gemini")}
                  disabled={removing === "gemini"}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50 shrink-0"
                >
                  {removing === "gemini" ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={aiSettings?.gemini_key_set ? "Enter new key to update" : "Enter Gemini API key"}
              className="w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="custom-select w-fit px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* AWS Bedrock */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300">AWS Bedrock (Claude)</label>
            {aiSettings?.bedrock_key_set && (
              <div className="flex items-center justify-between min-w-0 gap-2">
                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate min-w-0">Current: {aiSettings.bedrock_key_masked}</p>
                <button
                  onClick={() => handleRemoveKey("bedrock")}
                  disabled={removing === "bedrock"}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50 shrink-0"
                >
                  {removing === "bedrock" ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
            <input
              type="password"
              value={bedrockKey}
              onChange={(e) => setBedrockKey(e.target.value)}
              placeholder={aiSettings?.bedrock_key_set ? "Enter new key to update" : "Enter Bedrock API key"}
              className="w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm text-slate-900 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            />
            <select
              value={bedrockRegion}
              onChange={(e) => setBedrockRegion(e.target.value)}
              className="custom-select w-fit px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              {BEDROCK_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              value={bedrockModel}
              onChange={(e) => setBedrockModel(e.target.value)}
              className="custom-select w-full px-3 py-2 border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
            >
              {BEDROCK_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {message && (
            <p className={`text-sm ${message.startsWith("Error") ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {message}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 bg-slate-800 dark:bg-neutral-600 text-white text-sm font-medium rounded-md hover:bg-slate-700 dark:hover:bg-neutral-500 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
