export type ThemeMode = 'dark' | 'light';

export type EngineId =
  | 'oss-reasoning'
  | 'oss-fast'
  | 'gemini-flash'
  | 'gemini-pro'
  | 'custom-api';

export type EngineProviderKind = 'open-source' | 'google' | 'custom';

export type VoiceStyle = 'standard' | 'blunt' | 'academic' | 'mentor';

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  date: string;
  url: string;
  doi: string;
  keywords: string[];
  summary: string;
  chunks: string[];
}

export interface KnowledgeCorpus {
  generatedAt: string;
  author: string;
  canonicalSite: string;
  totalEntries: number;
  entries: KnowledgeEntry[];
}

export interface RetrievedSource {
  index: number;
  entry: KnowledgeEntry;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

export interface WebSource {
  index: number;
  title: string;
  url: string;
}

export interface AttachedContext {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thoughts?: string;
  thinkingMs?: number;
  isThinking?: boolean;
  webSearchQueries?: string[];
  webSources?: WebSource[];
  createdAt: number;
  engineUsed?: EngineId;
  modelLabel?: string;
  voiceStyle?: VoiceStyle;
  sources?: RetrievedSource[];
  retrievalMs?: number;
  followUps?: string[];
  attachedContext?: AttachedContext;
  feedback?: 'up' | 'down' | null;
  isStreaming?: boolean;
  needsBackendSetup?: boolean;
  error?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  messages: ChatMessage[];
}

export type GeminiModelId =
  | 'gemini-3-flash-preview'
  | 'gemini-3.8-flash'
  | 'gemini-3.5-flash'
  | 'gemini-flash-lite-latest'
  | 'gemini-4-hydrogen'
  | 'gemini-3.1-pro-preview'
  | 'gemini-pro-latest';

export interface EngineOption {
  id: EngineId;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  providerKind: EngineProviderKind;
  geminiModelId?: GeminiModelId;
  geminiFallbackModels?: GeminiModelId[];
  thinkingBudget?: number;
}

export interface CustomApiConfig {
  endpointUrl: string;
  apiKey: string;
  modelName: string;
}

export interface UserProfile {
  name: string;
  email?: string;
  signedInAt: number;
}

export interface AppSettings {
  theme: ThemeMode;
  engineId: EngineId;
  voiceStyle: VoiceStyle;
  webSearchEnabled: boolean;
  groqApiKey: string;
  openRouterApiKey: string;
  geminiApiKey: string;
  proxyUrl: string;
  customApi: CustomApiConfig;
}
