import type { EngineOption, RetrievedSource, VoiceStyle } from '../types/chat';

export const AVI_AVATAR_URL =
  'https://aviperera.com/wp-content/uploads/2024/09/Avi-Perera-website-aviperera.com-logo-welcome-to-my-website-friends-why-did-you-download-this-logo-100x100.png';

export const ENGINE_OPTIONS: EngineOption[] = [
  {
    id: 'webgpu-deep',
    name: 'Ask Avi · Neural Deep (3B)',
    shortName: 'Neural Deep 3B',
    badge: '~2.2 GB WebGPU',
    description:
      'Llama 3.2 3B running locally on your GPU via WebGPU. Default engine for thoughtful dialogue, philosophical nuance, and considered reasoning.',
    mlcModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    vramMB: 2264,
    requiresWebGPU: true,
  },
  {
    id: 'webgpu-balanced',
    name: 'Ask Avi · Neural Qwen (3B)',
    shortName: 'Neural Qwen 3B',
    badge: '~2.5 GB WebGPU',
    description:
      'Qwen 2.5 3B running locally on your GPU via WebGPU. Strongest for coding help, system design, and structured analytical breakdowns.',
    mlcModelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    vramMB: 2505,
    requiresWebGPU: true,
  },
  {
    id: 'webgpu-swift',
    name: 'Ask Avi · Neural Swift (1B)',
    shortName: 'Neural Swift 1B',
    badge: '~880 MB WebGPU',
    description:
      'Llama 3.2 1B running locally via WebGPU. Lighter download for faster startup on smaller GPUs.',
    mlcModelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    vramMB: 879,
    requiresWebGPU: true,
  },
  {
    id: 'instant',
    name: 'Ask Avi · Instant Archive',
    shortName: 'Instant Archive',
    badge: '0 MB Fallback',
    description:
      'Deterministic archive lookup across 108 published dossiers when WebGPU is unavailable or disabled.',
    requiresWebGPU: false,
  },
  {
    id: 'custom-api',
    name: 'Ask Avi · Custom Endpoint',
    shortName: 'Custom API',
    badge: 'BYOK / Local',
    description:
      'Connect your own OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Ollama) stored only in your browser.',
    requiresWebGPU: false,
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
      'Direct, unsentimental, and concise — cut straight to the underlying incentives, trade-offs, and what actually breaks in reality.',
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
      'Walk me through your core software builds — SovDash, Lex Machina, LAWS Simulator, Echo Realm, and Suiji.',
  },
  {
    id: 'sp-context',
    category: 'Essays & Society',
    title: 'The Trap of Context-Free Claims',
    prompt:
      'What do you mean by "linguistic superposition" in your essay The Wonderful World of Context?',
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
  if (hour < 5) return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function buildAviSystemPrompt(
  voiceStyle: VoiceStyle,
  sources: RetrievedSource[],
  attachedSnippet?: string
): string {
  const styleMeta = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];

  const conciseRefs = sources.length
    ? sources
        .map((s) => {
          const excerpt = s.snippet.replace(/\s+/g, ' ').trim().slice(0, 260);
          return `[${s.index}] ${s.entry.title}${s.entry.doi ? ` (DOI: ${s.entry.doi})` : ''}\nKey context: ${excerpt}`;
        })
        .join('\n\n')
    : '';

  const attachedBlock = attachedSnippet
    ? `\n\nUSER-ATTACHED DOCUMENT (respond directly to this if relevant):\n${attachedSnippet.slice(0, 1600)}`
    : '';

  return [
    `You are Ask Avi — the conversational AI persona of Avi Perera (British AI governance and International Humanitarian Law researcher, legal scholar, essayist, and founder of SovDash).`,
    ``,
    `WHO AVI IS & HOW HE THINKS:`,
    `- Identity & background: Grew up in Harrow, London (first in family to go to university; self-funded higher education by working); studied Law & International Studies (Buckingham) and International Relations / AI Governance (University of Cambridge); advises/researches with UNIDIR and Campaign to Stop Killer Robots; lives and works between London, Geneva, and Bangkok.`,
    `- Core mental models: Look for incentives rather than press releases; reject false binaries ("neither a techno-optimist nor an AI doomsayer — I am for accountability"); insist on context ("linguistic superposition"); prefer structural rules over voluntary PR; judge progress by real receipts over hype ("Achievement is a receipt. Confidence is weather", "Control is not a button; it is an architecture").`,
    `- Things Avi builds: SovDash (3D OSINT globe console at app.sovdash.com), Lex Machina (legal corpus & FastMCP server), LAWS Simulator (sim.sovdash.com), The Echo Realm (32-bit RPG), Suiji (Go/Weiqi AI dojo), Agentic Launchpad.`,
    `- Tone (${styleMeta.label}): ${styleMeta.directive} Use natural British English spelling (rigour, sceptical, analyse, organisation, normalised).`,
    ``,
    `HOW TO RESPOND CONVERSATIONALLY (CRITICAL):`,
    `1. Think briefly first inside <thought>...</thought> tags (2–4 crisp internal sentences): weigh what the user actually meant, identify any hidden nuance or flawed assumption, and plan a genuinely thoughtful, direct reply tailored to their exact prompt.`,
    `2. Outside </thought>, speak naturally as Avi in first-person dialogue. Engage directly with the user's question, idea, philosophical dilemma, or coding problem — NEVER regurgitate old essay summaries or stitch together boilerplate snippets.`,
    `3. On open-ended topics (coding help, philosophy, life decisions, architecture, current debates), reason from first principles and give a rich, considered answer or working code directly.`,
    `4. Only include inline [1], [2] citations when a reference below genuinely enriches or backs a point — never shoehorn links or mention essays the user didn't ask about. Never invent DOIs, URLs, or facts.`,
    `5. For direct advisory/consulting/speaking enquiries, share https://calendly.com/aviperera/free-consultation or workwithavip@gmail.com.`,
    conciseRefs ? `\nOPTIONAL REFERENCE LINKS FROM AVI'S ARCHIVE (use [1], [2] only if relevant):\n${conciseRefs}` : '',
    attachedBlock,
  ]
    .filter(Boolean)
    .join('\n');
}
