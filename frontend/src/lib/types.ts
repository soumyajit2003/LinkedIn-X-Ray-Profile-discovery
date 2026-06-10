export interface Profile {
  id: number;
  name: string;
  profile_url: string;
  snippet: string | null;
  thumbnail_url: string;
  matched_keywords: string[];
  connection_status: "none" | "queued" | "sent" | "connected" | "failed";
  connection_scheduled_at: string | null;
  followers: string | null;
  location: string | null;
  project_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  keywords: string[];
  profile_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface ProfileListResponse {
  profiles: Profile[];
  total: number;
}

export interface Settings {
  api_key_set: boolean;
  api_key_masked: string;
  cx_id: string;
}

export interface Quota {
  used: number;
  limit: number;
  date: string;
}

export interface SSEProgress {
  keyword: string;
  current_page: number;
  total_pages: number;
  profiles_found: number;
}

export interface SSEKeywordDone {
  keyword: string;
  total_profiles: number;
}

export interface SSEError {
  message: string;
  keyword?: string;
  recoverable: boolean;
}

export interface SSEDone {
  total_profiles: number;
  new_profiles: number;
  pre_linked: number;
  keywords_completed: number;
}

export interface SSELog {
  timestamp: string;
  level: string;
  message: string;
}

export interface ConnectionResponse {
  profile_id: number;
  connection_status: string;
  connection_scheduled_at: string | null;
  daily_usage: { used: number; limit: number } | null;
}

export interface ConnectionUsage {
  used: number;
  limit: number;
  date: string;
}

export interface ConnectionBulkResponse {
  queued: ConnectionResponse[];
  daily_usage: { used: number; limit: number };
}

export interface AISettings {
  openai_key_set: boolean;
  openai_key_masked: string;
  openai_model: string;
  anthropic_key_set: boolean;
  anthropic_key_masked: string;
  anthropic_model: string;
  gemini_key_set: boolean;
  gemini_key_masked: string;
  gemini_model: string;
  bedrock_key_set: boolean;
  bedrock_key_masked: string;
  bedrock_region: string;
  bedrock_model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EnrichmentData {
  followers: string | null;
  location: string | null;
  education: string | null;
  experience: string | null;
  last_post_date: string | null;
  scraped_at: string | null;
}

export interface EnrichmentResponse {
  status: "enriched" | "not_enriched";
  data: EnrichmentData | null;
}
