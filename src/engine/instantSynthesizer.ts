import type { AttachedContext, RetrievedSource, VoiceStyle } from '../types/chat';

export interface SynthesisResult {
  markdown: string;
  followUps: string[];
}

const GREETING_RE =
  /^\s*(hi|hello|hey|hiya|yo|morning|afternoon|evening|good (morning|afternoon|evening)|who are you|what is ask avi|introduce yourself)\b[!?. ]*$/i;

const IDENTITY_RE =
  /\b(who (are|is) (you|avi)|tell me about (yourself|avi)|background|bio|biography|cambridge|harrow|buckingham)\b/i;

const CONSULTING_RE =
  /\b(consult|consulting|advis|hire|collaborat|book|calendly|contact|email|work with|launchpad|workshop)\b/i;

const PROJECTS_RE =
  /\b(projects?|github|repos?|built|building|sovdash|lex machina|echo realm|suiji|simulator|tracker)\b/i;

function trimSentences(text: string, maxChars = 420): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars);
  const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastPeriod > maxChars * 0.45) {
    return slice.slice(0, lastPeriod + 1);
  }
  return slice.replace(/\s+\S*$/, '') + '…';
}

function getStyleOpening(style: VoiceStyle, topicTitle: string): string {
  switch (style) {
    case 'blunt':
      return `Let’s strip away the noise around **${topicTitle}** and look at what the evidence and incentives actually show.`;
    case 'academic':
      return `Approaching **${topicTitle}** from an international law and governance standpoint requires separating normative rhetoric from enforceable structure.`;
    case 'mentor':
      return `This touches something I’ve written about quite candidly in **${topicTitle}** — and the short answer is less about polish and more about evidence.`;
    default:
      return `Here is how I think about this, drawing directly on my work in **${topicTitle}**.`;
  }
}

function getStyleClosing(style: VoiceStyle): string {
  switch (style) {
    case 'blunt':
      return `If a framework has no enforcement mechanism, no traceable human responsibility, and no cost for non-compliance, it isn’t governance — it’s PR.`;
    case 'academic':
      return `Ultimately, durable governance depends on translating these normative arguments into binding legal standards, pre-deployment review, and verifiable human accountability.`;
    case 'mentor':
      return `The thread running through all of this is simple: demand context, keep receipts of real evidence rather than noise, and build things that hold up under scrutiny.`;
    default:
      return `In short: context, structural accountability, and human judgement have to sit at the foundation — you cannot bolt them on after deployment.`;
  }
}

function buildFollowUps(sources: RetrievedSource[], query: string): string[] {
  const suggestions: string[] = [];
  const primaryCat = sources[0]?.entry.category ?? '';

  if (primaryCat === 'LAWS & IHL' || /\blaws|ihl|human control|weapon\b/i.test(query)) {
    suggestions.push('How does the Anticipatory Objection Registry work in practice?');
    suggestions.push('Why wasn’t the UN CCW GGE able to reach a binding treaty yet?');
  } else if (primaryCat === 'AI Governance') {
    suggestions.push('What binding corporate liability rules do you propose instead of voluntary pledges?');
    suggestions.push('How does Lex Machina track global AI laws like the EU AI Act?');
  } else if (primaryCat === 'OSINT & Projects') {
    suggestions.push('How do SovDash and Sovereign Intel Engine gather OSINT telemetry?');
    suggestions.push('Tell me about Suiji (Go) and The Echo Realm RPG.');
  } else {
    suggestions.push('What is your core stance on Artificial Intelligence?');
    suggestions.push('What does Meaningful Human Control mean in international law?');
  }

  if (sources[1]) {
    suggestions.push(`Tell me more about "${sources[1].entry.title.slice(0, 52)}${sources[1].entry.title.length > 52 ? '…' : ''}"`);
  } else {
    suggestions.push('How can someone collaborate or book a consultation with you?');
  }

  return suggestions.slice(0, 3);
}

export function synthesizeInstantAviReply(
  query: string,
  sources: RetrievedSource[],
  style: VoiceStyle,
  attachedContext?: AttachedContext
): SynthesisResult {
  // 1. Friendly greeting / intro
  if (GREETING_RE.test(query)) {
    return {
      markdown: [
        `Hello — I’m **Ask Avi**, the AI persona of **Avi Perera**.`,
        ``,
        `I’m a British AI governance and international humanitarian law (IHL) researcher, legal scholar, writer, and founder of **SovDash**, splitting time across London, Cambridge, Geneva, and Bangkok [1]. I also build open-source legal AI infrastructure (**Lex Machina**), disarmament simulators (**LAWS Simulator**), cognitive security games (**The Echo Realm**), and a Go learning dojo (**Suiji**) [2].`,
        ``,
        `You can ask me about:`,
        `- **Lethal Autonomous Weapons (LAWS)**, Article 36 reviews, and *Meaningful Human Control*`,
        `- **AI Governance & Regulation** (EU AI Act, UN CCW GGE, corporate liability)`,
        `- **My essays & philosophy** — imposter syndrome, context (*linguistic superposition*), finite vs infinite games, or life between London and Bangkok`,
        `- **Projects & advisory** — SovDash, Lex Machina, Agentic Launchpad, or consulting`,
        ``,
        `*Tip: You’re currently in **Instant Archive Mode** (0 MB download). You can also switch to a **Neural WebGPU** model in the top bar for open-ended, on-device LLM generation.*`,
      ].join('\n'),
      followUps: [
        'Where do you actually stand on AI regulation?',
        'What does Meaningful Human Control require under IHL?',
        'How do you deal with imposter syndrome?',
      ],
    };
  }

  // 2. Attached context discussion
  if (attachedContext && attachedContext.content.trim().length > 0) {
    const preview = trimSentences(attachedContext.content, 480);
    const topRef = sources[0];
    const parts = [
      `Looking at the attached note **${attachedContext.title}** alongside my own work:`,
      ``,
      `> ${preview}`,
      ``,
      topRef
        ? `From an Avi governance and systems lens — especially what I laid out in **${topRef.entry.title}** [${topRef.index}] — the decisive test here isn’t surface-level intent, it’s **traceable accountability and context**: ${trimSentences(topRef.entry.chunks[0] ?? topRef.entry.summary, 320)}`
        : `From an analytical and governance standpoint, the key questions to press on are **provenance, incentives, and accountability**: who benefits if the framing goes unchallenged, what contextual parameters are missing, and who bears responsibility if the system fails in practice?`,
      ``,
      `*Note: In **Instant Archive Mode**, I connect attached text against my indexed dossiers. Switch to **Neural Swift (1B)**, **Qwen (1.5B)**, or **Neural Deep (3B)** in the model selector above for full line-by-line LLM analysis of your attachment.*`,
    ];
    return {
      markdown: parts.join('\n'),
      followUps: [
        'Analyse the legal accountability gaps in this text.',
        'What questions should a critical reader ask about this?',
        'Which of your published dossiers relates most closely to this?',
      ],
    };
  }

  const topScore = sources[0]?.score ?? 0;

  // 3. Dedicated high-polish Identity / Consulting / Projects synthesis when matched
  if (IDENTITY_RE.test(query) && sources.length > 0) {
    const bio = sources.find((s) => s.entry.id === 'pillar-bio-identity') ?? sources[0];
    const wisdom = sources.find((s) => s.entry.id === 'pillar-personal-wisdom');
    const lines = [
      `I’m **Avi Perera** — a British researcher, legal scholar, writer, and systems builder working at the intersection of **artificial intelligence, international humanitarian law, and global security** [${bio.index}].`,
      ``,
      `A few things that actually define how I got here and how I work:`,
      `- **Non-linear path:** I grew up in Harrow, London, as the first in my family to attend university. Because we couldn’t afford it straight out of school, I worked and supported myself before studying Law and International Studies at the University of Buckingham and continuing academic research at the **University of Cambridge** [${bio.index}].`,
      `- **Policy & disarmament:** My work engages directly with the **UN / UNIDIR** (including presenting on Meaningful Human Control in Geneva) and the **Campaign to Stop Killer Robots** [${bio.index}].`,
      `- **What I build:** Beyond writing, I build practical systems — **SovDash** (a 3D OSINT globe console), **Lex Machina** (an AI-accessible legal Git corpus & MCP server), **LAWS Simulator**, **The Echo Realm**, and **Suiji** (a Go AI dojo).`,
      wisdom
        ? `- **How I think:** Having lived between London and Bangkok, I care deeply about evidence over noise (*"Achievement is a receipt. Confidence is weather"*), context, and intellectual sovereignty [${wisdom.index}].`
        : `- **How I think:** Having split time between London, Geneva, and Bangkok, I care deeply about evidence over theatre, rigorous context, and structural accountability.`,
    ];
    return {
      markdown: lines.join('\n'),
      followUps: buildFollowUps(sources, query),
    };
  }

  if (CONSULTING_RE.test(query) && topScore >= 2.0) {
    const adv = sources.find((s) => s.entry.id === 'pillar-consulting-advisory') ?? sources[0];
    return {
      markdown: [
        `I keep my advisory work deliberately narrow and independent — I don’t do vendor-captured checklists or post-hoc PR cover [${adv.index}].`,
        ``,
        `### Where I engage directly`,
        `1. **Lethal Autonomous Weapons & Defence Compliance:** Operationalising *Meaningful Human Control* (MHC), IHL Article 36 weapons review criteria, and structural risk frameworks.`,
        `2. **Global AI Regulation Strategy:** Mapping deployments across the EU AI Act, Council of Europe AI Convention (CETS No. 225), UNESCO, and UN frameworks.`,
        `3. **Institutional Governance & Algorithmic Audits:** Designing pre-deployment oversight and traceable accountability before systems ship.`,
        `4. **Builder & Team Capability:** Through **Agentic Launchpad** (*Command AI Agents That Build & Ship*) and the **AI Wave Scorecard**, I also run hands-on live cohorts and 1-on-1 build sprints [${adv.index}].`,
        ``,
        `If you’d like to discuss a specific briefing, audit, or collaboration, you can book directly via [Calendly](https://calendly.com/aviperera/free-consultation) or reach me at **workwithavip@gmail.com** / [aviperera.com/contact](https://aviperera.com/contact/).`,
      ].join('\n'),
      followUps: [
        'What is your methodology for AI governance audits?',
        'Tell me more about Agentic Launchpad and AI Wave.',
        'What is your position on director-level liability for AI harms?',
      ],
    };
  }

  if (PROJECTS_RE.test(query) && sources.some((s) => s.entry.category === 'OSINT & Projects')) {
    const proj = sources.find((s) => s.entry.id === 'pillar-flagship-projects') ?? sources[0];
    const labs = sources.find((s) => s.entry.id === 'pillar-interactive-labs');
    return {
      markdown: [
        `I tend to build software whenever writing an essay isn’t enough to make a structural dynamic visible [${proj.index}]. Here are the core systems in my ecosystem:`,
        ``,
        `- **SovDash (\`app.sovdash.com\`):** A 3D WebGL/CesiumJS geopolitical OSINT & threat-intelligence globe powered by my Python **Sovereign Intel Engine** for real-time ingestion and correlation [${proj.index}].`,
        `- **Lex Machina & Lex Machina Pro:** A self-updating Git corpus and **FastMCP** server breaking down major instruments (EU AI Act, GDPR, CoE CETS 225, UN CCW LAWS, Geneva Conventions, NIST AI RMF, China CAC rules) article by article so AI agents can query law with git-level provenance [${proj.index}].`,
        `- **LAWS Simulator (\`sim.sovdash.com\`):** An interactive targeting & IHL Article 36 simulation tool built for disarmament advocacy and the Campaign to Stop Killer Robots [${proj.index}].`,
        `- **Global AI Policy Tracker & Timeline:** Cartographic and chronological (1899–2030) explorers tracking binding treaties and national AI laws on \`aviperera.com\` [${proj.index}].`,
        labs
          ? `- **Cognitive Security & Strategy Labs:** **The Echo Realm** (a 32-bit action RPG on echo chambers & Socratic inoculation), **Echo Chamber Simulator**, **AI Connections**, and **Suiji (粋碁)** — a modern Go (*Weiqi/Baduk*) AI learning dojo [${labs.index}].`
          : `- **Evaluators & Infrastructure:** **Athena Voice Bot Evaluator**, **Academic Citation Sentinel**, **GEO Knowledge Sentinel**, **RankScope**, and **Site Health Verifier**.`,
      ].join('\n'),
      followUps: [
        'How does Lex Machina use Git commits to track legal provenance?',
        'Why did you build The Echo Realm as a 32-bit RPG?',
        'Tell me about Suiji and your Go learning dojo.',
      ],
    };
  }

  // 4. General strong RAG synthesis across top matched dossiers
  if (sources.length > 0 && topScore >= 2.2) {
    const primary = sources[0];
    const secondary = sources.slice(1, 3).filter((s) => s.score >= Math.max(1.8, topScore * 0.42));

    const bulletParts: string[] = [];
    const seenTexts = new Set<string>();

    const primaryChunks = primary.entry.chunks.slice(0, 2);
    for (const ch of primaryChunks) {
      const cleaned = trimSentences(ch, 390);
      if (!seenTexts.has(cleaned)) {
        seenTexts.add(cleaned);
        bulletParts.push(`${cleaned} [${primary.index}]`);
      }
    }

    for (const sec of secondary) {
      const ch = sec.entry.chunks[0] ?? sec.entry.summary;
      const cleaned = trimSentences(ch, 340);
      if (!seenTexts.has(cleaned)) {
        seenTexts.add(cleaned);
        bulletParts.push(`**${sec.entry.title}:** ${cleaned} [${sec.index}]`);
      }
    }

    const lines: string[] = [
      getStyleOpening(style, primary.entry.title),
      ``,
      ...bulletParts.map((b, i) => (i === 0 ? b : `- ${b}`)),
      ``,
      getStyleClosing(style),
    ];

    const dois = [primary, ...secondary].filter((s) => s.entry.doi);
    if (dois.length > 0) {
      lines.push(
        ``,
        `**Primary Reference${dois.length > 1 ? 's' : ''}:** ${dois
          .map((d) => `[${d.entry.title}](${d.entry.url}) (DOI: \`${d.entry.doi}\`)`)
          .join(' · ')}`
      );
    }

    return {
      markdown: lines.join('\n'),
      followUps: buildFollowUps(sources, query),
    };
  }

  // 5. Transparent out-of-corpus handling in Instant Mode
  const relatedHints =
    sources.length > 0
      ? `\n\nThe closest themes in my archive touch on:\n${sources
          .slice(0, 3)
          .map((s) => `- **${s.entry.title}** (${s.entry.category}) [${s.index}]`)
          .join('\n')}`
      : '';

  return {
    markdown: [
      `I want to be straight with you rather than bluff an answer: I’m currently running in **Instant Archive Mode** (0 MB, retrieval-based across Avi’s 108 published dossiers and repositories), and I don’t have a dedicated essay or codebase record that directly answers **"${query.slice(0, 120)}"**.`,
      relatedHints,
      ``,
      `If you’d like open-ended generative reasoning, coding help, or broader philosophical discussion in Avi’s voice, switch to **Neural Swift (1B)**, **Neural Qwen (1.5B)**, or **Neural Deep (3B)** in the model selector at the top — it runs privately via WebGPU right inside your browser with zero API keys.`,
    ]
      .filter(Boolean)
      .join('\n'),
    followUps: [
      'What is your stance on AI regulation and accountability?',
      'Explain Meaningful Human Control in autonomous weapons.',
      'Tell me about your journey from Harrow to Cambridge and Bangkok.',
    ],
  };
}
