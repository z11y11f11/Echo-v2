# Echo — Financial Intelligence Platform

**Autonomous multi-agent financial intelligence system — real-time web data, PDF reports, live market signals, and AI-powered synthesis in one dashboard.**

Built for the **Web Data UNLOCKED Hackathon 2026** · Powered by Bright Data · Gemini · OpenAI GPT-4o · Featherless

---

## Features

- **Three independent analysis modes** — ticker-only market scan, PDF report analysis, and AI-guided dialogue
- **Parallel agent orchestration** — FundamentalAgent, QuantAgent, PeerAgent, and CIOAgent run concurrently
- **Streaming partial dashboard** — results appear section-by-section as each agent completes
- **Reflection loop** — detects gaps (missing ESG, highlights, risks) and fills them from LLM training knowledge with clear AI-synthesis disclaimers
- **Multi-provider LLM support** — Gemini 1.5 Pro · OpenAI GPT-4o · Featherless (optional, open-source models)
- **Valuation models** — DCF calculator, multiples grid (PE, PEG, EV/EBITDA, ROE), CIO verdict
- **ESG profile** — Environmental / Social / Governance analysis with pillar badges
- **Live Web Intelligence** — Bright Data SERP-powered news, hiring, regulatory, and competitive web signals
- **Stakeholder analysis** — upstream/downstream relationship mapping and peer KPI comparison
- **Peer comparison** — sector-aware competitor selection with price and PE benchmarks
- **Export to PDF** — one-click dashboard export

---

## Analysis Modes

### Mode A — Market Analysis (Ticker Only)
Enter a stock ticker (e.g. `AAPL`, `1810.HK`). QuantAgent fetches live price, valuation multiples, and technical trend. PeerAgent selects sector-relevant competitors. CIOAgent generates an investment verdict.

### Mode B — Report Analysis (PDF Only)
Upload a financial report. FundamentalAgent reads the document and **automatically extracts the ticker** — no manual entry needed. QuantAgent then fetches live market data in parallel. CIOAgent cross-analyzes both outputs, surfacing divergence signals between reported fundamentals and current market performance.

### Mode C — AI Dialogue (Orchestrator Chat)
Describe what you want in plain language — the Orchestrator asks 2–4 clarifying questions, confirms a plan, then dispatches agents automatically. Supports both ticker-only and PDF+ticker workflows. Results stream into a live dashboard as agents complete.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Orchestrator                     │
│  conductDialogueStep() · planOrchestratorToolCalls()│
│  runParallelAnalysis() · detectGaps() · fillGaps()  │
└────────┬──────────────┬──────────────┬──────────────┘
         │              │              │
  FundamentalAgent  QuantAgent     PeerAgent
  (PDF → text)      (Yahoo Finance) (sector peers)
         │              │              │
         └──────────────┴──────────────┘
                        │
                   CIOAgent
          (cross-analysis · valuation verdict)
```

**Event streaming**: each agent emits `AgentEvent` objects (`{ type, message, partial? }`) that the UI merges incrementally via `mergePartial()`.

---

## Getting Started

### Prerequisites
- Node.js 18+
- At least one LLM API key (Gemini or OpenAI)

### Installation

```bash
git clone https://github.com/your-org/finor.git
cd finor
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
# Required: at least one of these
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Optional: open-source model inference via Featherless
FEATHERLESS_API_KEY=your_featherless_api_key
FEATHERLESS_MODEL=mistralai/Mistral-7B-Instruct-v0.3   # default

# Optional: live web intelligence via Bright Data SERP
BRIGHTDATA_API_KEY=your_brightdata_api_key
BRIGHTDATA_SERP_ZONE=serp_api1
```

**Provider priority**: Featherless (if key set) → OpenAI → Gemini. The Orchestrator dialogue and tool-planning always use OpenAI (requires function calling).

### Run Locally

```bash
npm run dev        # Vite dev server + Express API on port 3000
```

### Production Build

```bash
npm run build      # outputs dist/ (frontend) + dist/server.mjs (ESM server)
npm start          # node dist/server.mjs
```

---

## Deployment (Vultr / VPS)

```bash
# On your server
git pull origin main
npm install --omit=dev
npm run build
# Set env vars, then:
node dist/server.mjs
# or use PM2:
pm2 start dist/server.mjs --name finagent
```

The Express server serves the Vite build as static files and exposes `/api/extract` for PDF text extraction.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Lucide icons |
| LLM providers | Google Gemini 1.5 Pro, OpenAI GPT-4o, Featherless |
| Market data | Yahoo Finance (via `yahoo-finance2`) |
| PDF extraction | pdf-parse (server-side via Express `/api/extract`) |
| Server | Express (ESM, `dist/server.mjs`) |

---

## Known Issues

| Date | Item | Status | Notes |
| --- | --- | --- | --- |
| 2026-05-17 | OpenAI token-per-minute limit during PDF analysis | Fixed | Prompt capped at 18k chars; `max_output_tokens: 4000`. |
| 2026-05-17 | OpenAI context window exceeded during PDF analysis | Fixed | Base64 PDF no longer attached to OpenAI requests. |
| 2026-05-17 | OpenAI JSON schema type mismatch (`STRING` vs `string`) | Fixed | LLMProvider normalizes Gemini schema types before sending to OpenAI. |
| 2026-05-19 | ESG section missing from dashboard | Fixed | Added ESG render block; Mode A options now include `'esg'`. |
| 2026-05-19 | Metric unit inconsistency (`457,286 Million RMB` vs `457.29B`) | Fixed | Agent prompts enforce `<number><B\|M> <ISO_CODE>` and `x`/`%` suffixes. |
| 2026-05-30 | Live Web Intelligence panel missing from dashboard | Fixed | Dashboard now reads `data.webIntel`, includes `webIntel` in section state/export toggles, and Orchestrator returns a `webIntel` placeholder with `data_gaps` when Bright Data is unavailable. |
| 2026-05-30 | WebIntel absent in ticker-only flow | Fixed | `runMasterAnalysis()` now runs WebIntelAgent alongside QuantAgent for ticker-only analysis; PDF flow already runs WebIntelAgent in parallel. |
| 2026-05-30 | Peer comparison currency display misleading | Fixed | Peer table now displays local currency for price and market cap, e.g. KRW for Samsung and HKD for Hong Kong listings. |
| 2026-05-30 | Stakeholder candidate UI repeated and unclear | Improved | Candidate selection is grouped by selected industry with upstream/downstream for relationship understanding and peers reserved for comparison. |
| 2026-05-17 | Review OpenAI compute usage | Follow-up | Recheck token/request usage after more test runs. |

---

## License

MIT
