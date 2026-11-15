import type { ChatMessage } from '../types/chat';
import { extractSearchKeywords } from './webFallback';

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
        'You are an analytical research planner decomposing a user question before deep multi-step reasoning begins.',
        'Return ONLY valid JSON with these exact keys:',
        '{',
        '  "coreQuestion": "standalone restatement of what the user is asking right now, explicitly resolving pronouns/references against the prior conversation",',
        '  "conversationShift": "initial | continuing | challenging | deepening | pivoting",',
        '  "priorCommitments": "concise summary of what earlier turns already established so the reply advances without repeating them (empty string if initial)",',
        '  "angles": ["2 to 4 distinct analytical angles, counter-perspectives, or tensions to examine"],',
        '  "archiveQueries": ["1 to 2 clean search phrases for Avi Perera writings/projects if topically relevant, else empty array"],',
        '  "webQueries": ["1 to 3 concise factual/scholarly keyword queries (3-7 words, no conversational filler)"]',
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
        'Conduct focused first-principles investigation on the subject matter itself.',
        'Unpack definitions, trace causal mechanisms and institutional incentives, compare disciplines where genuinely helpful, and interrogate the retrieved evidence carefully.',
        'Do NOT label sections "Stage 1/2/3" and do NOT mention formatting rules, personas, prompts, spelling, or output instructions — immerse wholly in the ideas.',
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
        'Engage in rigorous dialectical stress-testing before replying.',
        'Examine only the substance, evidence, and conversation trajectory — zero stage labels ("Stage 2", "Stage 3"), zero rubric headers, and zero meta-chatter about prompts or writing style.',
        'Weigh concisely in clean prose notes:',
        '- Strongest counter-arguments, institutional edge cases, and where the initial thesis could break under pressure;',
        '- Any tensions or contradictions across retrieved sources or prior claims in the thread;',
        isFollowUp
          ? '- How to advance directly into the new question rather than repeating Turn 1 premises;'
          : '- Second-order mathematical, legal, or practical blind spots worth surfacing;',
        '- Which specific [n] references genuinely substantiate key claims versus tangential ones to exclude.',
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
}): { continuityBrief: string; reasoningSynthesis: string } {
  const continuityParts: string[] = [];
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
