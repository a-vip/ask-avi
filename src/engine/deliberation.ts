import type { ChatMessage, ThinkingEffort, VoiceStyle } from '../types/chat';
import { extractSearchKeywords } from './webFallback';

export type QueryComplexityTier = 'fast-trivial' | 'focused-direct' | 'deep-deliberative';

export interface PlannerResult {
  coreQuestion: string;
  conversationShift: 'initial' | 'continuing' | 'challenging' | 'deepening' | 'pivoting';
  priorCommitments: string;
  angles: string[];
  archiveQueries: string[];
  webQueries: string[];
}

const TRIVIAL_GREETING_RE =
  /^(hi|hello|hey|hiya|yo|sup|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ok|okay|cheers)[!.,?\s]*$/i;

const HIGH_STAKES_SERIOUS_RE =
  /\b(lethal autonomous|autonomous weapons?|killer robots?|article\s*36|martens clause|international humanitarian law|\bihl\b|war crimes?|genocide|civilian harm|civilian casualties|targeting decisions?|lavender|gaza|ccw gge|criminal liability|director liability|personal crisis|suicide|self-harm|grief|bereavement)\b/i;

const DEEP_ANALYTICAL_RE =
  /\b(why|how|spinoza|conatus|law|legal|ihl|article|treaty|control|governance|regulation|compare|contrast|difference|diverge|critique|counter|tension|paradox|ethics|philosophy|religion|buddhist|belief|architecture|imposter|superposition|context|explain|analyse|analyze|evaluate|debate|argument)\b/i;

const FOCUSED_DIRECT_LOOKUP_RE =
  /\b(email|contact|calendly|orcid|wikidata|github|url|link|website|where (do|did) you (live|study|grow up)|what is your (email|name|role|website)|when were you|who founded sovdash)\b/i;

export function isHighStakesSeriousQuery(query: string): boolean {
  return HIGH_STAKES_SERIOUS_RE.test(query);
}

/**
 * Task-calibrated complexity classifier aligned with "Slow AI" HCI research (Tan et al., arXiv:2604.06183):
 * trivial openings stay instantaneous, direct factual/contact lookups take a concise focused route,
 * and substantive analytical/personal/legal questions receive full multi-pass deliberation.
 */
export function classifyQueryComplexity(
  query: string,
  history: ChatMessage[],
  hasAttachments = false
): { tier: QueryComplexityTier; isHighStakesSerious: boolean } {
  const isHighStakesSerious = isHighStakesSeriousQuery(query);
  if (isTrivialOpeningGreeting(query, history)) {
    return { tier: 'fast-trivial', isHighStakesSerious };
  }

  const trimmed = query.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (
    history.length === 0 &&
    !hasAttachments &&
    !isHighStakesSerious &&
    wordCount <= 11 &&
    trimmed.length <= 75 &&
    FOCUSED_DIRECT_LOOKUP_RE.test(trimmed) &&
    !DEEP_ANALYTICAL_RE.test(trimmed)
  ) {
    return { tier: 'focused-direct', isHighStakesSerious: false };
  }

  return { tier: 'deep-deliberative', isHighStakesSerious };
}

/**
 * Only truly bare opening greetings with zero prior turns bypass multi-pass deliberation.
 * Every substantive prompt and every follow-up turn goes through deep reasoning.
 */
export function isTrivialOpeningGreeting(query: string, history: ChatMessage[]): boolean {
  if (history.length > 0) return false;
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 28 && TRIVIAL_GREETING_RE.test(trimmed)) return true;
  return false;
}

function summarizeAttachmentsForTurn(msg: ChatMessage): string {
  const items =
    msg.attachedContexts && msg.attachedContexts.length > 0
      ? msg.attachedContexts
      : msg.attachedContext
        ? [msg.attachedContext]
        : [];
  if (items.length === 0) return '';
  const notes = items.map((ctx) => {
    const clean = ctx.content.replace(/\s+/g, ' ').trim().slice(0, 500);
    const origin = ctx.sourceUrl ? ` (${ctx.sourceUrl})` : '';
    return `[Previously attached ${ctx.kind ?? 'context'}: "${ctx.title}"${origin} — ${clean}]`;
  });
  return `\n${notes.join('\n')}`;
}

/**
 * Builds a structured multi-turn conversation window that retains Turn 1's anchor,
 * gives generous length budget to recent turns, and preserves prior turn attachments.
 */
export function buildRichConversationWindow(
  history: ChatMessage[],
  maxTurns: number,
  maxChars: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const valid = history.filter(
    (m) => !m.isStreaming && !m.needsBackendSetup && !m.needsAuth && m.content.trim().length > 0
  );
  if (valid.length === 0) return [];

  const sliced = valid.slice(-maxTurns);
  const mapped = sliced.map((m, idx) => {
    const isRecent = idx >= sliced.length - 2;
    const clipLimit = isRecent ? 4200 : 1800;
    const attachmentNote = m.role === 'user' ? summarizeAttachmentsForTurn(m) : '';
    return {
      role: m.role as 'user' | 'assistant',
      content: `${m.content.trim().slice(0, clipLimit)}${attachmentNote}`.trim(),
    };
  });

  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let budget = maxChars;
  let droppedStart = valid.length - sliced.length;

  for (let i = mapped.length - 1; i >= 0; i--) {
    const turn = mapped[i];
    if (out.length > 0 && turn.content.length > budget) {
      droppedStart += i + 1;
      break;
    }
    budget -= turn.content.length;
    out.unshift(turn);
  }

  // If very long conversation pushed earlier turns out of window, preserve Turn 1 topic summary
  if (droppedStart > 0 && valid.length > 2) {
    const firstUser = valid.find((m) => m.role === 'user')?.content.trim().slice(0, 260) ?? '';
    const firstAssist = valid.find((m) => m.role === 'assistant')?.content.trim().slice(0, 280) ?? '';
    if (firstUser && out[0]) {
      const recap = `[Earlier dialogue context (${droppedStart} prior message(s)): Initial topic "${firstUser}"${firstAssist ? ` — key opening point: "${firstAssist}..."` : ''}]`;
      out[0] = {
        role: out[0].role,
        content: `${recap}\n\n${out[0].content}`,
      };
    }
  }

  return out;
}

/**
 * Formats a concise, readable conversation transcript for planner and critic passes.
 */
export function buildContinuityTranscript(history: ChatMessage[], maxChars = 6500): string {
  const windowTurns = buildRichConversationWindow(history, 12, maxChars);
  if (windowTurns.length === 0) return '';
  return windowTurns
    .map((t, idx) => {
      const label = t.role === 'user' ? `Visitor (Turn ${Math.floor(idx / 2) + 1})` : `Previous Reply (Turn ${Math.floor(idx / 2) + 1})`;
      return `${label}: ${t.content.slice(0, 1400)}`;
    })
    .join('\n\n');
}

export function buildPass1PlanMessages(params: {
  query: string;
  history: ChatMessage[];
  attachedSummary?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const transcript = buildContinuityTranscript(params.history, 5500);
  const hasHistory = params.history.length > 0;

  return [
    {
      role: 'system',
      content: [
        'You are an analytical research planner preparing Avi Perera\'s first-principles deliberation for a visitor question on aviperera.com.',
        'IDENTITY BINDING: The visitor is addressing Avi Perera personally. Every second-person reference ("you", "your", "yourself") or implicit question ("what religion do you follow?", "what do you think?", "where did you study?") refers to Avi Perera — NEVER rewrite "you" as "the AI", "the assistant", or "the language model".',
        'Return ONLY valid JSON with these exact keys:',
        '{',
        '  "coreQuestion": "standalone restatement of what the visitor is asking right now, explicitly resolving \'you\'/\'your\' to Avi Perera personally and resolving pronouns/references against the prior conversation",',
        '  "conversationShift": "initial | continuing | challenging | deepening | pivoting",',
        '  "priorCommitments": "concise summary of what earlier turns already established so the reply advances without repeating them (empty string if initial)",',
        '  "angles": ["2 to 4 distinct analytical angles, counter-perspectives, or tensions examining both the subject matter and Avi Perera\'s documented perspective or philosophical lens"],',
        '  "archiveQueries": ["1 to 2 clean topical keyword phrases to search Avi Perera\'s writings, biography, and views (always populate when asking about Avi Perera\'s beliefs, life, background, work, or stance; e.g. \'buddhist belief philosophy\', \'biography cambridge bangkok\')"],',
        '  "webQueries": ["1 to 3 concise external factual/scholarly keyword queries (3-7 words, no conversational filler; use [] if purely about Avi Perera\'s personal life or personal beliefs unless external context adds value)"]',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        hasHistory
          ? `PRIOR CONVERSATION TRANSCRIPT:\n${transcript}\n`
          : 'CONVERSATION STATE: Opening turn (no prior history).\n',
        `LATEST USER MESSAGE:\n${params.query}`,
        params.attachedSummary ? `\nATTACHED MATERIALS OVERVIEW:\n${params.attachedSummary.slice(0, 1400)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function parsePlannerResult(
  rawText: string,
  fallbackQuery: string,
  history: ChatMessage[]
): PlannerResult {
  const fallbackKeywords = extractSearchKeywords(
    fallbackQuery,
    history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-2)
      .map((m) => m.content.slice(0, 220))
      .join(' ')
  );

  const fallback: PlannerResult = {
    coreQuestion: fallbackQuery.trim(),
    conversationShift: history.length > 0 ? 'continuing' : 'initial',
    priorCommitments: history.length > 0 ? 'Continue cleanly from established points without repeating Turn 1.' : '',
    angles: ['First-principles mechanisms & definitions', 'Incentives, edge cases & counter-arguments'],
    archiveQueries: fallbackKeywords ? [fallbackKeywords] : [],
    webQueries: fallbackKeywords ? [fallbackKeywords] : [],
  };

  if (!rawText.trim()) return fallback;

  try {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonCandidate = fenced ? fenced[1] : rawText;
    const braceStart = jsonCandidate.indexOf('{');
    const braceEnd = jsonCandidate.lastIndexOf('}');
    if (braceStart === -1 || braceEnd <= braceStart) return fallback;

    const parsed = JSON.parse(jsonCandidate.slice(braceStart, braceEnd + 1)) as Partial<PlannerResult>;
    const cleanArr = (arr: unknown, max: number): string[] =>
      Array.isArray(arr)
        ? arr
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120))
            .filter((s) => s.length >= 3)
            .slice(0, max)
        : [];

    const shiftVal =
      parsed.conversationShift === 'initial' ||
      parsed.conversationShift === 'continuing' ||
      parsed.conversationShift === 'challenging' ||
      parsed.conversationShift === 'deepening' ||
      parsed.conversationShift === 'pivoting'
        ? parsed.conversationShift
        : fallback.conversationShift;

    const webQueries = cleanArr(parsed.webQueries, 3);
    const archiveQueries = cleanArr(parsed.archiveQueries, 2);

    return {
      coreQuestion:
        typeof parsed.coreQuestion === 'string' && parsed.coreQuestion.trim().length > 4
          ? parsed.coreQuestion.trim().slice(0, 500)
          : fallback.coreQuestion,
      conversationShift: shiftVal,
      priorCommitments:
        typeof parsed.priorCommitments === 'string' ? parsed.priorCommitments.trim().slice(0, 700) : fallback.priorCommitments,
      angles: cleanArr(parsed.angles, 4).length > 0 ? cleanArr(parsed.angles, 4) : fallback.angles,
      archiveQueries: archiveQueries.length > 0 ? archiveQueries : fallback.archiveQueries,
      webQueries: webQueries.length > 0 ? webQueries : fallback.webQueries,
    };
  } catch {
    return fallback;
  }
}

export function formatPlanForThinking(plan: PlannerResult, isFollowUp: boolean): string {
  const lines: string[] = [];
  if (isFollowUp) {
    lines.push(`**Framing the follow-up (${plan.conversationShift})**: ${plan.coreQuestion}`);
    if (plan.priorCommitments) {
      lines.push(`**Prior thread state**: ${plan.priorCommitments}`);
    }
  } else {
    lines.push(`**Clarifying the core question**: ${plan.coreQuestion}`);
  }
  if (plan.angles.length > 0) {
    lines.push(`**Lines of inquiry**: ${plan.angles.join(' · ')}`);
  }
  return lines.join('\n\n');
}

export function buildPass2ExploreMessages(params: {
  plan: PlannerResult;
  query: string;
  history: ChatMessage[];
  candidatePoolBlock: string;
  attachedBlock?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const transcript = buildContinuityTranscript(params.history, 6000);
  const isFollowUp = params.history.length > 0;

  return [
    {
      role: 'system',
      content: [
        'Think through the question directly in the first person ("I", "my") as Avi Perera — an international lawyer and longstanding AI policy researcher — conducting a focused first-principles investigation.',
        'Unpack legal norms, definitions, causal mechanisms, and institutional incentives, compare disciplines where genuinely helpful, and interrogate the retrieved evidence carefully — especially your own essays, biography, and positions when the visitor asks about your views, beliefs, or background.',
        'STRICT NON-FABRICATION ON PERSONAL CLAIMS: State only biographical particulars, documents, practices, quotes, or credentials explicitly present in the retrieved archive snippets. Never extrapolate or invent undocumented personal details (such as what appears on forms, CVs, grant applications, religious vows, rituals, or private routines). Never say "I\'m not a lawyer", never underplay Avi as merely a developer, and never slip into third-person framing or generic AI-assistant disclaimers.',
        'Stay wholly absorbed in the substance of the ideas rather than mentioning writing rules, instructions, or self-descriptive character adjectives.',
        isFollowUp
          ? 'This is a continuing conversation: build directly on prior turns, identify what narrowed or shifted in the follow-up, and avoid restating Turn 1 basics.'
          : '',
        'If verifying an unresolved empirical detail, legal clause, thinker, or counter-evidence would materially strengthen the reasoning, add up to 2 lines at the very end formatted as:',
        'SEARCH_FOLLOWUP: <clean 3 to 6 word query>',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      role: 'user',
      content: [
        isFollowUp ? `CONVERSATION SO FAR:\n${transcript}\n` : '',
        `RESOLVED QUESTION FOCUS: ${params.plan.coreQuestion}`,
        `LATEST USER PROMPT: ${params.query}`,
        params.plan.priorCommitments ? `PRIOR THREAD ANCHORS: ${params.plan.priorCommitments}` : '',
        `ANGLES TO INTERROGATE:\n- ${params.plan.angles.join('\n- ')}`,
        params.candidatePoolBlock ? `\nRETRIEVED EVIDENCE POOL:\n${params.candidatePoolBlock}` : '',
        params.attachedBlock ? `\nUSER-PROVIDED CONTEXT:\n${params.attachedBlock.slice(0, 4000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export function extractFollowUpQueries(explorationText: string): {
  cleanAnalysis: string;
  followUpQueries: string[];
} {
  const queries: string[] = [];
  const keptLines: string[] = [];

  for (const line of explorationText.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?SEARCH_FOLLOWUP\s*:\s*(.+)$/i);
    if (match) {
      const q = match[1].replace(/[`"']/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      if (q.length >= 4 && queries.length < 2) {
        queries.push(q);
      }
    } else {
      keptLines.push(line);
    }
  }

  return {
    cleanAnalysis: keptLines.join('\n').trim(),
    followUpQueries: queries,
  };
}

export function buildPass3CritiqueMessages(params: {
  plan: PlannerResult;
  query: string;
  history: ChatMessage[];
  round2Analysis: string;
  candidatePoolBlock: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const transcript = buildContinuityTranscript(params.history, 6000);
  const isFollowUp = params.history.length > 0;

  return [
    {
      role: 'system',
      content: [
        'Stress-test this line of thought dialectically in the first person ("I", "my") as Avi Perera — an international lawyer and AI policy scholar — before replying.',
        'Stay absorbed purely in the substance, evidence, and conversation trajectory using clean working prose (zero stage numbers, rubric labels, self-descriptive traits, or instruction commentary).',
        'Examine critically:',
        '- Strongest counter-arguments, institutional edge cases, and where the initial thesis could break under pressure;',
        '- Any tensions or contradictions across retrieved writings/sources or prior claims in the thread;',
        '- First-person authenticity as Avi Perera — verify zero slide into third-person framing, "I am not a lawyer" disclaimers, or generic AI/language-model disclaimers, and flag/remove any extrapolated or unverified biographical claim (such as CV forms, grant applications, vows, rituals, or private habits) not explicitly present in retrieved evidence;',
        isFollowUp
          ? '- How to advance directly into the new question rather than repeating Turn 1 premises;'
          : '- Second-order mathematical, legal, or philosophical blind spots worth surfacing;',
        '- Which specific [n] references in the FULL CANDIDATE REFERENCE POOL genuinely substantiate key claims (never cite an index that does not exist in the pool).',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        isFollowUp ? `CONVERSATION HISTORY:\n${transcript}\n` : '',
        `RESOLVED QUESTION FOCUS: ${params.plan.coreQuestion}`,
        `LATEST USER PROMPT: ${params.query}`,
        `EXPLORATORY ANALYSIS:\n${params.round2Analysis.slice(0, 4200)}`,
        params.candidatePoolBlock ? `FULL CANDIDATE REFERENCE POOL:\n${params.candidatePoolBlock}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

function stripStageLabels(raw: string): string {
  return raw
    .replace(/^\s*(?:#{1,4}\s*|\*\*)?(?:Stage\s*\d+[^\n]*|Critical Synthesis)\*{0,2}\s*(?:---+\s*)?/gim, '')
    .trim();
}

export function buildFinalContinuityBrief(params: {
  plan: PlannerResult;
  isFollowUp: boolean;
  round2Analysis: string;
  round3Critique: string;
  hasCandidates: boolean;
  thinkingEffort?: ThinkingEffort;
  voiceStyle?: VoiceStyle;
  query?: string;
}): { continuityBrief: string; reasoningSynthesis: string } {
  const effort: ThinkingEffort =
    params.thinkingEffort ??
    (params.voiceStyle === 'academic' ? 'deep' : params.voiceStyle === 'mentor' ? 'medium' : 'fast');

  const continuityParts: string[] = [
    'Speak throughout in the first person ("I", "my") directly as Avi Perera — an international lawyer and longstanding AI policy researcher: every visitor "you" or "your" addresses Avi Perera personally — never reply in third person, NEVER say "I\'m not a lawyer" or give legal disclaimers, never reduce Avi to merely a developer, and never break character into an AI assistant/language model. State only personal facts documented in retrieved writings (never invent CVs, grant applications, vows, rituals, or unverified biographical claims) and cite only [n] numbers present in the numbered reference list.',
  ];
  if (effort === 'fast') {
    continuityParts.push(
      'RESPONSE SHAPE (Fast): Keep the answer crisp, focused, and concise (2 to 4 tight paragraphs unless asked for exhaustive detail) — get straight to the core insight without multi-section essay sprawl.'
    );
  } else if (effort === 'medium') {
    continuityParts.push(
      'RESPONSE SHAPE (Medium): Deliver a well-structured, balanced analysis (roughly 3 to 6 paragraphs) weighing core mechanisms, legal stakes, and main counter-arguments cleanly.'
    );
  } else {
    continuityParts.push(
      'RESPONSE SHAPE (Deep Reasoning): Deliver an exhaustive, deeply reasoned synthesis weaving together legal architecture, philosophical first principles, systems mechanics, and strongest counter-arguments.'
    );
  }
  const enforceSeriousRegister =
    effort === 'deep' ||
    params.voiceStyle === 'academic' ||
    params.voiceStyle === 'blunt' ||
    (params.query ? isHighStakesSeriousQuery(params.query) : false);
  if (enforceSeriousRegister) {
    continuityParts.push(
      'REGISTER GUARDRAIL: Maintain rigorous, measured analytical and legal gravitas — zero jokes, playful quips, or levity.'
    );
  }
  if (params.isFollowUp) {
    continuityParts.push(
      `Ongoing dialogue shift (${params.plan.conversationShift}): "${params.plan.coreQuestion}".`
    );
    if (params.plan.priorCommitments) {
      continuityParts.push(
        `Already established in earlier turns (build forward without repeating): ${params.plan.priorCommitments}`
      );
    }
    continuityParts.push(
      'Open directly on the user’s latest question and carry the thread forward rather than restarting earlier summaries.'
    );
  }
  if (params.hasCandidates) {
    continuityParts.push(
      'Use inline [n] citations matching ONLY the numbered references you genuinely rely upon; omit [n] for sources not used.'
    );
  }

  const synthesisSections: string[] = [];
  const clean2 = stripStageLabels(params.round2Analysis);
  const clean3 = stripStageLabels(params.round3Critique);
  if (clean2) synthesisSections.push(clean2.slice(0, 2600));
  if (clean3) synthesisSections.push(clean3.slice(0, 2400));

  return {
    continuityBrief: continuityParts.join(' '),
    reasoningSynthesis: synthesisSections.join('\n\n').slice(0, 4600),
  };
}
