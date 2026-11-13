export type ThemeMode = 'dark' | 'light';

export type EngineId =
  | 'instant'
  | 'webgpu-swift'
  | 'webgpu-balanced'
  | 'webgpu-deep'
  | 'custom-api';

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

export interface EngineOption {
  id: EngineId;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  mlcModelId?: string;
  vramMB?: number;
  requiresWebGPU: boolean;
}

export interface ModelLoadProgress {
  engineId: EngineId;
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number; // 0..1
  text: string;
}

export interface CustomApiConfig {
  endpointUrl: string;
  apiKey: string;
  modelName: string;
}

export interface AppSettings {
  theme: ThemeMode;
  engineId: EngineId;
  voiceStyle: VoiceStyle;
  autoReadAloud: boolean;
  customApi: CustomApiConfig;
}
