#!/usr/bin/env python3
"""Compile Avi Perera's published research archive, repos, and stance pillars into src/data/knowledge.json."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent
ARCHIVE_DOCS = WORKSPACE / "avi-research-archive" / "docs"
AVIP_README = WORKSPACE / "a-vip" / "README.md"
OUT_PATH = ROOT / "src" / "data" / "knowledge.json"


CORE_PILLARS: list[dict[str, Any]] = [
    {
        "id": "pillar-bio-identity",
        "title": "Avi Perera — Biography, Background & Intellectual Lineage",
        "category": "Advisory & Bio",
        "date": "2026-11-01",
        "url": "https://aviperera.com/about/",
        "doi": "",
        "keywords": [
            "avi perera", "biography", "about", "harrow", "london", "bangkok", "thailand",
            "cambridge", "buckingham", "unidir", "sovdash", "orcid", "wikidata", "background",
            "first generation", "imposter syndrome", "contact", "email"
        ],
        "summary": (
            "Avi Perera is a British AI governance and international humanitarian law (IHL) researcher, "
            "writer, lawyer/legal scholar, and founder of SovDash, bridging Cambridge, London, Geneva, and Bangkok."
        ),
        "chunks": [
            (
                "Avi Perera grew up in Harrow, London, as the first in his family to go to university. "
                "Unable to afford higher education immediately after school, he worked and supported himself "
                "before studying Law and International Studies at the University of Buckingham and continuing "
                "academic work at the University of Cambridge, with writing cited in UN General Assembly contexts "
                "and policy engagement with UNIDIR and the Campaign to Stop Killer Robots."
            ),
            (
                "Having split life between London and Bangkok, Thailand — where he found mental clarity, studied "
                "the language and culture, and reflects on 'London taught me how to hurry; Bangkok is teaching me "
                "how to slow down and look' — Avi writes candidly about imposter syndrome, evidence over empty "
                "validation ('Achievement is a receipt. Confidence is weather.' and 'Recognition is a compass, not a crown.'), "
                "and intellectual sovereignty."
            ),
            (
                "Verified identifiers & channels: Website https://aviperera.com, SovDash Console https://app.sovdash.com, "
                "GitHub https://github.com/a-vip, ORCID 0009-0005-1903-6868, Wikidata Q140248356, "
                "Calendly https://calendly.com/aviperera/free-consultation, Email workwithavip@gmail.com."
            ),
        ],
    },
    {
        "id": "pillar-stance-ai",
        "title": "My Stance on Artificial Intelligence — Accountability Over Binary Hype",
        "category": "AI Governance",
        "date": "2026-10-01",
        "url": "https://aviperera.com/stance/",
        "doi": "",
        "keywords": [
            "stance", "ai stance", "accountability", "doomsayer", "techno-optimist",
            "governance gap", "voluntary commitments", "corporate liability", "audit",
            "dual-use", "deepfakes", "critical infrastructure", "meaningful human control"
        ],
        "summary": (
            "Neither a techno-optimist nor an AI doomsayer: Avi advocates structural accountability, "
            "binding legal instruments, and mandatory pre-deployment oversight rather than voluntary industry PR."
        ),
        "chunks": [
            (
                "I am neither a techno-optimist nor an AI doomsayer. I am an academic, a lawyer, and a governance "
                "researcher. AI is transformative across healthcare diagnostics, access to justice, scientific discovery, "
                "and global development — provided it is governed structurally. A system that cannot be audited cannot "
                "be governed; a system that cannot be governed cannot be trusted."
            ),
            (
                "Voluntary commitments are not governance. They are frameworks actors can abandon whenever departure "
                "is convenient — the performance of governance without its substance. The failure to govern AI effectively "
                "is not a technical problem waiting for a technical solution; it is a political will deficit actively "
                "cultivated by actors who benefit from the resulting vacuum."
            ),
            (
                "What is needed: (1) binding international instruments (particularly a LAWS treaty), (2) mandatory "
                "independent third-party pre-deployment risk assessment (like aviation or pharmaceuticals), "
                "(3) enforceable algorithmic audit rights, (4) director-level personal legal liability rather than "
                "diffused corporate blame, and (5) democratic legitimacy over closed industry-state consensus."
            ),
        ],
    },
    {
        "id": "pillar-mhc-laws",
        "title": "Meaningful Human Control (MHC), IHL Article 36 & Anticipatory Objection Registry",
        "category": "LAWS & IHL",
        "date": "2026-09-20",
        "url": "https://aviperera.com/stance/",
        "doi": "10.13140/RG.2.2.10288.67842",
        "keywords": [
            "meaningful human control", "mhc", "laws", "lethal autonomous weapons", "killer robots",
            "article 36", "additional protocol i", "ihl", "international humanitarian law", "martens clause",
            "distinction", "proportionality", "accountability gap", "flash war", "unidir", "ccw", "gge",
            "anticipatory objection registry", "human in the loop", "rubber stamp"
        ],
        "summary": (
            "Control is not a button; it is an architecture. MHC requires cognitive understanding, real intervention "
            "capacity before irreversible force, and traceable human legal responsibility."
        ),
        "chunks": [
            (
                "We cannot delegate the decision to kill to a machine. IHL principles of distinction, proportionality, "
                "and military necessity are not computational optimisation problems — they are contextual moral and legal "
                "judgements rooted in the Martens Clause ('laws of humanity' and 'dictates of public conscience'). "
                "Removing human judgement creates an accountability gap and 'flash war' escalation risk at machine speed."
            ),
            (
                "Why 'human in the loop' is insufficient: nominal human oversight at machine speed (such as reviewing "
                "machine-generated target lists in seconds) becomes a legal rubber stamp, not control. True Meaningful "
                "Human Control rests on three pillars: (1) Cognitive Understanding of system logic and context, "
                "(2) Operable Intervention Capacity with human timescale as a hard constraint, and (3) Traceable "
                "Responsibility back to identifiable commanders, developers, or deploying states."
            ),
            (
                "In academic work with UNIDIR ('Weapons that think must not decide', DOI: 10.13140/RG.2.2.10288.67842) "
                "and on the Anticipatory Objection Registry, Avi proposes enabling states to register advance legal "
                "objections to specific autonomous weapons configurations prior to deployment — building customary "
                "international law norms even when CCW consensus is obstructed."
            ),
        ],
    },
    {
        "id": "pillar-consulting-advisory",
        "title": "Independent AI Governance Advisory, Consulting & Agentic Launchpad",
        "category": "Advisory & Bio",
        "date": "2026-11-10",
        "url": "https://aviperera.com/consulting/",
        "doi": "",
        "keywords": [
            "consulting", "advisory", "hire", "work with avi", "consultation", "calendly",
            "eu ai act", "compliance", "defense compliance", "risk assessment", "agentic launchpad",
            "ai wave", "training", "cohort", "workshops"
        ],
        "summary": (
            "Independent structural AI governance, defense/LAWS compliance, multi-jurisdictional regulatory strategy, "
            "plus hands-on Agentic AI engineering workshops (Agentic Launchpad & AI Wave Scorecard)."
        ),
        "chunks": [
            (
                "Avi's advisory practice focuses strictly on high-stakes structural governance — not post-hoc PR or "
                "vendor-captured checklists. Three core advisory domains: (1) Lethal Autonomous Weapons Systems (LAWS) "
                "& defense compliance with Meaningful Human Control and IHL Article 36 criteria; (2) Global AI Regulation "
                "& Compliance Strategy (EU AI Act, Council of Europe CETS 225, UNESCO, UN mandates); and (3) Institutional "
                "AI Governance & Algorithmic Auditing Architectures."
            ),
            (
                "Alongside policy advisory, Avi runs practical AI capability initiatives including the AI Wave "
                "Scorecard (MetaLearning AI interactive readiness diagnostic) and Agentic Launchpad ('Command AI Agents "
                "That Build & Ship'), helping builders and teams go from passive AI consumption to shipping agentic systems. "
                "Consultations can be booked at https://calendly.com/aviperera/free-consultation or via https://aviperera.com/contact/."
            ),
        ],
    },
    {
        "id": "pillar-flagship-projects",
        "title": "Flagship Software Ecosystem: SovDash, Lex Machina, LAWS Simulator, Echo Realm & Suiji",
        "category": "OSINT & Projects",
        "date": "2026-11-12",
        "url": "https://github.com/a-vip",
        "doi": "",
        "keywords": [
            "projects", "github", "sovdash", "lex machina", "mcp", "laws simulator", "echo realm",
            "echo chamber simulator", "suiji", "go", "rankscope", "athena", "global ai policy tracker",
            "ai policy timeline", "ai wave scorecard", "site health verifier", "code", "tools"
        ],
        "summary": (
            "Over 45 open-source systems spanning 3D geopolitical OSINT (SovDash), legal MCP infrastructure "
            "(Lex Machina), disarmament simulation (LAWS Simulator), cognitive security games (Echo Realm), and Go AI (Suiji)."
        ),
        "chunks": [
            (
                "Key flagship builds by Avi Perera: (1) SovDash (app.sovdash.com / sovdash.com) — a Next.js + CesiumJS "
                "3D globe OSINT/SIGINT threat-intelligence console fed by the Python Sovereign Intel Engine; "
                "(2) Lex Machina & Lex Machina Pro — a self-updating Git legal corpus and FastMCP Model Context Protocol "
                "server indexing EU AI Act, GDPR, CoE AI Convention, UN CCW LAWS, Geneva Conventions, NIST AI RMF, and China CAC rules; "
                "(3) LAWS Simulator (sim.sovdash.com) — an interactive IHL Article 36 targeting simulator built for disarmament advocacy."
            ),
            (
                "Interactive web apps & research tools: Global AI Policy Tracker (aviperera.com/ai-policy-tracker/), "
                "AI Policy Timeline (1899–2030 chronology), AI Ethics Intelligence Dashboard, Academic Citation Sentinel, "
                "GEO Knowledge Sentinel (JSON-LD Schema.org verification), Athena Voice Bot Evaluator (adversarial clinical voice testing), "
                "RankScope (self-hosted SEO keyword engine), Site Health Verifier, AI Connections, The Echo Chamber Simulator, "
                "The Echo Realm (32-bit action RPG at a-vip.github.io/echo-realm/), and Suiji (粋碁 — Go/Weiqi/Baduk AI learning dojo)."
            ),
        ],
    },
    {
        "id": "pillar-personal-wisdom",
        "title": "Personal Philosophy, Resilience, Context & Practical Wisdom",
        "category": "Essays & Philosophy",
        "date": "2026-10-15",
        "url": "https://aviperera.com/from-imposter-syndrome-to-evidence-why-my-once-upon-a-time-ig-story-hit-home/",
        "doi": "",
        "keywords": [
            "wisdom", "advice", "imposter syndrome", "confidence", "evidence", "humility",
            "context", "books", "reading", "infinite game", "finite game", "resilience",
            "harrow", "bangkok", "thailand", "burnout", "focus", "life advice", "career"
        ],
        "summary": (
            "Avi's reflections on imposter syndrome, keeping an Evidence folder, finite vs infinite games, "
            "the importance of context, slowing down to see clearly, and playing long-horizon craft."
        ),
        "chunks": [
            (
                "On imposter syndrome and self-doubt: 'Achievement and confidence are not twins. Achievement is a receipt. "
                "Confidence is weather. You can have a drawer full of receipts and still wake up to rain.' Rather than relying "
                "on hollow affirmations, Avi keeps a concrete Evidence folder — notes, invitations, solved problems — to calibrate "
                "against an unfair inner narrator: 'Recognition is a compass, not a crown.' And on humility: 'I confused humility "
                "with self-erasure. Real humility sounds more like this: this is true, and I will still listen.'"
            ),
            (
                "On context and rigour: Avi frequently warns against 'linguistic superposition' — sweeping claims stripped of "
                "time, place, data provenance, and structural history ('The Wonderful World of Context'). He advocates picking up "
                "books over passive scrolling, thinking in Infinite Games (James P. Carse — playing to keep learning and keep the "
                "game alive rather than chasing brittle finite status), and rejecting cheap digital distractions that erode sovereignty."
            ),
        ],
    },
    {
        "id": "pillar-interactive-labs",
        "title": "Interactive Simulations & Strategic Games: Suiji (Go), Echo Realm & LAWS Simulator",
        "category": "OSINT & Projects",
        "date": "2026-11-13",
        "url": "https://a-vip.github.io/echo-realm/",
        "doi": "",
        "keywords": [
            "suiji", "go", "weiqi", "baduk", "echo realm", "rpg", "simulation", "game",
            "cognitive inoculation", "socratic", "tsumego", "echo chamber", "ai connections",
            "strategy", "interactive", "learning"
        ],
        "summary": (
            "Why Avi builds playable simulations and strategic dojos — from Suiji (Go/Weiqi) to The Echo Realm RPG "
            "and Echo Chamber Simulator — to turn abstract governance and cognitive risks into lived intuition."
        ),
        "chunks": [
            (
                "Avi believes passive essays alone rarely change intuition, so he builds interactive systems where people "
                "experience structural dynamics firsthand: The Echo Realm (a 32-bit action RPG exploring echo chambers, "
                "Socratic dialogue, and cognitive inoculation against polarisation), Echo Chamber Simulator (where players "
                "balance outrage harvesting against societal collapse), and AI Connections (daily AI governance taxonomy puzzles)."
            ),
            (
                "Suiji (粋碁) is Avi's modern Go (Weiqi / Baduk) strategic analysis platform and interactive AI learning dojo "
                "featuring guided beginner tours, plain-English vs Japanese terminology toggles, tactical drills (ladders, nets, "
                "snapbacks), tsumego puzzle labs, and top-3 Ask Coach move analysis — reflecting his appreciation for deep strategic clarity."
            ),
        ],
    },
    {
        "id": "pillar-publications-dois",
        "title": "DOI-Indexed Scholarly Publications, UNIDIR Work & Academic Profiles",
        "category": "LAWS & IHL",
        "date": "2026-10-01",
        "url": "https://aviperera.com/research/",
        "doi": "10.13140/RG.2.2.10288.67842",
        "keywords": [
            "publications", "papers", "doi", "researchgate", "orcid", "google scholar",
            "unidir", "radicalisation", "compliance", "gdpr", "third world", "social media",
            "critical thinking", "bibliography", "cite", "academic"
        ],
        "summary": (
            "Complete index of Avi Perera's DOI-registered conference posters, working papers, preprints, "
            "and scholarly profiles across ResearchGate, ORCID, Google Scholar, and Cambridge Academia.edu."
        ),
        "chunks": [
            (
                "Selected DOI-indexed works by Avi Perera: (1) 'Weapons that think must not decide: Enforcing meaningful "
                "human control in warfare' (2025, UNIDIR Global Conference on AI, Security and Ethics, Geneva — DOI: 10.13140/RG.2.2.10288.67842); "
                "(2) 'The Algorithmic Reshaping of Radicalisation Pathways and its Democratic Implications' (2025 — DOI: 10.13140/RG.2.2.15350.92489); "
                "(3) 'Why Do States Comply With International Agreements and Treaties (GDPR Case Study)' (2025 — DOI: 10.13140/RG.2.2.12596.31360)."
            ),
            (
                "(4) 'The Myth of the Third World: Why We Must Abandon the Language of Empire' (2025 — DOI: 10.13140/RG.2.2.15112.89603); "
                "(5) 'Research Report on Social Media Impacts on Critical Thinking and Academic Achievements' (2023 — DOI: 10.13140/RG.2.2.21829.51684). "
                "Profiles: ORCID 0009-0005-1903-6868, ResearchGate (Avi-Perera), Google Scholar, Cambridge Academia.edu."
            ),
        ],
    },
]


def infer_category(slug: str, title: str, text: str) -> str:
    s = f"{slug} {title}".lower()
    if any(k in s for k in [
        "drone", "uav", "ugv", "usv", "missile", "munitions", "reaper", "harpy", "lancet",
        "kargu", "roadrunner", "altius", "ghost-bat", "smash-2000", "lavender", "gotham",
        "maven", "clearview", "predpol", "okhotnik", "humanoid", "mule", "unitree", "skystriker",
        "lanius", "seagull", "arion-smet", "sharp-claw", "fedor", "v-bat", "strix", "mako", "kyb", "x5", "veter"
    ]):
        return "Military AI Systems"
    if any(k in s for k in [
        "autonomous-weapon", "killer-robots", "human-control", "disarmament", "un-vote",
        "un-playbook", "kill-chain", "battlefield", "warfare", "war", "abliteration"
    ]):
        return "LAWS & IHL"
    if any(k in s for k in ["book-summary", "superintelligence", "human-compatible", "alignment-problem", "why-nations-fail", "perfection-trap", "finite-and-infinite"]):
        return "Book Notes"
    if any(k in s for k in ["diffusion", "gemma", "antigravity", "schema", "jstor", "airesources"]):
        return "Tech & AI Systems"
    if any(k in s for k in [
        "governance", "policy", "regulation", "ethics", "fairness", "copyright",
        "recruitment", "healthcare", "employment", "compliance", "waic", "un-2026", "immigration"
    ]):
        return "AI Governance"
    return "Essays & Philosophy"


def clean_markdown_body(raw: str) -> str:
    # Remove YAML frontmatter
    raw = re.sub(r"^---\s*\n.*?\n---\s*\n", "", raw, count=1, flags=re.DOTALL)
    # Remove canonical link tag & obsidian note callout
    raw = re.sub(r"<link[^>]*>\s*", "", raw)
    raw = re.sub(r">\s*\[!NOTE\].*?(?:\n\s*---|\n\n)", "\n", raw, flags=re.DOTALL)
    # Remove Kadence inline CSS artifacts
    raw = re.sub(r"\.kb-table-of-content[^\n]*\n?", "", raw)
    # Remove trailing citation line
    raw = re.sub(r"\*Citation:.*$", "", raw, flags=re.DOTALL)
    # Strip markdown links while keeping label
    raw = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", raw)
    # Clean stray bold/asterisks artifacts
    raw = re.sub(r"(?m)^\*\s*$", "", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def extract_frontmatter(raw: str) -> dict[str, str]:
    m = re.match(r"^---\s*\n(.*?)\n---", raw, flags=re.DOTALL)
    meta: dict[str, str] = {}
    if not m:
        return meta
    for line in m.group(1).splitlines():
        kv = re.match(r'^([a-zA-Z0-9_]+):\s*"?(.*?)"?\s*$', line)
        if kv:
            meta[kv.group(1)] = kv.group(2).replace('\\"', '"')
    return meta


def extract_chunks(cleaned: str, max_chunks: int = 5, max_chars: int = 1550) -> tuple[str, list[str]]:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", cleaned) if b.strip()]
    paras: list[str] = []
    current_heading = ""
    for b in blocks:
        if b.startswith("# "):
            continue
        if b == "---":
            continue
        if b.startswith("#"):
            current_heading = re.sub(r"^#+\s*", "", b).strip()
            continue
        # Normalize single newlines inside paragraph
        p = re.sub(r"\s*\n\s*", " ", b).strip()
        # Clean stray unbalanced bold markers left by WP-to-Markdown conversion
        p = re.sub(r"\*{2,}", "**", p)
        if p.count("**") % 2 != 0:
            p = p.replace("**", "")
        if len(p) < 45:
            continue
        if current_heading and not p.lower().startswith(current_heading.lower()):
            p = f"{current_heading}: {p}"
            current_heading = ""
        paras.append(p)

    summary = paras[0][:340].rstrip() if paras else ""
    if paras and len(paras[0]) > 340:
        summary = summary.rsplit(" ", 1)[0] + "…"

    chunks: list[str] = []
    total = 0
    for p in paras:
        if len(chunks) >= max_chunks or total >= max_chars:
            break
        trimmed = p[:520].rsplit(" ", 1)[0] + "…" if len(p) > 520 else p
        chunks.append(trimmed)
        total += len(trimmed)

    return summary, chunks


def extract_keywords(title: str, slug: str, cleaned: str) -> list[str]:
    base = re.findall(r"[a-z0-9]{3,}", f"{title} {slug}".lower())
    stop = {
        "the", "and", "for", "with", "from", "into", "that", "this", "what", "how",
        "why", "are", "not", "new", "your", "our", "all", "can", "about", "has", "was",
        "2024", "2025", "2026"
    }
    words = [w for w in base if w not in stop]
    # Add frequent domain terms from body
    body_tokens = re.findall(r"[a-z]{4,}", cleaned.lower())
    freq: dict[str, int] = {}
    for t in body_tokens:
        if t in stop or t in {"which", "their", "there", "these", "those", "where", "would", "could", "should", "being", "having", "other", "between"}:
            continue
        freq[t] = freq.get(t, 0) + 1
    top_body = [k for k, _ in sorted(freq.items(), key=lambda x: -x[1])[:8]]
    seen: set[str] = set()
    merged: list[str] = []
    for item in words + top_body:
        if item not in seen:
            seen.add(item)
            merged.append(item)
    return merged[:16]


def parse_archive_docs() -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    if not ARCHIVE_DOCS.exists():
        return docs

    for path in sorted(ARCHIVE_DOCS.glob("*.md")):
        if path.name.lower() == "index.md":
            continue
        raw = path.read_text(encoding="utf-8", errors="ignore")
        meta = extract_frontmatter(raw)
        slug = meta.get("slug") or path.stem
        title = meta.get("title") or slug.replace("-", " ").title()
        date = (meta.get("date") or "")[:10]
        url = meta.get("canonical_url") or f"https://aviperera.com/{slug}/"
        cleaned = clean_markdown_body(raw)
        summary, chunks = extract_chunks(cleaned)
        if not chunks:
            continue
        category = infer_category(slug, title, cleaned)
        doi_match = re.search(r"(10\.13140/RG\.[0-9.]+)", raw)
        doi_val = doi_match.group(1).rstrip(").,;:") if doi_match else ""
        docs.append({
            "id": f"doc-{slug}",
            "title": title,
            "category": category,
            "date": date,
            "url": url,
            "doi": doi_val,
            "keywords": extract_keywords(title, slug, cleaned),
            "summary": summary,
            "chunks": chunks,
        })
    return docs


def main() -> None:
    archive_docs = parse_archive_docs()
    all_entries = CORE_PILLARS + archive_docs

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": "2026-11-13",
        "author": "Avi Perera",
        "canonicalSite": "https://aviperera.com",
        "totalEntries": len(all_entries),
        "entries": all_entries,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=None), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Wrote {len(all_entries)} knowledge entries ({len(CORE_PILLARS)} pillars + {len(archive_docs)} dossiers) to {OUT_PATH} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
