# Ask Avi — Conversational AI Persona for [aviperera.com](https://aviperera.com)

> **Live Preview (GitHub Pages):** https://a-vip.github.io/ask-avi/

**Ask Avi** is a standalone, zero-backend conversational AI web application modeled on Avi Perera's published research, sovereign technology platforms, policy stances, and personal essays. Designed with a Claude × Gemini hybrid interface, it lets anyone visiting **aviperera.com** (or using the live GitHub Pages deployment) ask questions and receive grounded, cited answers in Avi's authentic voice.

---

## Key Capabilities

- **Hybrid Sovereign Inference Architecture (Zero Mandatory Backend / Zero API Key)**
  1. **In-Browser WebGPU LLM (Default via `@mlc-ai/web-llm`):** Real open-ended generative reasoning running 100% locally in a dedicated Web Worker (`Neural Deep 3B` via `Llama-3.2-3B-Instruct`, `Neural Qwen 3B` via `Qwen2.5-3B-Instruct`, or `Neural Swift 1B`) with pre-response reasoning (`<thought>`), live streaming, and selective RAG linking across Avi's archive.
  2. **Instant Archive Engine (Automatic Fallback):** Lightweight retrieval fallback across **108 sovereign knowledge entries** (8 Core Identity Pillars + 100 Archive Dossiers) whenever WebGPU is unavailable or disabled.
  3. **Optional Custom API (BYOK):** Settings modal allows connecting any OpenAI-compatible chat completions endpoint while still injecting Ask Avi's live RAG context and system prompt.
- **Four Distinct Avi Voice Modes**
  - `Avi Standard` — Balanced first-person prose, British candour & clarity
  - `Sharp & Blunt` — Direct, unsentimental, straight to incentives
  - `Legal & Academic` — Cambridge / UNIDIR / IHL treaty precision
  - `Candid & Reflective` — Harrow → Buckingham → Cambridge → Bangkok perspective
- **Frontier Chatbot UX (Claude × Gemini Hybrid)**
  - Obsidian dark mode & warm editorial light theme (`data-theme="dark" | "light"`)
  - Collapsible conversation history sidebar with pinned threads, search filter, recency grouping, and Markdown export
  - Streaming markdown renderer with syntax-highlighted code copy buttons (`highlight.js`) and XSS sanitization (`DOMPurify`)
  - Interactive inline `[n]` citation pills opening the right-hand **Dossiers Drawer** with matched snippets and canonical links back to `aviperera.com` / DOIs
  - Context attachment chips, optional Web Speech voice input & read-aloud toggle, and deep-link query support (`?q=...`, `?theme=light|dark`, `?embed=1`)

---

## Local Development

### Prerequisites
- Node.js 20+ and npm
- Python 3.10+ (only needed to rebuild `src/data/knowledge.json` from the Obsidian/Archive sources)

### Setup & Run

```bash
npm install
npm run dev
```

### Build & Test

```bash
# Run unit & jsdom tests (RAG, Instant Synthesizer, Markdown sanitizer, Storage helpers)
npm test

# Type-check and build production bundle to dist/
npm run build
```

### Rebuilding the Sovereign Knowledge Corpus

If you update `c:\AI_Workspace\Obsidian\Avi\avi-research-archive` or `a-vip/README.md`, regenerate `src/data/knowledge.json`:

```bash
npm run knowledge
```

---

## Embedding on aviperera.com (WordPress / Kadence + LiteSpeed)

Two clean integration options are included once GitHub Pages is live at `https://a-vip.github.io/ask-avi/`:

### Option 1: Dedicated WordPress Page Template (Recommended)
Copy [`embed/page-ask-avi.php`](./embed/page-ask-avi.php) into your `avi-wp-theme` folder, create a Page in WordPress Admin with slug `ask-avi`, assign the **Ask Avi Chatbot** template, and purge LiteSpeed Cache.

It automatically handles:
- Kadence full-viewport framing + WordPress admin bar height offsets
- LiteSpeed Cache protections (`data-no-optimize="1"`, `data-no-lazy="1"`, `about:blank` fallback recovery)
- Live dark/light `postMessage` synchronization with `aviperera.com`'s `<html data-theme>` toggle
- Deep linking via `https://aviperera.com/ask-avi/?q=Meaningful+Human+Control`

### Option 2: Direct HTML Block / Shortcode Iframe

```html
<iframe
  src="https://a-vip.github.io/ask-avi/?embed=1"
  title="Ask Avi — AI Persona & Research Assistant"
  class="skip-lazy no-lazyload"
  data-no-optimize="1"
  data-no-lazy="1"
  data-skip-lazy="1"
  allow="microphone; clipboard-write"
  style="width:100%;height:82vh;min-height:640px;border:0;border-radius:16px;"
></iframe>
```

---

## Repository Structure

```text
ask-avi/
├── .github/workflows/deploy.yml   # GitHub Actions build -> GitHub Pages deploy
├── embed/page-ask-avi.php         # Ready-to-drop Kadence + LiteSpeed WP template
├── scripts/build_knowledge.py     # Builds src/data/knowledge.json from archive corpus
├── src/
│   ├── components/                # Sidebar, TopBar, Composer, WelcomeScreen, MessageBubble, Drawers
│   ├── data/                      # persona.ts & generated knowledge.json (108 dossiers)
│   ├── engine/                    # rag.ts, instantSynthesizer.ts, webllm.worker.ts, llmService.ts
│   ├── styles/index.css           # Obsidian dark & warm editorial light theme system
│   ├── types/chat.ts              # Shared TypeScript interfaces
│   └── utils/                     # Safe markdown + citation pills, localStorage & bridge helpers
└── tests/ask-avi.test.ts          # Vitest suite covering retrieval, synthesis, sanitization & state
```

---

## Verification & Authorship

Built for **[Avi Perera](https://aviperera.com)** (ORCID [`0009-0005-1903-6868`](https://orcid.org/0009-0005-1903-6868) · Wikidata [`Q140248356`](https://www.wikidata.org/wiki/Q140248356) · GitHub [`@a-vip`](https://github.com/a-vip)).
