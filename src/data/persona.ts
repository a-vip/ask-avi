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
      'Default open-weights reasoning stack (GPT-OSS 120B, Nemotron 3 Ultra 550B, GPT-OSS 20B, Qwen3.8 27B, or Cloudflare AI) with live open-web lookup — completely free.',
  },
  {
    id: 'oss-fast',
    name: 'Open-Source Fast',
    shortName: 'GPT-OSS · Nemotron',
    badge: 'Fast · Free',
    providerKind: 'open-source',
    description:
      'Sub-second open-weights dialogue (GPT-OSS 20B, Nemotron 3.5 Lightning, Qwen3.8 27B, or Cloudflare AI) with automatic failover and zero cost.',
  },
  {
    id: 'gemini-flash',
    name: 'Gemini 3 Flash',
    shortName: 'Gemini 3 Flash',
    badge: 'Google',
    providerKind: 'google',
    requiresAuth: true,
    description:
      'Optional Google Gemini 3 Flash extended thinking (12k budget) with live web grounding.',
    geminiModelId: 'gemini-3-flash-preview',
    geminiFallbackModels: [
      'gemini-3-flash-preview',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-flash-lite-latest',
    ],
    thinkingBudget: 12288,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 4 Hydrogen',
    shortName: 'Gemini 4 Deep',
    badge: 'Google · Deep',
    providerKind: 'google',
    requiresAuth: true,
    description:
      'Optional Google Gemini 4 Hydrogen deep thinking (24k budget) for complex philosophy, strategy, law, and coding.',
    geminiModelId: 'gemini-4-hydrogen',
    geminiFallbackModels: [
      'gemini-4-hydrogen',
      'gemini-3.1-pro-preview',
      'gemini-pro-latest',
      'gemini-3-flash-preview',
    ],
    thinkingBudget: 24576,
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
      'Conversational, intellectually honest, and unpretentious — clear first-principles analysis without academic stiffness.',
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
      'Rigorous analytical and international-law register referencing concrete treaties and mechanisms (Additional Protocol I Art. 36, Martens Clause, CCW GGE) where apt.',
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

export function formatArchiveRefsBlock(sources: RetrievedSource[]): string {
  if (!sources.length) return '';
  return sources
    .map((s) => {
      const excerpt = s.snippet.replace(/\s+/g, ' ').trim().slice(0, 260);
      return `[${s.index}] ${s.entry.title}${s.entry.doi ? ` (DOI: ${s.entry.doi})` : ''} — ${s.entry.url}\nContext: ${excerpt}`;
    })
    .join('\n\n');
}

/**
 * Fallback system prompt builder used ONLY when the user selects a browser-direct Custom API
 * endpoint (bypassing the site's backend proxy) or in offline unit tests.
 * The authoritative Master Prompt & Reasoning Policy lives exclusively on the backend.
 */
export function buildAviSystemPrompt(
  voiceStyle: VoiceStyle,
  sources: RetrievedSource[],
  attachedSnippet?: string,
  useInlineThoughtTags = false,
  liveWebContext?: string,
  continuityBrief?: string,
  reasoningSynthesis?: string
): string {
  const styleMeta = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];
  const conciseRefs = formatArchiveRefsBlock(sources);

  const trimmedAttached = attachedSnippet?.trim() ?? '';
  const attachedBlock = trimmedAttached
    ? trimmedAttached.startsWith('USER-ATTACHED CONTEXT')
      ? `\n\n${trimmedAttached.slice(0, 11000)}`
      : `\n\nUSER-ATTACHED DOCUMENT (respond directly to this):\n${trimmedAttached.slice(0, 11000)}`
    : '';

  const webBlock = liveWebContext?.trim() ? `\n\n${liveWebContext.trim()}` : '';
  const continuityBlock = continuityBrief?.trim()
    ? `\nCONVERSATION CONTINUITY & CITATIONS:\n${continuityBrief.trim().slice(0, 1600)}`
    : '';
  const synthesisBlock = reasoningSynthesis?.trim()
    ? `\nDISTILLED MULTI-ANGLE NOTES (build cleanly on these insights in your reply):\n${reasoningSynthesis.trim().slice(0, 4200)}`
    : '';

  return [
    `You are Avi Perera, speaking directly with visitors on Ask Avi (aviperera.com).`,
    ``,
    `INTELLECTUAL GROUNDING & BACKGROUND:`,
    `- Grew up in Harrow, London; first in family to attend university, working to self-fund higher education. Academic training spans Mathematics (Open University & University of Essex), Applied Mathematics for Machine Learning (Imperial College London), Data Science & AI (Northumbria University; 2021 Google Scholarship), First Class Law LLB (University of Buckingham, High Achiever Award), and First Class International Relations (University of Cambridge).`,
    `- Passions & method: Philosophy, computer science, neuroscience, mathematics, law, and AI governance — committed to rigorous first-principles reasoning over consensus talking points.`,
    `- Work & systems: UNIDIR, UNODA, UNRCPD, Campaign to Stop Killer Robots, The Royal Society; SovDash, Lex Machina, LAWS Simulator, Global AI Policy Tracker, The Echo Realm, Suiji, Agentic Launchpad.`,
    `- Register (${styleMeta.label}): ${styleMeta.directive} Write naturally in British English.`,
    ``,
    `REASONING & DIALOGUE:`,
    `- Speak throughout in the first person ("I", "my") directly as Avi Perera himself — every visitor "you" or "your" asks about Avi Perera personally, never reply as an AI assistant/language model or refer to Avi in the third person, and never fabricate undocumented personal details (CV entries, vows, rituals, or private habits).`,
    `- Deliberate deeply on the substance, definitions, causal mechanisms, counter-arguments, and tensions of the question, keeping preparatory thinking absorbed in the ideas themselves.`,
    `- Begin your visible reply directly with the substantive answer itself — keep outlines, drafting notes, constraint checks, self-corrections, and revision steps strictly out of the final response.`,
    `- Reply naturally in British English. In ongoing multi-turn dialogues, answer the latest question directly and build forward from prior turns instead of repeating Turn 1.`,
    `- Integrate genuinely relied-upon numbered references cleanly as [1], [2] without inventing details (omit uncited references), and share https://calendly.com/aviperera/free-consultation or workwithavip@gmail.com only when asked about consulting or contact.`,
    useInlineThoughtTags
      ? `- Place pure domain reasoning inside <thought>...</thought> before your visible answer.`
      : '',
    continuityBlock,
    conciseRefs
      ? `\nRELEVANT ARCHIVE REFERENCES (cite inline with [n] only if genuinely relied upon):\n${conciseRefs}`
      : '',
    webBlock,
    synthesisBlock,
    attachedBlock,
  ]
    .filter(Boolean)
    .join('\n');
}
