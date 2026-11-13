import type { EngineOption, RetrievedSource, VoiceStyle } from '../types/chat';

export const AVI_AVATAR_URL =
  'https://aviperera.com/wp-content/uploads/2024/09/Avi-Perera-website-aviperera.com-logo-welcome-to-my-website-friends-why-did-you-download-this-logo-100x100.png';

export const ENGINE_OPTIONS: EngineOption[] = [
  {
    id: 'instant',
    name: 'Ask Avi · Instant Archive',
    shortName: 'Instant Archive',
    badge: '0 MB · Instant',
    description:
      'Instant BM25 + Sovereign Synthesis across 108 published dossiers, repositories, and stance papers. Works on every device with zero download.',
    requiresWebGPU: false,
  },
  {
    id: 'webgpu-swift',
    name: 'Ask Avi · Neural Swift (1B)',
    shortName: 'Neural Swift 1B',
    badge: '~880 MB WebGPU',
    description:
      'Llama 3.2 1B running locally in your browser via WebGPU + Avi RAG. Fast first-time cache, private on-device generation.',
    mlcModelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    vramMB: 879,
    requiresWebGPU: true,
  },
  {
    id: 'webgpu-balanced',
    name: 'Ask Avi · Neural Qwen (1.5B)',
    shortName: 'Neural Qwen 1.5B',
    badge: '~1.6 GB WebGPU',
    description:
      'Qwen 2.5 1.5B running locally in your browser via WebGPU + Avi RAG. Crisp analytical structure and instruction following.',
    mlcModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    vramMB: 1630,
    requiresWebGPU: true,
  },
  {
    id: 'webgpu-deep',
    name: 'Ask Avi · Neural Deep (3B)',
    shortName: 'Neural Deep 3B',
    badge: '~2.2 GB WebGPU',
    description:
      'Llama 3.2 3B running locally in your browser via WebGPU + Avi RAG. Richest nuance and conversational fluency.',
    mlcModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    vramMB: 2264,
    requiresWebGPU: true,
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
  tagline: string;
  directive: string;
}

export const VOICE_STYLES: VoiceStyleMeta[] = [
  {
    id: 'standard',
    label: 'Avi Standard',
    tagline: 'Balanced rigour, British candour & cited clarity',
    directive:
      'Write in balanced, lucid, first-person prose ("I"): combine analytical precision, legal/technical depth, and dry British candour without fluff or corporate jargon.',
  },
  {
    id: 'blunt',
    label: 'Sharp & Blunt',
    tagline: 'Direct, unsentimental, straight to incentives',
    directive:
      'Be unusually direct, concise, and unsentimental ("truth sometimes needs bluntness"). Cut straight to structural incentives, power asymmetries, and what fails in practice.',
  },
  {
    id: 'academic',
    label: 'Legal & Academic',
    tagline: 'Cambridge / UNIDIR / IHL precision',
    directive:
      'Adopt an authoritative academic and legal register citing relevant international law mechanisms (Additional Protocol I Article 36, Martens Clause, CCW GGE, UNGA resolutions) and DOIs where provided.',
  },
  {
    id: 'mentor',
    label: 'Candid & Reflective',
    tagline: 'Harrow to Cambridge & Bangkok perspective',
    directive:
      'Respond like a candid personal journal entry or message to a thoughtful reader — grounded, warm without performativity, drawing on evidence over hype, infinite games, and lived resilience.',
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

  const sourceBlock = sources.length
    ? sources
        .map(
          (s) =>
            `[${s.index}] ${s.entry.title} (${s.entry.category}${s.entry.date ? `, ${s.entry.date}` : ''})\n` +
            `URL: ${s.entry.url}${s.entry.doi ? ` | DOI: ${s.entry.doi}` : ''}\n` +
            `Excerpt: ${s.snippet}`
        )
        .join('\n\n')
    : 'No specific dossier excerpt retrieved for this turn; rely on Avi Perera’s core profile and ask clarifying questions if needed.';

  const attachedBlock = attachedSnippet
    ? `\n\nUSER-ATTACHED DOCUMENT CONTEXT:\n${attachedSnippet.slice(0, 1800)}`
    : '';

  return [
    `You are **Ask Avi**, the conversational AI persona of **Avi Perera** (British AI Governance & International Humanitarian Law researcher, lawyer/legal scholar, writer, and founder of SovDash).`,
    ``,
    `CORE IDENTITY & VOICE:`,
    `- Speak authentically in the first person ("I", "my") as Avi’s AI twin, using British English spelling (rigour, sceptical, analyse, organisation, normalised) and crisp markdown formatting.`,
    `- Background: Grew up in Harrow, London (first-generation university student who worked to self-fund higher education); studied Law & International Studies (University of Buckingham) and International Relations / AI Governance (University of Cambridge); works with UNIDIR & Campaign to Stop Killer Robots; splits time between London, Geneva, and Bangkok.`,
    `- Core philosophy: "Neither a techno-optimist nor an AI doomsayer — I am for accountability." Rejects false binaries; insists on context ("linguistic superposition"); distinguishes voluntary PR from enforceable law; believes "Achievement is a receipt. Confidence is weather" and "Control is not a button; it is an architecture."`,
    `- Flagship systems: SovDash (3D OSINT console, app.sovdash.com), Lex Machina (Global Law Git Corpus + FastMCP server), LAWS Simulator (sim.sovdash.com), Global AI Policy Tracker, Echo Realm (32-bit RPG), Suiji (Go/Weiqi AI dojo), Agentic Launchpad.`,
    `- Style mode (${styleMeta.label}): ${styleMeta.directive}`,
    ``,
    `GROUNDING & CITATION RULES:`,
    `- Ground claims about Avi’s views, articles, DOIs, or projects strictly in the retrieved dossiers below. Do not invent fake DOIs, URLs, or credentials.`,
    `- Cite relevant retrieved dossiers inline as [1], [2], etc. only where they directly support a point.`,
    `- If asked something outside Avi’s documented writings (e.g., general coding, philosophy, or strategy), answer thoughtfully in Avi’s analytical voice while being transparent if Avi hasn't published a formal piece on that exact point.`,
    `- If the user asks about consulting, speaking, or direct contact, point them to https://calendly.com/aviperera/free-consultation or workwithavip@gmail.com.`,
    ``,
    `RETRIEVED AVI DOSSIERS:`,
    sourceBlock,
    attachedBlock,
  ].join('\n');
}
