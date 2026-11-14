import type { EngineOption, RetrievedSource, VoiceStyle } from '../types/chat';

export const AVI_AVATAR_URL =
  'https://aviperera.com/wp-content/uploads/2024/09/Avi-Perera-website-aviperera.com-logo-welcome-to-my-website-friends-why-did-you-download-this-logo-100x100.png';

export const ENGINE_OPTIONS: EngineOption[] = [
  {
    id: 'oss-reasoning',
    name: 'Open-Source Reasoning',
    shortName: 'OSS Reasoning',
    badge: '100% Free',
    providerKind: 'open-source',
    description:
      'Default open-weights reasoning stack (GPT-OSS 120B, Nemotron 3 Ultra 550B, Qwen3.8 27B, Gemma 4 31B, or Cloudflare AI) with live open-web lookup — completely free.',
  },
  {
    id: 'oss-fast',
    name: 'Open-Source Fast',
    shortName: 'Qwen3.8 · GPT-OSS',
    badge: 'Fast · Free',
    providerKind: 'open-source',
    description:
      'Sub-second open-weights dialogue (Qwen3.8 27B, GPT-OSS 20B, Llama 4 Scout, or OpenRouter Free) with automatic failover and zero cost.',
  },
  {
    id: 'gemini-flash',
    name: 'Gemini 3 Flash',
    shortName: 'Gemini 3 Flash',
    badge: 'Google',
    providerKind: 'google',
    requiresAuth: true,
    description:
      'Optional Google Gemini 3 Flash extended thinking (8k budget) with live web grounding.',
    geminiModelId: 'gemini-3-flash-preview',
    geminiFallbackModels: [
      'gemini-3-flash-preview',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-flash-lite-latest',
    ],
    thinkingBudget: 8192,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 4 Hydrogen',
    shortName: 'Gemini 4 Deep',
    badge: 'Google · Deep',
    providerKind: 'google',
    requiresAuth: true,
    description:
      'Optional Google Gemini 4 Hydrogen deep thinking (16k budget) for complex philosophy, strategy, law, and coding.',
    geminiModelId: 'gemini-4-hydrogen',
    geminiFallbackModels: [
      'gemini-4-hydrogen',
      'gemini-3.1-pro-preview',
      'gemini-pro-latest',
      'gemini-3-flash-preview',
    ],
    thinkingBudget: 16384,
  },
  {
    id: 'custom-api',
    name: 'Custom API Endpoint',
    shortName: 'Custom API',
    badge: 'OpenAI / Local',
    providerKind: 'custom',
    description:
      'Override with any OpenAI-compatible URL (Ollama, LM Studio, Together, Cerebras, etc.) stored only in your browser.',
  },
];

export interface VoiceStyleMeta {
  id: VoiceStyle;
  label: string;
  directive: string;
}

export const VOICE_STYLES: VoiceStyleMeta[] = [
  {
    id: 'standard',
    label: 'Avi Standard',
    directive:
      'Conversational, intellectually honest, first-person ("I") prose with British spelling and clear, unpretentious logic.',
  },
  {
    id: 'blunt',
    label: 'Sharp & Blunt',
    directive:
      'Direct, unsentimental, and concise — cut straight to the underlying incentives, trade-offs, and what actually breaks in practice.',
  },
  {
    id: 'academic',
    label: 'Legal & Academic',
    directive:
      'Rigorous analytical and international-law register referencing concrete treaties, mechanisms (Additional Protocol I Art. 36, Martens Clause, CCW GGE), and empirical framing where apt.',
  },
  {
    id: 'mentor',
    label: 'Candid & Reflective',
    directive:
      'Warm, reflective, and grounded — speak honestly like a thoughtful conversation over coffee, valuing lived evidence over performative polish.',
  },
];

export interface StarterPrompt {
  id: string;
  category: string;
  title: string;
  prompt: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'sp-mhc',
    category: 'LAWS & IHL',
    title: 'Meaningful Human Control vs "Human in the Loop"',
    prompt:
      'What does Meaningful Human Control actually require, and why do you argue "human in the loop" often becomes a legal rubber stamp?',
  },
  {
    id: 'sp-stance',
    category: 'AI Governance',
    title: 'Why Voluntary AI Commitments Fail',
    prompt:
      'Where do you actually stand on AI regulation, and why do you say voluntary commitments are not governance?',
  },
  {
    id: 'sp-imposter',
    category: 'Philosophy & Life',
    title: 'From Imposter Syndrome to an Evidence Folder',
    prompt:
      'How do you deal with imposter syndrome when stepping into rooms like Cambridge or the UN from a non-traditional background?',
  },
  {
    id: 'sp-projects',
    category: 'Systems & Code',
    title: 'Inside SovDash, Lex Machina & Suiji',
    prompt:
      'Walk me through what pushed you to build SovDash, Lex Machina, and LAWS Simulator.',
  },
  {
    id: 'sp-context',
    category: 'AI Governance',
    title: 'The Trap of Context-Free Claims',
    prompt:
      'What do you mean by "linguistic superposition" in The Wonderful World of Context, and where do you see it happening today?',
  },
  {
    id: 'sp-philosophy',
    category: 'Philosophy & Life',
    title: 'First Principles: Spinoza to Institutional Design',
    prompt:
      'What draws you to thinkers like Spinoza when looking at modern technology, power, and human agency?',
  },
  {
    id: 'sp-code-review',
    category: 'Systems & Code',
    title: 'Architecture & Debugging Trade-offs',
    prompt:
      'How do you decide when to keep software architecture boring and verifiable versus building an autonomous agent workflow?',
  },
  {
    id: 'sp-art36',
    category: 'LAWS & IHL',
    title: 'Article 36 Weapons Reviews in the AI Era',
    prompt:
      'Why do legacy Article 36 legal reviews struggle with continuously learning software, and how would you redesign compliance?',
  },
  {
    id: 'sp-advisory',
    category: 'Advisory',
    title: 'Working With Avi on Governance or Agents',
    prompt:
      'What kinds of AI governance consulting, research collaborations, or Agentic Launchpad sprints do you take on?',
  },
];

export const VERIFIED_LINKS = [
  { label: 'aviperera.com', url: 'https://aviperera.com' },
  { label: 'Stance on AI', url: 'https://aviperera.com/stance/' },
  { label: 'Research & DOIs', url: 'https://aviperera.com/research/' },
  { label: 'SovDash Console', url: 'https://app.sovdash.com' },
  { label: 'GitHub (@a-vip)', url: 'https://github.com/a-vip' },
  { label: 'Book Consultation', url: 'https://calendly.com/aviperera/free-consultation' },
];

export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Burning the midnight oil?';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export function buildAviSystemPrompt(
  voiceStyle: VoiceStyle,
  sources: RetrievedSource[],
  attachedSnippet?: string,
  useInlineThoughtTags = false,
  liveWebContext?: string
): string {
  const styleMeta = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];

  const conciseRefs = sources.length
    ? sources
        .map((s) => {
          const excerpt = s.snippet.replace(/\s+/g, ' ').trim().slice(0, 260);
          return `[${s.index}] ${s.entry.title}${s.entry.doi ? ` (DOI: ${s.entry.doi})` : ''} — ${s.entry.url}\nContext: ${excerpt}`;
        })
        .join('\n\n')
    : '';

  const trimmedAttached = attachedSnippet?.trim() ?? '';
  const attachedBlock = trimmedAttached
    ? trimmedAttached.startsWith('USER-ATTACHED CONTEXT')
      ? `\n\n${trimmedAttached.slice(0, 11000)}`
      : `\n\nUSER-ATTACHED DOCUMENT (respond directly to this):\n${trimmedAttached.slice(0, 11000)}`
    : '';

  const webBlock = liveWebContext?.trim() ? `\n\n${liveWebContext.trim()}` : '';

  return [
    `You are Ask Avi — the conversational AI persona of Avi Perera (British AI governance and International Humanitarian Law researcher, legal scholar, essayist, and founder of SovDash).`,
    ``,
    `IDENTITY, BACKGROUND & WORLDVIEW:`,
    `- Background: Grew up in Harrow, London as the first in his family to attend university, working to self-fund higher education; studied Law & International Studies (University of Buckingham) and International Relations / AI Governance (University of Cambridge); researches & advocates with UNIDIR and the Campaign to Stop Killer Robots; splits time across London, Geneva, and Bangkok.`,
    `- Perspective: Reason from first principles. Inspect structural incentives rather than corporate/political press releases; reject false binaries ("Neither a techno-optimist nor an AI doomsayer — I am for accountability"); defend nuance and context ("linguistic superposition"); prefer enforceable law over voluntary pledges; judge by tangible evidence rather than status theatre ("Achievement is a receipt. Confidence is weather", "Control is not a button; it is an architecture").`,
    `- Things Avi builds: SovDash (3D WebGL geopolitical OSINT console at app.sovdash.com), Lex Machina (legal Git corpus + FastMCP server), LAWS Simulator (sim.sovdash.com), Global AI Policy Tracker, The Echo Realm (32-bit RPG), Suiji (Go/Weiqi AI dojo), Agentic Launchpad.`,
    `- Register (${styleMeta.label}): ${styleMeta.directive} Use natural British English spelling (rigour, sceptical, analyse, organisation, normalised).`,
    ``,
    `CONVERSATION PRINCIPLES (CRITICAL):`,
    `1. Think carefully and deeply before speaking: examine the user's actual question, unstated premise, edge cases, and practical tensions. Give a well-considered, nuanced, genuinely thoughtful answer.`,
    `2. Respond directly in first-person ("I") dialogue as an intelligent human interlocutor. NEVER regurgitate, copy, or mechanically stitch paragraphs from your old writings.`,
    `3. Embrace the full breadth of conversation: live world events, open-ended philosophical debates, software architecture & debugging, career trade-offs, geopolitics, law, or life — using live web search whenever current facts or external context matter.`,
    `4. When Avi archive references appear below, cite them inline ([1], [2]) ONLY if genuinely helpful and directly responsive to what the user asked — never shoehorn them into unrelated topics. Never fabricate DOIs, URLs, or credentials.`,
    `5. If someone specifically asks about consulting, briefings, or direct contact, point them to https://calendly.com/aviperera/free-consultation or workwithavip@gmail.com.`,
    useInlineThoughtTags
      ? `6. Structure your private scratchpad briefly inside <thought>...</thought> tags before your visible answer.`
      : '',
    conciseRefs
      ? `\nRELEVANT ARCHIVE LINKS BY AVI PERERA (reference [1], [2] only if directly helpful):\n${conciseRefs}`
      : '',
    webBlock,
    attachedBlock,
  ]
    .filter(Boolean)
    .join('\n');
}
