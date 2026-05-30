# Echo — Financial Intelligence Platform

**Autonomous multi-agent financial intelligence system — real-time web data, PDF reports, live market signals, and AI-powered synthesis in one dashboard.**

Built for the **Web Data UNLOCKED Hackathon 2026** · Powered by Bright Data · Gemini · OpenAI GPT-4o · Featherless

---

## What Echo Does

Echo is a financial intelligence platform that helps investors make data-driven decisions. It continuously monitors your portfolio, surfaces buy/sell signals, flags compliance risks, and delivers real-time market intelligence — all powered by live web data via Bright Data.

**Core value:** Tell Echo what you're watching. It tells you when to act.

---

## Key Features

### Portfolio Dashboard
- Watchlist with real-time BUY / HOLD / SELL signals per holding
- Active compliance alerts and risk warnings at a glance
- Signal history — track how your investment thesis has evolved
- One-click refresh for latest web intelligence

### Individual Stock Analysis
- **Investment Signal** — BUY / HOLD / SELL with confidence rating, key reasons, and risk warnings
- **Live Web Intelligence** — Bright Data SERP-powered news, hiring trends, regulatory alerts, and competitive signals
- **Compliance & Risk Alerts** — regulatory changes, legal exposure, ESG compliance monitoring
- **Signal History** — time-series of past signals with driving factors
- **Valuation Models** — DCF calculator, multiples grid (PE, PEG, EV/EBITDA, ROE), analyst consensus
- **Peer Comparison** — sector competitors with KPI benchmarks and USD-converted financials
- **ESG Profile** — Environmental / Social / Governance scoring
- **Stakeholder Analysis** — upstream/downstream supply chain mapping and management overview

### Analysis Modes
- **Mode A — Market Analysis** — enter any ticker for instant multi-agent analysis
- **Mode B — Report Analysis** — upload a PDF financial report for fundamental + market cross-analysis
- **Mode C — AI Dialogue** — describe what you want in plain language, Orchestrator dispatches agents automatically

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator (Layer 4)                   │
│         Routes · Dispatches · Synthesizes · Monitors        │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │          │
  Fundamental  Quant      Peer       ESG    Stakeholder
  Agent        Agent      Agent      Agent  Agent
  (PDF)        (Yahoo)    (Sector)   (ESG)  (Supply chain)
       │          │          │          │          │
       └──────────┴──────────┴──────────┴──────────┘
                            │
                    ┌───────┴────────┐
                    │   CIOAgent     │
                    │  BUY/HOLD/SELL │
                    └───────┬────────┘
                            │
              ┌─────────────┴──────────────┐
              │     Bright Data Layer      │
              │  WebIntelAgent             │
              │  ComplianceAlertAgent      │
              │  SERP API · Web Unlocker   │
              └────────────────────────────┘
```

**Four architectural layers:**
- **Fetch** — data ingestion (Yahoo Finance, Bright Data SERP)
- **Analysis** — specialist agents (Fundamental, Quant, Peer, ESG, Stakeholder, WebIntel, Compliance)
- **Synthesis** — CIOAgent generates structured investment signal
- **Orchestration** — routes requests, runs agents in parallel, detects gaps, merges outputs

**Event streaming**: each agent emits `AgentEvent` objects that the UI merges incrementally via `mergePartial()`, so results appear section-by-section as each agent completes.

---

## Bright Data Integration

Echo uses Bright Data's SERP API to power real-time web intelligence:

| Agent | Bright Data Tool | Data |
|---|---|---|
| WebIntelAgent | SERP API | News signals, hiring trends, competitive signals |
| ComplianceAlertAgent | SERP API | Regulatory changes, legal risk, ESG compliance |

Four parallel searches per analysis — news, hiring, regulatory, competitive — each with independent error handling. Bright Data credits are consumed only on demand; Portfolio refresh runs a lightweight subset.

---

## Getting Started

### Prerequisites
- Node.js 18+
- At least one LLM API key (Gemini or OpenAI)
- Bright Data account with SERP API zone (for live web intelligence)

### Installation

```bash
git clone https://github.com/z11y11f11/EchoV.git
cd EchoV
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Required: at least one of these
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Optional: open-source model inference via Featherless
FEATHERLESS_API_KEY=your_featherless_api_key

# Bright Data — live web intelligence
BRIGHTDATA_API_KEY=your_brightdata_api_key
BRIGHTDATA_SERP_ZONE=serp_api1
```

### Run Locally

```bash
npm run dev    # starts on http://localhost:3000
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Lucide icons |
| Backend | Express (ESM), TypeScript |
| LLM providers | Google Gemini 1.5 Pro, OpenAI GPT-4o, Featherless |
| Market data | Yahoo Finance (yahoo-finance2) |
| Web intelligence | Bright Data SERP API |
| PDF extraction | pdf-parse |
| Persistence | SQLite (better-sqlite3) — signal history, audit log |

---

## Roadmap

| Priority | Feature |
|---|---|
| ★★★ | Scheduler — automated Bright Data refresh per data type |
| ★★★ | Dashboard real-time mode — live monitoring with push alerts |
| ★★★ | Industry/sector scanner — rank investment opportunities by sector |
| ★★ | Cross-currency conversion — unified USD baseline with rate date |
| ★★ | Entity normalization — resolve same company across different listings |
| ★★ | Stakeholder watchlist — persistent supply chain monitoring |
| ★ | ML prediction module — earnings beat/miss forecasting |
| ★ | Memory & self-improvement — agent accuracy tracking over time |
| ★ | Multi-user portfolio support |

---

## License

MIT
