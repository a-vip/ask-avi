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
  'avi', 'perera',
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

class KnowledgeIndex {
  private readonly docs: IndexedDoc[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgDocLen: number;

  constructor(entries: KnowledgeEntry[]) {
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
  }

  public getAllEntries(): KnowledgeEntry[] {
    return corpus.entries;
  }

  public getCategories(): string[] {
    const counts = new Map<string, number>();
    for (const entry of corpus.entries) {
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
    const minScore = options?.minScore ?? 2.6;
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

export const knowledgeIndex = new KnowledgeIndex(corpus.entries);
export const KNOWLEDGE_META = {
  totalEntries: corpus.totalEntries,
  generatedAt: corpus.generatedAt,
  canonicalSite: corpus.canonicalSite,
};
