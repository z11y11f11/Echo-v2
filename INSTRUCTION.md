# Echo - Financial Intelligence Platform · Instructions

## Build Rules

- Keep the server build in ESM format only: output must remain `dist/server.mjs` (do not switch back to CJS).

## Current Architecture (Accurate as of 2026-05-31)

System uses 4 layers:

1. Fetch layer: external data retrieval (Yahoo Finance, Bright Data SERP, PDF extraction, SQLite/API endpoints); currently implemented mainly in server endpoints and utility calls, not as standalone `*FetchAgent` files.
2. Analysis layer: `FundamentalAgent`, `QuantAgent`, `PeerAgent`, `ESGAgent`, `StakeholderAgent`, `WebIntelAgent`, `ComplianceAlertAgent`.
3. Synthesis layer: `CIOAgent` (cross-analysis, valuation conclusion, structured investment signal).
4. Orchestration layer: `Orchestrator` (tool planning, parallel dispatch, timeout control, partial streaming merge, gap handling).

Supporting infra in `src/agents`:
- `LLMProvider` (Gemini/OpenAI/Featherless provider routing and model fallback).
- `AuditAgent` and `CostAgent` are placeholders (not MVP-critical execution agents yet).

## Agent Inventory (from src/agents)

- `FundamentalAgent.ts`
- `QuantAgent.ts`
- `PeerAgent.ts`
- `ESGAgent.ts`
- `StakeholderAgent.ts`
- `WebIntelAgent.ts`
- `ComplianceAlertAgent.ts`
- `CIOAgent.ts`
- `Orchestrator.ts`
- `LLMProvider.ts`
- `AuditAgent.ts` (placeholder)
- `CostAgent.ts` (placeholder)

## Canonical Rules

- Follow `DATA_STANDARDS.md` before emitting any agent output.
- Call `validateAgentOutput()` after generation; warnings should be logged and must not hard-block analysis.
- Persist validation warnings and signal history to SQLite via existing logging APIs.
- Wrap agent execution in timeout guards so a single stuck agent cannot block overall completion.
- New agents must include: types in `src/types.ts`, event-stream-compatible output, Orchestrator registration, and a one-line responsibility note in this file.

## Changelog (Condensed)

### Before 2026-05-25 (compressed to 3 sentences)

Echo is a multi-agent financial intelligence system.
Agents: FundamentalAgent, QuantAgent, PeerAgent, CIOAgent, ESGAgent, StakeholderAgent, WebIntelAgent, ComplianceAlertAgent.
LLM providers: Gemini, OpenAI, Featherless.

### 2026-05-27 and later (one sentence per item)

- 2026-05-27: Added data standards, validation/audit foundations, and initial ESG/Stakeholder orchestration integration.
- 2026-05-30: Added WebIntel and Compliance alert pipelines, signal persistence/history, currency conversion, entity normalization, and timeout-safe parallel orchestration.
- 2026-05-30: Portfolio refresh split into risk-focused and full-refresh endpoints with state-driven dashboard updates.
- 2026-05-30: UI fixes were consolidated across Dashboard/Portfolio/Mode A, including tab persistence, section toggles, signal badge/banner behavior, language consistency, and layout stability.
- 2026-05-30: Minor bug fixes were consolidated, including peer under-return retry, irrelevant news filtering, Mode A signal generation path, and conversion/math correctness.
- 2026-05-31: Stakeholder browse flow was upgraded to one-page top-5 drill-down with ticker-first navigation into monitor tabs.
- 2026-05-31: Stakeholder and management enrichment now prioritize Yahoo Finance ground truth (`longName`, `longBusinessSummary`, officers, market cap).
- 2026-05-31: ESG moved to a 3-tier source strategy (Bright Data SERP -> PDF extraction -> unavailable fallback).
- 2026-05-31: Portfolio monitoring gained scheduled auto-refresh, freshness intervals, stale indicators, and persisted settings.
- 2026-05-31: Email alerts and monthly portfolio report delivery were added using Resend with SQLite dedupe keys.

## Notes on Removed/Outdated Content

- Removed verbose per-commit UI micro-change logs now merged into one UI line.
- Removed fragmented small-fix entries now merged into one bug-fix line.
- Removed duplicated old changelog blocks and over-detailed endpoint/UI walkthroughs that were no longer instruction-critical.
