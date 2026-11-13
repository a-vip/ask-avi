# Ask Avi — Conversational AI Persona for [aviperera.com](https://aviperera.com)

> **Live Preview (GitHub Pages):** https://a-vip.github.io/ask-avi/

**Ask Avi** is a frontier-style conversational AI web application modeled on Avi Perera's published research, international humanitarian law work, software systems, and philosophical essays—powered by **Gemini 2.5 Extended Thinking** and live **Google Search Grounding** across the open internet.

---

## Key Capabilities

- **Gemini 2.5 Frontier Reasoning + Live Web Search (`shared/geminiProxy.ts`)**
  - **Gemini 2.5 Flash** (`thinkingBudget: 8192`) & **Gemini 2.5 Pro** (`thinkingBudget: 16384`) with native `includeThoughts: true` reasoning streams and `googleSearch` live internet access.
  - **Zero Browser Downloads or Fallback Snippets:** Responds directly in Avi's first-person voice to open-ended philosophical, technical, coding, and current-affairs questions while only citing Avi's archive links when genuinely relevant.
- **Antigravity / Claude / Gemini Reasoning UI**
  - Live elapsed thinking timer (`Thinking · Ns` → `Thought for Ns`), collapsible vertical reasoning timeline showing Google Search queries run + structured thought steps + clickable web & dossier sources.
- **Four Avi Voice Modes**
  - `Avi Standard`, `Sharp & Blunt`, `Legal & Academic`, and `Candid & Reflective`.
- **Clean Multi-Surface UX**
  - Obsidian dark & editorial warm paper light theme (`data-theme="dark" | "light"`), collapsible conversation sidebar, Markdown + syntax-highlighted code blocks, voice dictation & read-aloud, plus optional Custom OpenAI-compatible override in Settings.

---

## Deploying the Serverless Gemini Relay (Zero-Key Public Visitors)

Static GitHub Pages cannot safely store your private `GEMINI_API_KEY`, so visitors on `aviperera.com` and GitHub Pages connect via a lightweight CORS-locked relay included in this repository:

### Option A: Vercel Edge (`api/chat.ts`)
1. Import `a-vip/ask-avi` on Vercel (or run `vercel --prod`).
2. Set environment variable `GEMINI_API_KEY` (from Google AI Studio) in Vercel Project Settings.
3. Copy your endpoint URL (`https://<your-vercel-app>.vercel.app/api/chat`).

### Option B: Cloudflare Workers (`worker/src/index.ts`)
```bash
cd worker
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
```

### Connect GitHub Pages to Your Proxy
In GitHub Repository **Settings → Secrets and variables → Actions → Variables**, add:
- **`ASK_AVI_API_ENDPOINT`** = `https://<your-proxy-host>/api/chat`

Then re-run `.github/workflows/deploy.yml` (or push any commit). GitHub Pages at `https://a-vip.github.io/ask-avi/` will immediately connect with zero setup required for visitors. *(While setting up, you can also paste your own Gemini API key into **Settings** in the app for instant personal testing.)*

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
