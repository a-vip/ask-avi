# Ask Avi — Conversational AI Persona for [aviperera.com](https://aviperera.com)

> **Live Preview (GitHub Pages):** https://a-vip.github.io/ask-avi/

**Ask Avi** is a frontier-style conversational AI web application modeled on Avi Perera's published research, international humanitarian law work, software systems, and philosophical essays—defaulting to **100% Free Open-Source Reasoning** (`GPT-OSS 120B`, `Qwen3 32B`, `Nemotron 3 Ultra 550B`, `Gemma 4 31B`, `Llama 3.3 70B`, or Cloudflare Workers AI) with optional **Google Gemini 3 & 4** models and live web grounding.

---

## Key Capabilities

- **100% Free Open-Source Default + Automatic Provider Cascade (`shared/geminiProxy.ts`)**
  - **Open-Source Reasoning (Default):** Runs `openai/gpt-oss-120b` & `qwen/qwen3-32b` on **Groq** ($0 forever, up to 1,000 req/day, no card), `nvidia/nemotron-3-ultra-550b-a55b:free` & `google/gemma-4-31b-it:free` on **OpenRouter** ($0 forever, no card), or built-in **Cloudflare Workers AI** (`env.AI` — 10,000 free Neurons/day, zero external API keys needed!).
  - **Open-Source Chat 70B:** Ultra-fast `Llama 3.3 70B` / `Llama 4 Scout` / `Gemma 4 26B` with automatic rate-limit failover across free providers.
  - **Optional Google Gemini:** Keeps **Gemini 3 Flash** (`thinkingBudget: 8192`) & **Gemini 4 Hydrogen** (`thinkingBudget: 16384`) one click away in the model switcher.
  - **Live Internet Reference Grounding:** Automatically enriches open-source and Google replies with live Wikipedia + Crossref scholarly context (plus native Google Search when billed).
  - **Zero Browser Downloads or Fallback Snippets:** Responds directly in Avi's first-person voice to open-ended philosophical, technical, coding, and current-affairs questions while only citing Avi's archive links when genuinely relevant.
- **Antigravity / Claude / Gemini Reasoning UI**
  - Live elapsed thinking timer (`Thinking · Ns` → `Thought for Ns`), collapsible vertical reasoning timeline showing Google Search queries run + structured thought steps + clickable web & dossier sources.
- **Four Avi Voice Modes**
  - `Avi Standard`, `Sharp & Blunt`, `Legal & Academic`, and `Candid & Reflective`.
- **Clean Multi-Surface UX**
  - Obsidian dark & editorial warm paper light theme (`data-theme="dark" | "light"`), collapsible conversation sidebar, Markdown + syntax-highlighted code blocks, voice dictation & read-aloud, plus optional Custom OpenAI-compatible override in Settings.

---

## Deploying the $0 Public Serverless Proxy (Zero-Key Visitors on aviperera.com)

Static GitHub Pages cannot safely store your private keys, so visitors on `aviperera.com` and GitHub Pages connect via a lightweight CORS-locked relay (`shared/geminiProxy.ts`) included in this repository:

### Option A: Cloudflare Workers AI (Recommended — $0 Forever, Zero External Keys Required)
1. Deploy [`worker/src/index.ts`](./worker/src/index.ts) — [`worker/wrangler.toml`](./worker/wrangler.toml) already binds `[ai]` (`10,000 free Neurons/day`, no credit card required):
```bash
cd worker
npx wrangler deploy
```
2. *(Optional for higher limits & 120B/550B speed)* Add free secrets from [console.groq.com](https://console.groq.com/keys) and/or [openrouter.ai](https://openrouter.ai/keys):
```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

### Option B: Vercel Edge (`api/chat.ts`)
1. Import `a-vip/ask-avi` on Vercel (or run `vercel --prod`).
2. Add any free key env vars (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, and optionally `GEMINI_API_KEY`) in Vercel Project Settings.
3. Copy your endpoint URL (`https://<your-vercel-app>.vercel.app/api/chat`).

### Connect GitHub Pages to Your Proxy
In GitHub Repository **Settings → Secrets and variables → Actions → Variables**, add:
- **`ASK_AVI_API_ENDPOINT`** = `https://<your-worker-or-vercel-url>`

Then re-run `.github/workflows/deploy.yml` (or push any commit). Visitors on `aviperera.com` and `https://a-vip.github.io/ask-avi/` immediately chat for free with zero keys or signup required. *(For personal testing right now, you can also paste a free Groq or OpenRouter key directly into **Settings**.)*

---

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

To regenerate `src/data/knowledge.json` from the local archive source:

```bash
npm run knowledge
```

---

## Embedding on aviperera.com (WordPress / Kadence + LiteSpeed)

Copy [`embed/page-ask-avi.php`](./embed/page-ask-avi.php) into your `avi-wp-theme` directory, create a Page with slug `ask-avi`, assign the **Ask Avi Chatbot** template, and purge LiteSpeed Cache. It handles full-viewport sizing, admin-bar offsets, LiteSpeed lazy-load bypass attributes, `?q=` deep-linking, and live `postMessage` dark/light sync with `aviperera.com`.
