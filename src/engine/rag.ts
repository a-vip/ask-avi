import rawCorpus from '../data/knowledge.json';
import type { KnowledgeCorpus, KnowledgeEntry, RetrievedSource } from '../types/chat';

const corpus = rawCorpus as KnowledgeCorpus;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'for', 'from', 'get',
  'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'him', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'me',
  'more', 'most', 'my', 'no', 'not', 'now', 'of', 'on', 'or', 'our', 'out',
  'she', 'should', 'so', 'some', 'such', 'tell', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'too', 'up', 'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'about',
  'avi', 'perera', 'hello', 'hey', 'hiya', 'thanks', 'thank', 'please',
  'okay', 'ok', 'yes', 'sure', 'cool', 'great', 'nice', 'think', 'good',
]);

const QUERY_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/\bkiller robots?\b|\bautonomous weapons?\b|\baws\b/i, ['laws', 'ihl', 'meaningful', 'human', 'control', 'ccw', 'unidir']],
  [/\bmhc\b|\bhuman[- ]in[- ]the[- ]loop\b/i, ['meaningful', 'human', 'control', 'accountability', 'article']],
  [/\bwho (are|is)\b|\byourself\b|\bbio\b|\bbackground\b|\bstory\b/i, ['biography', 'harrow', 'cambridge', 'buckingham', 'bangkok', 'sovdash']],
  [/\bconsult|\bhire\b|\badvis|\bwork with\b|\bcontact\b|\bbook\b/i, ['consulting', 'advisory', 'calendly', 'agentic', 'launchpad']],
  [/\bprojects?\b|\bapps?\b|\btools?\b|\bbuild|\brepos?\b|\bgithub\b/i, ['sovdash', 'lex', 'machina', 'simulator', 'suiji', 'echo', 'realm']],
  [/\b(go|weiqi|baduk)\b/i, ['suiji', 'dojo', 'tsumego']],
  [/\bimposter\b|\bdoubt\b|\bconfidence\b|\badvice\b|\bwisdom\b/i, ['evidence', 'confidence', 'weather', 'humility', 'infinite']],
  [/\bgaza\b|\bisrael\b|\btargeting\b/i, ['lavender', 'ihl', 'disarmament', 'toolkit', 'accountability']],
  [/\bsuperposition\b|\brace\b|\bbias\b|\bstereotype\b/i, ['context', 'wonderful', 'astrology', 'prejudice']],
  [/\bsovdash\b|\bosint\b|\bglobe\b/i, ['sovereign', 'intelligence', 'dashboard', 'intel']],
  [/\blex machina\b|\bmcp\b|\beu ai act\b|\bgdpr\b/i, ['lex', 'machina', 'regulation', 'compliance', 'corpus']],
  [/\bnomad\b|\bbali\b|\btulum\b/i, ['colonisers', 'digital', 'nomad', 'thailand']],
  [/\breligio\w*|\bfaith\b|\bbeliefs?\b|\bspiritu\w*|\btheolog\w*|\bchurch\b|\bgod\b|\batheis\w*|\bagnostic\w*|\bbuddhis\w*/i, ['buddhist', 'buddhism', 'christian', 'atheism', 'belief', 'philosophy', 'evidence', 'encyclical']],
  [/\bwhere do you live\b|\bwhere are you based\b|\bthailand\b|\bbangkok\b|\blondon\b/i, ['bangkok', 'thailand', 'london', 'harrow', 'biography', 'nomad']],
  [/\bstudied\b|\bstudy\b|\bdegree\b|\beducation\b|\buniversity\b|\bqualifications?\b/i, ['cambridge', 'buckingham', 'imperial', 'essex', 'open', 'scholarship', 'biography']],
];

interface IndexedDoc {
  entry: KnowledgeEntry;
  termFreq: Map<string, number>;
  titleTokens: Set<string>;
  keywordTokens: Set<string>;
  docLen: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function normalizeQueryTokens(query: string): string[] {
  const base = tokenize(query);
  const extra: string[] = [];
  for (const [pattern, synonyms] of QUERY_EXPANSIONS) {
    if (pattern.test(query)) {
      extra.push(...synonyms);
    }
  }
  return Array.from(new Set([...base, ...extra]));
}

function normalizeEntryUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function tagInitialJustPublished(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const dated = entries
    .filter((e) => Boolean(e.date))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const recentIds = new Set(dated.slice(0, 6).map((e) => e.id));
  return entries.map((e) =>
    recentIds.has(e.id) ? { ...e, justPublished: true } : e
  );
}

class KnowledgeIndex {
  private entries: KnowledgeEntry[] = [];
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgDocLen = 1;
  private listeners = new Set<() => void>();
  private syncInFlight: Promise<number> | null = null;
  private lastSyncAt = 0;

  constructor(initialEntries: KnowledgeEntry[]) {
    this.entries = tagInitialJustPublished(initialEntries);
    this.buildIndex(this.entries);
  }

  private buildIndex(entries: KnowledgeEntry[]): void {
    this.docs = [];
    this.df = new Map<string, number>();
    let totalLen = 0;

    for (const entry of entries) {
      const titleTokens = new Set(tokenize(entry.title));
      const keywordTokens = new Set(entry.keywords.flatMap((k) => tokenize(k)));
      const fullText = [
        entry.title,
        entry.title,
        entry.category,
        entry.keywords.join(' '),
        entry.summary,
        ...entry.chunks,
      ].join(' ');
      const tokens = tokenize(fullText);
      const tf = new Map<string, number>();
      for (const tok of tokens) {
        tf.set(tok, (tf.get(tok) ?? 0) + 1);
      }
      for (const uniqueTok of tf.keys()) {
        this.df.set(uniqueTok, (this.df.get(uniqueTok) ?? 0) + 1);
      }
      totalLen += tokens.length;
      this.docs.push({
        entry,
        termFreq: tf,
        titleTokens,
        keywordTokens,
        docLen: Math.max(tokens.length, 1),
      });
    }

    this.avgDocLen = entries.length > 0 ? totalLen / entries.length : 1;
    KNOWLEDGE_META.totalEntries = entries.length;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Ignore subscriber error
      }
    }
  }

  public upsertEntries(incoming: KnowledgeEntry[]): number {
    if (!incoming || incoming.length === 0) return 0;

    const next = [...this.entries];
    const indexById = new Map<string, number>();
    const indexByUrl = new Map<string, number>();

    next.forEach((e, idx) => {
      indexById.set(e.id, idx);
      const norm = normalizeEntryUrl(e.url);
      if (norm) indexByUrl.set(norm, idx);
    });

    let changed = 0;
    const brandNew: KnowledgeEntry[] = [];

    for (const item of incoming) {
      if (!item || !item.title || !Array.isArray(item.chunks) || item.chunks.length === 0) {
        continue;
      }
      const normUrl = normalizeEntryUrl(item.url);
      const existingIdx =
        indexById.get(item.id) ?? (normUrl ? indexByUrl.get(normUrl) : undefined);

      if (existingIdx !== undefined) {
        const prev = next[existingIdx];
        const hashChanged =
          Boolean(item.contentHash && prev.contentHash !== item.contentHash) ||
          Boolean(item.justPublished !== prev.justPublished) ||
          item.chunks.length !== prev.chunks.length ||
          item.summary !== prev.summary;

        if (hashChanged) {
          next[existingIdx] = {
            ...prev,
            ...item,
            id: prev.id,
            liveIngested: true,
          };
          changed += 1;
        }
      } else {
        brandNew.push({ ...item, liveIngested: true });
        changed += 1;
      }
    }

    if (changed === 0) return 0;

    this.entries = tagInitialJustPublished([...brandNew, ...next]);
    this.buildIndex(this.entries);
    this.notifyListeners();
    return changed;
  }

  public async syncLiveWordPressKnowledge(authEndpointUrl?: string): Promise<number> {
    if (!authEndpointUrl || typeof fetch === 'undefined') return 0;
    if (this.syncInFlight) return this.syncInFlight;
    if (Date.now() - this.lastSyncAt < 60_000) return 0;

    this.syncInFlight = (async () => {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
        const sep = authEndpointUrl.includes('?') ? '&' : '?';
        const res = await fetch(`${authEndpointUrl}${sep}action=live_knowledge`, {
          method: 'GET',
          credentials: 'same-origin',
          signal: controller?.signal,
        });
        if (timer) clearTimeout(timer);
        if (!res.ok) return 0;
        const data = (await res.json()) as {
          ok?: boolean;
          entries?: KnowledgeEntry[];
        };
        this.lastSyncAt = Date.now();
        if (data?.ok && Array.isArray(data.entries)) {
          return this.upsertEntries(data.entries);
        }
        return 0;
      } catch {
        return 0;
      } finally {
        this.syncInFlight = null;
      }
    })();

    return this.syncInFlight;
  }

  public getAllEntries(): KnowledgeEntry[] {
    return this.entries;
  }

  public getJustPublishedEntries(): KnowledgeEntry[] {
    return this.entries
      .filter((e) => Boolean(e.justPublished))
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  public getCategories(): string[] {
    const counts = new Map<string, number>();
    for (const entry of this.entries) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    return ['All', ...Array.from(counts.keys()).sort()];
  }

  public search(
    query: string,
    options?: { topK?: number; conversationHint?: string; minScore?: number }
  ): { sources: RetrievedSource[]; elapsedMs: number } {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const topK = options?.topK ?? 3;
    const minScore = options?.minScore ?? 3.6;
    const rawTokens = tokenize(query);
    const queryTokens = normalizeQueryTokens(
      options?.conversationHint && rawTokens.length <= 4
        ? `${query} ${options.conversationHint}`
        : query
    );

    if (queryTokens.length === 0) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return { sources: [], elapsedMs: Math.max(1, Math.round(end - start)) };
    }

    const N = this.docs.length;
    const k1 = 1.5;
    const b = 0.72;
    const lowerQuery = query.toLowerCase();

    const scored: Array<{ doc: IndexedDoc; score: number; matched: string[] }> = [];

    for (const doc of this.docs) {
      let score = 0;
      const matched: string[] = [];

      for (const term of queryTokens) {
        const tf = doc.termFreq.get(term) ?? 0;
        if (tf === 0) continue;
        matched.push(term);
        const df = this.df.get(term) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const bm25 =
          idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.docLen / this.avgDocLen))));
        score += bm25;

        if (doc.titleTokens.has(term)) score += 1.65;
        if (doc.keywordTokens.has(term)) score += 1.05;
      }

      if (score <= 0) continue;

      // Exact phrase bonus in title or summary
      const titleLower = doc.entry.title.toLowerCase();
      if (lowerQuery.length >= 5 && titleLower.includes(lowerQuery.slice(0, 32))) {
        score += 4.0;
      }

      // Modest anchor boost for core biographical/stance pillars when relevant
      if (doc.entry.id.startsWith('pillar-') && matched.length >= 2) {
        score += 1.1;
      }

      scored.push({ doc, score, matched: Array.from(new Set(matched)) });
    }

    scored.sort((a, b) => b.score - a.score);

    const sources: RetrievedSource[] = scored
      .filter((item) => item.score >= minScore)
      .slice(0, topK)
      .map((item, idx) => ({
        index: idx + 1,
        entry: item.doc.entry,
        score: Number(item.score.toFixed(2)),
        matchedTerms: item.matched,
        snippet: pickBestSnippet(item.doc.entry, item.matched),
      }));

    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { sources, elapsedMs: Math.max(1, Math.round(end - start)) };
  }

  /**
   * Executes multiple resolved search queries (e.g. from the query planner)
   * and returns the highest-scoring distinct entries without repeating Turn 1 anchors unnecessarily.
   */
  public multiSearch(
    queries: string[],
    options?: { topK?: number; minScore?: number }
  ): { sources: RetrievedSource[]; elapsedMs: number } {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const topK = options?.topK ?? 4;
    const minScore = options?.minScore ?? 4.0;
    const cleanQueries = queries
      .map((q) => q.replace(/\s+/g, ' ').trim())
      .filter((q) => q.length >= 2)
      .slice(0, 4);

    if (cleanQueries.length === 0) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return { sources: [], elapsedMs: Math.max(1, Math.round(end - start)) };
    }

    const byEntryId = new Map<string, RetrievedSource>();
    for (const q of cleanQueries) {
      const { sources } = this.search(q, { topK: Math.max(topK, 4), minScore });
      for (const hit of sources) {
        const prev = byEntryId.get(hit.entry.id);
        if (!prev || hit.score > prev.score) {
          byEntryId.set(hit.entry.id, hit);
        }
      }
    }

    const merged = Array.from(byEntryId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((item, idx) => ({ ...item, index: idx + 1 }));

    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { sources: merged, elapsedMs: Math.max(1, Math.round(end - start)) };
  }
}

function pickBestSnippet(entry: KnowledgeEntry, matchedTerms: string[]): string {
  if (entry.chunks.length === 0) return entry.summary;

  const scoredChunks = entry.chunks.map((chunk, idx) => {
    const lower = chunk.toLowerCase();
    let hits = 0;
    for (const term of matchedTerms) {
      if (lower.includes(term)) hits += 1;
    }
    return { chunk, idx, hits };
  });

  scoredChunks.sort((a, b) => b.hits - a.hits || a.idx - b.idx);
  const chosen = scoredChunks.slice(0, 2).map((c) => c.chunk);
  const joined = chosen.join(' ');
  return joined.length > 720 ? joined.slice(0, 717).trimEnd() + '…' : joined;
}

export const KNOWLEDGE_META = {
  totalEntries: corpus.totalEntries,
  generatedAt: corpus.generatedAt,
  canonicalSite: corpus.canonicalSite,
};

export const knowledgeIndex = new KnowledgeIndex(corpus.entries);
