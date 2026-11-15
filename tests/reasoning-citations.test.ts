import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleServerSystemPrompt } from '../shared/masterPrompt';
import {
  alignCitedSources,
  mergeCandidateSources,
  splitFormattedCandidateBlocks,
} from '../src/engine/citations';
import {
  buildFinalContinuityBrief,
  buildRichConversationWindow,
  extractFollowUpQueries,
  formatPlanForThinking,
  isTrivialOpeningGreeting,
  parsePlannerResult,
} from '../src/engine/deliberation';
import { knowledgeIndex } from '../src/engine/rag';
import { extractSearchKeywords, fetchTargetedWebResearch } from '../src/engine/webFallback';
import type { ChatMessage, RetrievedSource, WebSource } from '../src/types/chat';
import { sanitizeThinkingTrace } from '../src/utils/thinking';

function makeArchiveSource(id: string, title: string, url: string, score = 10): RetrievedSource {
  return {
    index: 1,
    score,
    matchedTerms: ['control'],
    snippet: `Excerpt from ${title}`,
    entry: {
      id,
      title,
      category: 'Essay',
      date: '2025',
      url,
      doi: '',
      keywords: [],
      summary: '',
      chunks: [],
    },
  };
}

describe('Deep Multi-Turn Reasoning, Targeted Research & Strict Citation Alignment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts concise domain keywords and expands short pronoun follow-ups with conversation hints', () => {
    const kw1 = extractSearchKeywords(
      'What draws you to thinkers like Spinoza when looking at modern technology, power, and human agency?'
    );
    expect(kw1).toContain('spinoza');
    expect(kw1).toContain('technology');
    expect(kw1).not.toContain('draws');

    const kwFollowUp = extractSearchKeywords(
      'Where does that fail?',
      'Additional Protocol I Article 36 weapons review accountability'
    );
    expect(kwFollowUp).toContain('fail');
    expect(kwFollowUp).toContain('article');
    expect(kwFollowUp).toContain('36');
    expect(extractSearchKeywords('hello!')).toBe('');
  });

  it('filters irrelevant/stub academic hits and retains relevant Wikipedia abstracts and OpenAlex works', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('en.wikipedia.org')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '10': {
                  index: 1,
                  title: 'Additional Protocol I Article 36',
                  fullurl: 'https://en.wikipedia.org/wiki/Protocol_I',
                  extract:
                    'Article 36 of Additional Protocol I obligates states to review new weapons and means of warfare for legality under international humanitarian law.',
                },
                '11': {
                  index: 2,
                  title: 'Isaac Newton',
                  fullurl: 'https://en.wikipedia.org/wiki/Isaac_Newton',
                  extract: 'English physicist and mathematician who formulated laws of motion.',
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('api.openalex.org')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Conclusion:',
                doi: 'https://doi.org/10.1000/junk-conclusion',
                publication_year: 2022,
                abstract_inverted_index: { Short: [0], note: [1] },
              },
              {
                title: 'Article 36 Weapons Reviews and Autonomous Systems',
                doi: 'https://doi.org/10.1093/jcsl/article36',
                publication_year: 2024,
                abstract_inverted_index: {
                  Legal: [0],
                  reviews: [1],
                  under: [2],
                  Article: [3],
                  '36': [4],
                  constrain: [5],
                  autonomous: [6],
                  weapons: [7],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const research = await fetchTargetedWebResearch(['Article 36 autonomous weapons review'], {
      maxSources: 5,
      timeoutMs: 3000,
    });

    expect(research.webSources.length).toBe(2);
    const titles = research.webSources.map((s) => s.title);
    expect(titles.some((t) => t.includes('Additional Protocol I Article 36'))).toBe(true);
    expect(titles.some((t) => t.includes('Article 36 Weapons Reviews and Autonomous Systems'))).toBe(true);
    expect(titles.some((t) => t.includes('Isaac Newton'))).toBe(false);
    expect(titles.some((t) => t.startsWith('Conclusion:'))).toBe(false);
    expect(research.contextBlock).toContain('Legal reviews under Article 36 constrain autonomous weapons');
  });

  it('merges candidates cleanly, strips uncited exploratory sources, re-indexes [1..K] 1:1, and skips code blocks', () => {
    const archive = [
      makeArchiveSource('a1', 'The Global Shell Game', 'https://aviperera.com/global-shell-game/'),
      makeArchiveSource('a2', 'Unused Archive Essay', 'https://aviperera.com/unused-essay/'),
    ];
    const web: WebSource[] = [
      { index: 1, title: 'Uncited Wikipedia Page', url: 'https://en.wikipedia.org/wiki/Uncited', snippet: 'Irrelevant background.' },
      { index: 2, title: 'Protocol I Commentary', url: 'https://ihl-databases.icrc.org/en/ihl-treaties/api-1977/article-36', snippet: 'Legal review obligation.' },
      // Duplicate URL of a1 should be deduplicated automatically
      { index: 3, title: 'Dup Essay', url: 'https://aviperera.com/global-shell-game/', snippet: 'Duplicate.' },
    ];

    const candidates = mergeCandidateSources(archive, web);
    expect(candidates.length).toBe(4); // a1=[1], a2=[2], web1=[3], web2=[4]

    const formatted = splitFormattedCandidateBlocks(candidates);
    expect(formatted.archiveBlock).toContain('[1] The Global Shell Game');
    expect(formatted.archiveBlock).toContain('[2] Unused Archive Essay');
    expect(formatted.webContext).toContain('[4] Protocol I Commentary');

    const rawAnswer = [
      'Relational agency meets legal thresholds [1, 4].',
      'Inline code `items[2]` and fenced blocks stay untouched:',
      '```ts',
      'const val = arr[3];',
      '```',
      'See [4] again for Article 36 duties.',
    ].join('\n');

    const aligned = alignCitedSources(rawAnswer, candidates, [
      { index: 99, title: 'Grounded Supplement', url: 'https://example.org/grounded' },
    ]);

    expect(aligned.sources.map((s) => ({ index: s.index, id: s.entry.id }))).toEqual([
      { index: 1, id: 'a1' },
    ]);
    expect(aligned.webSources.map((w) => ({ index: w.index, title: w.title }))).toEqual([
      { index: 2, title: 'Protocol I Commentary' },
      { index: 3, title: 'Grounded Supplement' },
    ]);
    expect(aligned.content).toContain('[1] [2].');
    expect(aligned.content).toContain('See [2] again');
    expect(aligned.content).toContain('`items[2]`');
    expect(aligned.content).toContain('const val = arr[3];');
  });

  it('retains prior turn attachments, Turn 1 anchor on overflow, planner JSON parsing, and clean thinking trace sanitization', () => {
    expect(isTrivialOpeningGreeting('Hello!', [])).toBe(true);
    expect(
      isTrivialOpeningGreeting('Okay', [{ id: '1', role: 'user', content: 'Hi', createdAt: 1 }])
    ).toBe(false);

    const longHistory: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Initial question about Spinoza and algorithmic determinism.',
        createdAt: 1,
        attachedContexts: [
          {
            id: 'ctx1',
            title: 'Draft Paper.pdf',
            content: 'Key thesis on causal accountability.',
            kind: 'pdf',
          },
        ],
      },
      { id: 'a1', role: 'assistant', content: 'Detailed opening analysis.', createdAt: 2 },
      { id: 'u2', role: 'user', content: 'Follow-up B '.repeat(40), createdAt: 3 },
      { id: 'a2', role: 'assistant', content: 'Follow-up reply B '.repeat(40), createdAt: 4 },
      { id: 'u3', role: 'user', content: 'Recent question on Article 36 limits.', createdAt: 5 },
      { id: 'a3', role: 'assistant', content: 'Recent reply on Article 36.', createdAt: 6 },
    ];

    // Window with small char cap trims oldest turns but injects Earlier dialogue context from Turn 1
    const compactWindow = buildRichConversationWindow(longHistory, 6, 1200);
    expect(compactWindow[0]?.content).toContain('Earlier dialogue context');
    expect(compactWindow[0]?.content).toContain('Spinoza and algorithmic determinism');

    // Window with full char budget keeps Turn 1 attachment summary inline
    const fullWindow = buildRichConversationWindow(longHistory, 10, 12000);
    expect(fullWindow[0]?.content).toContain('Previously attached pdf: "Draft Paper.pdf"');

    const parsedPlan = parsePlannerResult(
      '```json\n{"coreQuestion":"How does Article 36 handle opaque ML models?","conversationShift":"deepening","priorCommitments":"Relational power requires traceably constrained loops.","angles":["Legal indeterminacy","Verification costs"],"archiveQueries":["Article 36 LAWS"],"webQueries":["Article 36 weapon review"]}\n```',
      'And what about opacity?',
      longHistory
    );
    expect(parsedPlan.conversationShift).toBe('deepening');
    expect(parsedPlan.webQueries).toEqual(['Article 36 weapon review']);
    expect(formatPlanForThinking(parsedPlan, true)).toContain('Framing the follow-up (deepening)');

    const explore = extractFollowUpQueries(
      'Checking institutional incentives first.\nSEARCH_FOLLOWUP: ICRC Article 36 guide\n- SEARCH_FOLLOWUP: Spinoza conatus accountability\nFinal analytical note.'
    );
    expect(explore.followUpQueries).toEqual([
      'ICRC Article 36 guide',
      'Spinoza conatus accountability',
    ]);
    expect(explore.cleanAnalysis).not.toContain('SEARCH_FOLLOWUP');

    const brief = buildFinalContinuityBrief({
      plan: parsedPlan,
      isFollowUp: true,
      round2Analysis: explore.cleanAnalysis,
      round3Critique: 'Tested objection that formal reviews lag software updates.',
      hasCandidates: true,
    });
    expect(brief.continuityBrief).toContain('deepening');
    expect(brief.reasoningSynthesis).toContain('formal reviews lag software updates');

    const cleanedThinking = sanitizeThinkingTrace(
      'The user asks: how does this fail? Adopting a first-person voice per system instructions, I will write British English. Crucially, Article 36 requires pre-deployment legal evaluation of unintended effects.',
      true
    );
    expect(cleanedThinking).not.toMatch(/first-person voice|system instructions|The user asks/i);
    expect(cleanedThinking).toContain('Article 36 requires pre-deployment legal evaluation');
  });

  it('supports multiSearch across archive dossiers and separates deliberate vs final server system prompts', () => {
    const rag = knowledgeIndex.multiSearch(
      ['meaningful human control autonomous weapons', 'global shell game sovereignty'],
      { topK: 4, minScore: 4 }
    );
    expect(rag.sources.length).toBeGreaterThan(0);

    const deliberatePrompt = assembleServerSystemPrompt({
      phase: 'deliberate',
      voiceStyle: 'academic',
    });
    expect(deliberatePrompt).toContain('pure domain analysis');
    expect(deliberatePrompt).not.toContain('REGISTER:');

    const finalPrompt = assembleServerSystemPrompt({
      phase: 'final',
      voiceStyle: 'academic',
      continuityBrief: 'Ongoing dialogue shift (challenging): address Article 36.',
      reasoningSynthesis: 'Opposing incentives destabilise voluntary codes.',
      archiveBlock: '[1] The Global Shell Game',
      webContext: 'LIVE OPEN-WEB & ACADEMIC REFERENCES:\n[2] Protocol I',
    });
    expect(finalPrompt).toContain('CONVERSATION CONTINUITY & CITATIONS');
    expect(finalPrompt).toContain('INTERNAL WORKING NOTES');
    expect(finalPrompt).toContain('[1] The Global Shell Game');
    expect(finalPrompt).toContain('[2] Protocol I');
  });
});
