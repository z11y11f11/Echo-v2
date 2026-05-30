# Echo — Financial Intelligence Platform · Instructions

## Build Rules

- The Express server must always be bundled as ESM, not CJS, because `server.ts` uses `import.meta.url` for `createRequire`. Keep build output as `dist/server.mjs`.

## Changelog

| Date | What changed | Why |
| --- | --- | --- |
| 2026-05-31 | Portfolio email alerts and monthly report added. SettingsPanel now includes Email Alerts with recipients and four triggers: high compliance alert, negative news, signal changed to SELL, and 1-day price move threshold (default 5%). WatchlistDashboard detects triggers after portfolio refresh / auto-refresh and sends deduped alert batches to new server endpoint `POST /api/alerts/send`. Manual "Monthly Report" button sends the current portfolio monitor snapshot with HTML bar charts via `POST /api/alerts/monthly-report`; report period can be Last 30 days or a selected full calendar month, and the email subject/body include the selected period. Missing recipients now show "Set Recipients" and open Settings instead of failing silently; server error messages are surfaced in the Portfolio toolbar. Server uses Resend (`RESEND_API_KEY`, `ALERT_FROM_EMAIL`) and persists sent alert keys in SQLite `sent_alert_log` to avoid duplicate alert emails. | Users wanted real-time email alerts for risk conditions and a manual portfolio monitoring monthly report with charts and selectable date range. |
| 2026-05-31 | StakeholderModal rewritten as a one-page browse view (no more 3-step wizard). On open, calls new `StakeholderAgent.getBrowseData(ticker)` which returns `{ topIndustries, candidates, companyIntro }` in one shot. Displays company intro + top 5 revenue segments + top 5 upstream/downstream/peers. Replaced `onComplete(output)` prop with `onSelectEntity(ticker, name)`. In WatchlistDashboard, clicking an entity row adds the ticker to the watchlist (if new), fetches its data, and opens a monitor tab — no analysis is triggered until user clicks Run Full Analysis inside that tab. `perIndustryLimit` / `takeSortedByType` raised from 3 → 5 to match "top 5" terminology. | Old wizard required 3 click-throughs to see who the stakeholders were. New flow shows everything immediately and turns each entity into a one-click drill-down to its monitor view. |
| 2026-05-31 | AnalysisDashboard header redesigned. `InvestmentSignalBadge` (260px tile) was previously placed inside the right-hand toolbar alongside the Market Price tile and four action buttons, which broke the layout on any normal screen width. Now: header is a single compact row (company identity left, slim price chip + 4 icon buttons right). Investment signal renders as a separate full-width `InvestmentSignalBanner` below the header: large verdict + confidence on the left, 2-column reasons + warnings on the right. Toolbar buttons standardised to 36px icons with `title` tooltips. | Old header was unusable: signal tile, price tile, and toolbar buttons all competed for the same horizontal space, breaking into multiple rows and squashing buttons. |
| 2026-05-31 | Portfolio individual stock view enhancements. (1) Company description added under ticker name — first 1–2 sentences of `assetProfile.longBusinessSummary` fetched from `/api/stock/:ticker/summary`. Falls back to `sector · industry` when description is missing. `StockQuote` interface gains optional `description` / `sector` / `industry` fields. (2) Investment Signal + Market Data moved to side-by-side cards at the top (was stacked vertically). (3) News Signals and Compliance Alerts cards are now expandable via "Show N more" toggle — previously hard-capped at 3 items. News items now show date when available. | Users wanted context on what the company actually does, and the ability to drill into more than 3 news items / alerts without leaving the dashboard. |
| 2026-05-31 | StakeholderAgent enriches candidates with real Yahoo Finance data. New `enrichCandidatesWithYahooData()` runs after `deduplicateBySymbol`: for each candidate with a resolved ticker, fetches `/api/stock/:t/summary` to overwrite the LLM-provided `name` with the official `longName`, populate `description` from `assetProfile.longBusinessSummary`, and replace `sort_value` with real market cap formatted as `X.XB CUR` or `X.XT CUR` (peers only). `analyzeManagement()` similarly tries Yahoo Finance `assetProfile.companyOfficers` first to extract CEO/CFO real names, falling back to LLM. `/api/stock/:t/summary` now includes `assetProfile` module. | Old StakeholderAgent fully trusted LLM data: most candidates ended up as `no_public_data`, management was `null`, candidates had no market cap. Yahoo Finance provides verified ground truth for these fields. |
| 2026-05-31 | WebIntelAgent hiring trend now requires concrete evidence. `analyzeHiringTrend()` parses snippets for specific numbers (`laid off 5,000 employees`, `hiring 3,000 engineers`, `300+ open positions`) and soft signals (`hiring freeze`, `workforce expansion`). Signal determination prioritises numeric magnitude; falls back to soft-signal ratio. When neither concrete evidence nor meaningful snippet text is present, returns `{ signal: 'unknown', evidence: '' }`. Dashboard `WebIntelView` only renders the Hiring Trend panel when signal is meaningful and evidence is non-empty. | Old "Found X vs Y signals" evidence string was meaningless; many companies got mislabelled because raw result counts don't reflect actual hiring intent. |
| 2026-05-31 | Auto-refresh after market close. New `SettingsPanel.tsx` slide-in drawer with two sections: (1) Auto-Refresh — enable/disable, delay after 4 PM ET close (+1/+2/+4/+8h), schedule (every trading day vs Fridays only), toggles for including news/compliance and CIO signal regeneration; (2) Data Freshness Intervals — per-data-type thresholds (price 15min/1h/4h/daily, news daily/weekly, compliance daily/weekly/monthly, signal after_refresh/weekly). Settings persisted to `echo_settings_v1`. WatchlistDashboard runs `setInterval(checkAndRefresh, 60_000)` using `Intl` API for ET timezone (DST-safe); fires `refreshAllTickers()` once per ET calendar day. `lastAutoRefresh` stored in localStorage. Portfolio table shows amber `AlertCircle` + amber timestamp on stale rows. ⚙ Settings button added to inner tab bar with "Next: Mon 20:00 ET" label on larger screens. | Users wanted scheduled refresh and per-type control over when data becomes "stale". |
| 2026-05-31 | ESGAgent now uses 3-tier data source priority: (1) Bright Data SERP via new `GET /api/esg/:ticker` endpoint (3 parallel queries: environmental + social + governance), extracts key_risks and improvement_signals per dimension from snippet text; (2) PDF text extraction (existing keyword scoring); (3) Unavailable. Server endpoint gracefully returns 503 when `BRIGHTDATA_API_KEY` is missing. | Old ESGAgent only worked when a PDF was uploaded — Mode A and Dashboard had no ESG data. Bright Data fills the gap. |
| 2026-05-31 | App.tsx tab label: "Dashboard" → "Portfolio". | Reflects the holdings-list mental model. |
| 2026-05-31 | Market Analysis (Mode A) gains bookmarked tabs identical to Portfolio. New tab bar at top with `+ New` button. Each analysed ticker becomes a persisted tab. State persisted to localStorage: `echo_modea_tabs_v1`, `echo_modea_active_v1`, `echo_modea_data_{ticker}`. Quick re-search bar appears above each completed analysis with a "Re-run TICKER" button. New search form shows "Recent: AAPL MSFT…" chips for quick navigation. | Each search previously erased the last result; switching tabs erased everything. Now switching to Portfolio and back keeps all in-flight + completed analyses. |
| 2026-05-31 | WatchlistDashboard persists `openTabs` and `activeView` to localStorage (`echo_open_tabs_v1`, `echo_active_view_v1`). | These were in-memory React state, so switching to Mode A and back wiped open ticker tabs. |
| 2026-05-31 | Tab X-button isolation: in both WatchlistDashboard and ModeA, the close X is now a sibling button to the nav button (not nested) and only becomes visible + clickable when the tab is active (`text-transparent + pointer-events-none` for inactive). Prevents accidental closes when hover-clicking quickly. | Users were clicking tabs and the X simultaneously, closing tabs they intended to open. |
| 2026-05-31 | Default watchlist updated: AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA (Magnificent 7). | Aligns with the standard US large-cap monitoring set. |
| 2026-05-31 | Rebrand: all remaining "FinAgent" / "FinAgent V2" strings replaced with "Echo" — App.tsx sidebar logo, ModeC intro, LLMProvider Orchestrator system prompts, LLMProvider json_schema name. | Final cleanup of the FinAgent → Echo rename. |
| 2026-05-30 | Default watchlist seeded in WatchlistDashboard: AAPL, MSFT, TSLA, NVDA, COIN, 9988.HK, 1810.HK. Shown when localStorage is empty so new users see a populated dashboard immediately. | Empty dashboard was confusing for first-time users with no context on how to use it. |
| 2026-05-30 | Two distinct Portfolio refresh modes. Portfolio row refresh button and Refresh All call `POST /api/portfolio-refresh/:ticker` (risk-focused: "risk warning lawsuit regulation" + "bad news negative outlook" + 3 compliance searches). After server response, client calls `CIOAgent.generateInvestmentSignal()` with fresh context and persists new signal. Individual stock Refresh data button calls full `POST /api/refresh/:ticker` (broad news). Refresh All button added to Holdings header: serial loop through all tickers with "Refreshing TICKER…" status. | Portfolio refresh was calling the full analysis endpoint; risk/compliance-only refresh is faster and more appropriate for monitoring. |
| 2026-05-30 | WatchlistDashboard redesigned as two-view monitoring page. View 1 (Portfolio): 3 summary cards (Total Holdings, Active Alerts, Signals BUY/HOLD/SELL) + holdings table (Ticker, Company, Price, Change, Signal, Alerts, Last Updated). View 2 (Individual stock): 2-col grid with Signal card + Price card (left) and News + Compliance (right), Signal History timeline (bottom), action buttons. Inner tab bar with [ Portfolio ] + per-ticker tabs. Watchlist + module toggles persisted in localStorage. | Provides a monitoring-first view separate from the deep-analysis modes (A/B/C). |
| 2026-05-30 | Orchestrator.persistToLocalStorage(): writes webIntel and compliance to localStorage keys `echo_webintel_{ticker}` and `echo_compliance_{ticker}` after every completed analysis. Dashboard reads from these keys on mount so cached data is available without re-running a full analysis. | Dashboard had no data to show for tickers that were analysed in Mode A/B/C before the Dashboard was opened. |
| 2026-05-30 | `POST /api/refresh/:ticker` server endpoint: parallel fetch of Yahoo Finance price + 7 Bright Data SERP searches (3 broad news + 3 compliance). Returns `{ ticker, price, webIntel, compliance, refreshed_at }`. Urgency classified server-side by keyword regex; news deduplicated + relevance-filtered. No LLM calls in this endpoint. | Enables live data refresh from the Dashboard without running the full multi-agent analysis pipeline. |
| 2026-05-30 | WatchlistDashboard data model fix: webIntel/compliance now held in React state (`liveData`) not read from localStorage in render. On mount, `loadCachedLiveData()` initialises from localStorage. After any refresh, updates state + writes back to localStorage. Fixes Refresh data button having no visible effect. | Reading localStorage directly in render never triggers re-renders; React state is required. |
| 2026-05-30 | AnalysisDashboard gains `sectionOverrides` prop (lazy-initialised into `sections` state) and `hideToolbar` prop. Used by WatchlistDashboard module toggles to show/hide individual sections. | Allows Dashboard to control which AnalysisDashboard sections are visible without modifying internal state. |
| 2026-05-30 | StakeholderModal: translated all remaining Chinese UI strings to English — Step 1/2/3 titles, descriptions, Comprehensive mode button, CircleHelp tooltip. Candidate display columns capped at 3 per type in the modal view. | App is for an international audience; Chinese strings were inconsistent. |
| 2026-05-30 | StakeholderAgent.identifyTopIndustries: deduplicate `top_industries` by industry name, keeping only the entry with the most recent period (e.g. FY2024 wins over FY2022 for the same industry). | Industry list was showing duplicate rows for the same segment across multiple years. |
| 2026-05-30 | Unified candidate count to top 3 per type (upstream 3 + downstream 3 + peers 3 = max 9). Changed `perIndustryLimit = 3` and all `takeSortedByType` limits from 5 → 3 in StakeholderAgent. | Previously inconsistent: comprehensive mode returned 3, specific mode returned 5. |
| 2026-05-30 | StakeholderAgent: prompt now requires LLM to provide `ticker` (Yahoo Finance symbol) and `exchange` for every candidate. Companies without a verifiable public ticker are excluded. `StakeholderEntity` type gains optional `ticker?` and `exchange?` fields. New `resolveTickersForCandidates()` method: if LLM did not supply a ticker, queries `/api/search/:name` to auto-resolve; result stored in `entity.ticker`. Failures are silent. | Stakeholder candidates had no ticker data, making them unusable for live market lookups and comparison. |
| 2026-05-30 | CIOAgent.generateInvestmentSignal: calls `getLatestSignal(ticker)` before generating. If a previous signal exists, injects a stability clause into the prompt: only change verdict if there is clear new evidence (analyst rating change, material news event, or price moved >10% since last signal). Otherwise maintain previous verdict. | Signal was flipping between BUY/HOLD/SELL on every analysis run without any fundamental change. |
| 2026-05-30 | Currency conversion bug fix in PeerComparison: removed erroneous `1/usd` inversion that was producing values ~1350× too large for KRW etc. `convertToUSD(1, cur)` already returns USD-per-local-unit; rate is now stored and multiplied correctly. `getRateDateLabel()` returns ISO YYYY-MM-DD. | Peer table was showing e.g. Samsung price as ~$400M USD instead of ~$221 USD. |
| 2026-05-30 | AnalysisDashboard Market Price card: non-USD prices now show `(~$X.XX USD)` reference via new `stockUsdPrice` state + useEffect calling `convertToUSD`. | Header showed only local currency with no USD context for non-US stocks. |
| 2026-05-30 | Added SignalTimeline component (`src/components/SignalTimeline.tsx`). Fetches `/api/log/history/:ticker` on mount; renders collapsible list of past signals with date, colour-coded verdict badge, confidence, expandable key_reasons and risk_warnings. Empty state handled. Added Signal History CollapsibleSection (default collapsed) below Cross Analysis in AnalysisDashboard. | Provides historical audit trail of investment signal changes for a given ticker. |
| 2026-05-30 | server.ts: `/api/log/history/:ticker` alias added pointing to the same handler as `/api/log/analysis/:ticker`. Response now includes `created_at` field. | SignalTimeline component needs `created_at` for display; route alias improves semantic clarity. |
| 2026-05-30 | Fixed `investmentSignal` never generated in Mode A (ticker-only). Root cause: `synthesize_verdict` only triggers when both ticker + file are present. Added guaranteed final CIO step in `runMasterAnalysis` that calls `generateInvestmentSignal()` after all parallel agents complete, wrapped in `withTimeout(30s)`. Result merged via `mergePartial` and emitted as a partial event so the dashboard badge updates in real time. | InvestmentSignalBadge always showed PENDING/Awaiting CIO in Mode A because the generation code path was never reached. |
| 2026-05-30 | Agent timeout + flow hang fix. Added `withTimeout(30s)` helper in Orchestrator wrapping every agent in both `fetch_market_data` and `runParallelAnalysis` Phase 2. Timed-out agents emit an event and return an empty partial so `Promise.allSettled` always resolves and analysis never hangs. | Analysis page got stuck in Running state when WebIntelAgent or other agents failed to resolve. |
| 2026-05-30 | Replaced all Chinese UI text and `refresh_interval` values with English throughout the codebase. `Scheduler.ts` constants, `buildUnavailableWebIntel/Compliance` fallback strings, and all `数值为本地货币，未换算` labels now English. Chinese comment in Scheduler translated. | App is intended for an international audience; Chinese strings were inconsistent with the rest of the English UI. |
| 2026-05-30 | InvestmentSignalBadge moved inside the header flex container alongside the Market Price tile (was placed outside, causing layout break). Shows a grey PENDING tile when `investmentSignal` is null instead of rendering nothing. Badge is compact (no longer full-width). | Badge was invisible or breaking header layout. PENDING state makes the signal lifecycle explicit during loading. |
| 2026-05-30 | PeerAgent retry: if fewer than 3 peers returned on first attempt, retries once with a stricter prompt constraint. Falls back to 3 placeholder entries if still empty. | Peer count was inconsistent (0–3 randomly) due to LLM under-returning on the first call. |
| 2026-05-30 | WebIntelAgent news filter: drops results that do not mention the ticker or company name, and blocks results matching irrelevant keywords (`baba vanga`, `psychic`, `prophecy`, `astrology`, `horoscope`, etc.). | News panel was showing unrelated content such as Baba Vanga prophecy articles. |
| 2026-05-30 | Added `ComplianceAlertAgent` (new file `src/agents/ComplianceAlertAgent.ts`). Runs 3 parallel Bright Data SERP searches (regulatory / legal / ESG compliance). Classifies urgency by keyword (high/medium/low), derives `overall_risk` from highest urgency. Registered in Orchestrator parallel dispatch for both ticker-only and PDF flows. Dashboard renders **Compliance & Risk Alerts** section (CollapsibleSection with ShieldAlert icon) below Live Web Intelligence. Types `ComplianceAlert` and `ComplianceOutput` added to `src/types.ts`. | Surfaces regulatory, legal, and ESG compliance signals as a dedicated structured panel. |
| 2026-05-30 | Added `InvestmentSignal` interface and `generateInvestmentSignal()` to CIOAgent. Structured BUY/HOLD/SELL verdict with confidence, 3 key_reasons, 2 risk_warnings. Called in parallel with `crossAnalyze` in `runParallelAnalysis` Phase 3, in `synthesize_verdict` tool path, and as a final guaranteed step in `runMasterAnalysis`. `AnalysisResult` extended with `investmentSignal?`. | Replaces free-text investment verdict with a structured signal consumable by the UI and the audit log. |
| 2026-05-30 | SQLite persistence via `better-sqlite3`. `server.ts` initialises `echo.db` with `analysis_log` and `validation_log` tables. Three new endpoints: `POST /api/log/analysis`, `GET /api/log/analysis/:ticker`, `POST /api/log/validation`. `src/utils/db.ts` provides browser-safe fetch wrappers (`saveAnalysisLog`, `getAnalysisHistory`, `getLatestSignal`, `logValidationWarningRemote`). `auditLog.ts` now also writes validation warnings to SQLite (fire-and-forget). Orchestrator calls `saveAnalysisLog` after both analysis flows. | Persists investment signals and validation warnings across sessions for audit and historical comparison. |
| 2026-05-30 | Currency conversion utility (`src/utils/currencyConverter.ts`). `convertToUSD`, `formatWithCurrency`, `formatLargeWithCurrency` with 10-minute in-memory rate cache via Yahoo Finance `USDXXX=X` quotes. PeerComparison now shows local currency + `(~$X USD)` reference for price and market cap columns. Rate date shown in table header. | Peer table previously showed raw local values with no USD reference, making cross-currency comparison misleading. |
| 2026-05-30 | Entity normalization (`src/utils/entityNormalizer.ts`). `normalizeEntity()` resolves company names to Yahoo Finance `longName` and `symbol`. `deduplicateBySymbol()` removes duplicate listings keeping the entry with highest `sort_value`. StakeholderAgent runs deduplication after `buildCandidates()`; PeerAgent deduplicates after `identifyPeers()`. | LLM was generating aliases of the same listed entity (e.g. "Samsung" and "Samsung Electronics Co Ltd") as separate entries. |
| 2026-05-30 | WebIntelAgent hiring trend rewritten. Two parallel queries (expanding signals vs contracting signals); signal determined by result count ratio (>1.5× threshold); evidence reports exact counts. Previous single-query keyword-match approach almost always returned "contracting". | Hiring signal was biased toward CONTRACTING because the single search query returned layoff news for nearly all companies. |
| 2026-05-30 | WebIntelAgent news search upgraded to 3 parallel queries covering different dimensions: (1) latest news on financial sites, (2) product/partnership/earnings, (3) analyst ratings. Results merged, title-deduped, sorted by date descending, capped at 10. Previous single `earnings news 2025` query produced low-diversity results. | Improves news panel coverage across events, analyst moves, and product news rather than only financial reporting. |
| 2026-05-30 | README retitled to **Echo — Financial Intelligence Platform**. Removed all references to Milan AI Week Hackathon, ForcV, and FinAgent V2. Added Web Data UNLOCKED Hackathon 2026 + Bright Data attribution line. Removed Google AI Studio banner image. | Rebranding for Web Data UNLOCKED Hackathon submission. |
| 2026-05-30 | Added WebIntelAgent with Bright Data SERP integration for live news, hiring, regulatory, and competitive signals. Dashboard now reads `data.webIntel`, includes `webIntel` in section state/export toggles, and renders a Live Web Intelligence section before ESG. Orchestrator runs WebIntelAgent in both PDF and ticker-only flows and returns a low-confidence placeholder with `data_gaps` when Bright Data is unavailable. | Ensures the Bright Data intelligence panel appears reliably and live web data failures are visible instead of silently hiding the section. |
| 2026-05-30 | Refined stakeholder and peer comparison UX: Stakeholder modal groups candidates by selected industry with upstream/downstream for relationship understanding and peers for comparison; selected entity analysis separates peer KPI comparison from supply-chain relationship analysis. Peer comparison now displays price and market cap in local listing currency instead of forcing USD. | Reduces duplicated/confusing stakeholder candidate lists, clarifies that only peers should be compared, and prevents misleading cross-currency peer table values such as Korean stocks shown as USD. |
| 2026-05-27 | Added EchoV data standards, base output validation with audit logging, ESGAgent, StakeholderAgent, Scheduler, AuditAgent/CostAgent placeholders, and Orchestrator integration for ESG/stakeholder outputs. Dashboard now renders structured ESG and stakeholder/management sections. | Establishes shared data contracts, exposes new analysis-layer agents in the report UI, and prepares refresh/audit/cost-control hooks for future expansion. |
| 2026-05-19 | Fixed ESG section missing from dashboard across all three modes. AnalysisDashboard: added ESG render block (Sprout icon, E/S/G pillar badges, full text) between Insights and Peer Comparison, guarded by `data.esgSummary` with skeleton while loading. ModeA: added `'esg'` to options array (was missing — FundamentalAgent never requested ESG). ModeB already had `'esg'`. ModeC: `'esg'` was already in LLMProvider dialogue enum. | esgSummary data was produced by FundamentalAgent but never rendered anywhere in the dashboard UI. |
| 2026-05-19 | Added Featherless as optional LLM provider in LLMProvider.ts. Uses OpenAI-compatible client with `baseURL: https://api.featherless.ai/v1`. Provider priority: (1) Featherless if `FEATHERLESS_API_KEY` set, (2) OpenAI default, (3) Gemini. Model configurable via `FEATHERLESS_MODEL` env var (default: `mistralai/Mistral-7B-Instruct-v0.3`). `conductDialogueStep` / `planOrchestratorToolCalls` always use OpenAI (require function calling). Featherless failures fall through to OpenAI/Gemini. Fixed metric units/baselines: FundamentalAgent now instructs LLM to use `<number><B\|M> <ISO_CODE>` format (e.g. `457.3B CNY`); QuantAgent enforces same for financials and `x`/`%` suffixes for ratios/percentages. No breaking changes. | Featherless enables cost-effective inference via open-source finance models. Consistent metric formatting eliminates "457,286 Million RMB" vs "457.29B" inconsistency across modes. |
| 2026-05-19 | Streaming partial dashboard: AnalysisDashboard now accepts `data: Partial<AnalysisResult>` + `isLoading?: boolean`. Added null-safe defaults for all fields and per-section skeleton pulse loaders (metrics grid, summary text, highlights/risks, competitors). ModeC updated to use same `partialData`/`mergePartial`/`handleEvent` streaming pattern as ModeA/B — dashboard appears as soon as first `partialData.company` arrives, with `isLoading={phase === 'analyzing'}` passed through. Header shows an "Agents running…" badge while loading. Export PDF disabled while agents are still streaming. | Dashboard fills section by section as each agent completes instead of waiting for one combined result. All three modes (A/B/C) now stream identically. |

| Date | What changed | Why |
| --- | --- | --- |
| 2026-05-19 | Major restructure: replaced single-flow UI with three independent analysis modes. Mode A (Market Analysis): ticker-only input, QuantAgent + PeerAgent + CIOAgent. Mode B (Report Analysis): PDF + ticker in parallel via new Orchestrator.runParallelAnalysis(), then CIOAgent cross-analysis. Mode C (AI Dialogue): LLM-driven chat via conductDialogueStep() with function calling, Orchestrator introduces itself, asks 2-4 clarifying questions, confirms plan, then dispatches agents. App.tsx completely restructured with three-tab layout, each tab fully independent. | Makes each input type (ticker / PDF / chatbox) a dedicated mode with no cross-contamination. Chatbox is now a true Orchestrator dialogue, not a passive filter. |
| 2026-05-19 | Tagged v2.3. Merged feature/chatbox-orchestrator and claude/optimistic-faraday-4c6381 into main. Build confirmed passing. Pushed main and v2.3 tag to origin for Vultr deploy. | Milan AI Week Hackathon release. |
| 2026-05-19 | Added true reflection loop to Orchestrator: after all agents run, detectGaps() checks each requested topic against returned content; gaps trigger CIOAgent.synthesizeFromKnowledge() which fills them using LLM training knowledge with an AI-synthesis disclaimer. Added synthesize_knowledge as a first-class planner tool so the LLM can schedule knowledge synthesis proactively. | Enables the Orchestrator to truly synthesize across agent capabilities instead of silently returning empty sections when documents lack the requested data. |
| 2026-05-19 | Bug 1: Added ticker validation in App.tsx to reject inputs containing spaces or >20 chars, directing users to the Orchestrator chatbox instead. Bug 2: Rewrote PeerAgent prompt to extract company name, sector, and geography before selecting peers; added sector-specific guidance (e.g. Chinese consumer electronics → Samsung/Apple/Lenovo, not telecom carriers). Bug 3: QuantAgent now instructs LLM to extract 15 named valuation metrics; ValuationModels shows Forward PE, PEG, ROE, Revenue Growth, EBITDA Margin; DCF calculator exposes Terminal Growth Rate as a user input; Valuation section opens by default. | Fixes chatbox/ticker confusion, irrelevant peer selection, and simplified valuation output vs V1. |
| 2026-05-18 | Added natural-language orchestration input, OpenAI function-calling tool planning, real-time agent return summaries, and checkbox fallback preservation. | Makes Orchestrator choose Fundamental, Quant, Peer, and CIO agents from user intent instead of only hardcoded input-type branching. |
| 2026-05-18 | Removed the mixed static/dynamic `services/ai` import pattern and raised the Vite chunk warning limit for the current bundle size. | Keeps `npm run build` warning-free while preserving the production ESM server output. |
| 2026-05-18 | Changed production server build output from CJS `dist/server.cjs` to ESM `dist/server.mjs` and updated the start script. | Prevents `createRequire(import.meta.url)` from breaking in production bundles. |
| 2026-05-17 | Added OpenAI prompt and output caps and reduced FundamentalAgent report text length for OpenAI-first PDF analysis. | Keeps requests under the current OpenAI tokens-per-minute limit while preserving the same agent call signatures. |
| 2026-05-17 | Stopped attaching full PDF base64 data to OpenAI requests and documented the context-window issue in `README.md`. | Prevents OpenAI-first analysis from exceeding context limits by relying on extracted/truncated report text instead of duplicating the PDF payload. |
| 2026-05-17 | Documented the fixed OpenAI schema string mismatch and added a follow-up note to review OpenAI-first compute usage in `README.md`. | Keeps the known issue history and compute-cost review task visible for future checks. |
| 2026-05-17 | Fixed OpenAI JSON schema conversion to recursively normalize Gemini schema type strings such as `STRING` to JSON Schema lowercase types. | Prevents OpenAI `response_format` validation errors during OpenAI-first analysis runs. |
| 2026-05-17 | Set the shared LLM provider to prefer OpenAI `gpt-4o`, injected `OPENAI_API_KEY` into the Vite runtime config, and repaired the local OpenAI env line format. | Allows the app to run analyses with OpenAI first while preserving Gemini as the backup provider. |
| 2026-05-17 | Added OpenAI `gpt-4o` fallback in `src/agents/LLMProvider.ts` when Gemini is missing, rate-limited, or has authentication/permission failures. | Keeps the existing agent function signatures working while allowing analyses to continue when Gemini is unavailable. |

---

## Agent 开发规范（扩展版）

### 架构分层

系统分为四层：

第一层 抓取层（Fetch）
- 只负责获取数据，不做分析
- 每个抓取 agent 对应一个数据源
- 输出：原始结构化数据 + as_of + data_source

第二层 分析层（Analysis）
- 只负责分析，不抓取数据
- 数据来自抓取层或直接数据源（如 Yahoo Finance）
- 包括：FundamentalAgent、QuantAgent、PeerAgent、ESGAgent、StakeholderAgent

第三层 合成层（Synthesis）
- 汇总所有分析层输出，生成最终结论
- 目前只有 CIOAgent

第四层 协调层（Orchestration）
- Orchestrator 负责协调所有 agent
- 根据用户选择的需求决定启动哪些 agent
- 并行调度，收集输出，检测 gap，交由合成层
- 未来会根据准确度、成本等综合权衡动态选择 agent 组合

### Data standards
- Follow DATA_STANDARDS.md before generating any agent output
- Call `validateAgentOutput()` after generating output; validation failure logs `console.warn` and does not block the flow
- Validation warnings are also persisted to SQLite `validation_log` via `logValidationWarningRemote()` (fire-and-forget)

### Adding a new agent
1. Confirm layer (Fetch / Analysis / Synthesis)
2. Create file under `src/agents/`
3. Append Input/Output interface to `src/types.ts`
4. Implement `AgentEvent` streaming output consistent with existing agents
5. Register in Orchestrator parallel dispatch (wrap with `withTimeout(30s)`)
6. Add a one-line responsibility description at the bottom of this file

### refresh_interval standard values
- Market data (price/volume): `"Every 10 minutes (trading hours)"`
- News/events: `"Hourly"`
- Announcements/filings: `"Daily 06:00"`
- Hiring count: `"Every Monday 09:00"`
- Regulatory changes: `"Every Monday 09:00"`
- ESG ratings: `"First business day of each quarter"`

### Agent timeout
All agents in `runMasterAnalysis` and `runParallelAnalysis` are wrapped with `withTimeout(AGENT_TIMEOUT_MS = 30 000 ms)`.
On timeout the agent emits a status event and returns an empty partial — analysis always completes.

### Internal control agents (placeholder — not implemented in MVP)
- AuditAgent: audits data quality, detects inconsistencies across agent outputs
- CostAgent: tracks API call costs, estimates token usage and spend

### StakeholderAgent rules
- Candidate count is capped at **5 per type** (upstream 5 + downstream 5 + peers 5 = max 15 total).
- Every candidate LLM returns must include a `ticker` (Yahoo Finance symbol) and `exchange`; private companies without a public ticker are excluded.
- Pipeline after LLM output:
  1. `resolveTickersForCandidates()` — auto-fills missing tickers via `/api/search/:name`.
  2. `deduplicateBySymbol()` — collapses duplicates by resolved Yahoo Finance symbol.
  3. `enrichCandidatesWithYahooData()` — for each ticker, fetches `/api/stock/:t/summary` and overwrites LLM data with verified Yahoo Finance ground truth: `name` ← `price.longName`, `description` ← `assetProfile.longBusinessSummary[:200]`, and (peers only) `sort_value` ← real market cap formatted as `X.XB CUR` / `X.XT CUR`.
- `top_industries` is deduplicated by industry name — only the most recent period entry is kept.
- `analyzeManagement()` tries `assetProfile.companyOfficers` first (CEO matched by `title.includes('chief executive' | 'ceo')`, CFO by `'chief financial' | 'cfo'`), falls back to LLM.
- One-shot data fetch for the UI: `getBrowseData(ticker)` returns `{ topIndustries, candidates, companyIntro }` in a single call.
- `StakeholderEntity` fields: `name`, `ticker?`, `exchange?`, `type`, `industry`, `description`, `sort_value`, `sort_metric`, `analysis?`.

### CIOAgent signal stability
- `generateInvestmentSignal()` calls `getLatestSignal(ticker)` before generating.
- If a previous signal exists, a stability clause is injected into the prompt: only change the verdict if there is clear new evidence (analyst rating change, material news, or price moved >10%).
- This prevents the signal from flipping on every run without fundamental new information.

### Currency conversion
- `src/utils/currencyConverter.ts` provides `convertToUSD(amount, fromCurrency)` using Yahoo Finance `USDXXX=X` quotes.
- `convertToUSD(1, cur)` returns **USD per 1 local unit** (e.g. `convertToUSD(1, 'KRW') ≈ 0.00074`).
- To display USD equivalent: `localPrice * convertToUSD(1, currency)` — never invert this rate.
- Rates are cached in-memory for 10 minutes.
- `getRateDateLabel()` returns today as `YYYY-MM-DD`.

### Signal history
- Every completed analysis with an `investmentSignal` is persisted to SQLite `analysis_log` via `saveAnalysisLog()`.
- `SignalTimeline` component (`src/components/SignalTimeline.tsx`) fetches `/api/log/history/:ticker` and renders a collapsible timeline.
- Server routes: `POST /api/log/analysis`, `GET /api/log/analysis/:ticker` (alias: `GET /api/log/history/:ticker`), `POST /api/log/validation`.

### WatchlistDashboard architecture

**Views:**
- `portfolio` — default; summary cards + holdings table + Refresh All
- `{ticker}` — individual stock tab; Signal card + Price card + News + Compliance + Signal History

**State model:**
- `watchlist` — persisted in localStorage (`echo_watchlist_v2`); default seeds **Magnificent 7** (AAPL MSFT NVDA GOOGL AMZN META TSLA) if empty
- `openTabs` — persisted in `echo_open_tabs_v1` (open ticker tabs survive Mode switches)
- `activeView` — persisted in `echo_active_view_v1` (`'portfolio'` or ticker)
- `quotes` — Yahoo Finance price + `description` / `sector` / `industry` from `assetProfile`
- `signals` — signal history per ticker from `/api/log/history/:ticker`
- `liveData` — webIntel + compliance per ticker (React state; localStorage is a backing cache only, never read in render)
  - Initialised from localStorage on mount via `loadCachedLiveData()`
  - Updated after every refresh; written back via `persistLiveData()`
- `settings` — `EchoSettings` persisted in `echo_settings_v1` (auto-refresh + per-data-type freshness intervals)

**Refresh modes:**
| Mode | Endpoint | Queries | CIOAgent |
|---|---|---|---|
| Portfolio row / Refresh All / Auto-refresh | `POST /api/portfolio-refresh/:ticker` | Risk-focused (warning/lawsuit/regulation + bad news) + 3 compliance | ✅ client-side after |
| Individual stock Refresh data | `POST /api/refresh/:ticker` | Broad news (Reuters/Bloomberg/WSJ + product + analyst) + 3 compliance | ❌ |
| Full analysis (Mode A/B/C) | Orchestrator pipeline | All agents | ✅ |

**Refresh All:** serial loop — one ticker at a time to avoid Bright Data rate limits.

**Auto-refresh:** `setInterval(checkAndRefresh, 60_000)` checks ET hour against `4 PM + settings.delayHours`. Fires `refreshAllTickers()` once per ET calendar day (`echo_last_auto_refresh`).

**Stale badge:** Portfolio table rows compare `liveData[t].refreshedAt` against `settings.intervals.news` — stale rows show amber `AlertCircle` + amber timestamp.

**Stakeholder browse (one-page modal):**
- Opens via the Stakeholder button on individual stock view.
- Calls `StakeholderAgent.getBrowseData(ticker)` once on mount.
- Displays: company intro · top 5 revenue segments · top 5 upstream / downstream / peers.
- Each entity row with a resolved ticker is clickable → adds to watchlist (if new), fetches data, opens its monitor tab. **No analysis is triggered unless the user clicks Run Full Analysis inside that tab.**

**localStorage keys (full list):**
- `echo_watchlist_v2` — watchlist items
- `echo_open_tabs_v1`, `echo_active_view_v1` — open tabs / active view (survives mode switches)
- `echo_webintel_{ticker}`, `echo_compliance_{ticker}` — refresh data cache
- `echo_settings_v1` — Settings panel state
- `echo_last_auto_refresh` — ET YYYY-MM-DD, prevents duplicate auto-refresh runs
- `echo_modea_tabs_v1`, `echo_modea_active_v1`, `echo_modea_data_{ticker}` — Market Analysis tabs

**Server endpoints for Dashboard:**
- `POST /api/portfolio-refresh/:ticker` — risk-focused news + compliance + Yahoo Finance price
- `POST /api/refresh/:ticker` — broad news + compliance + Yahoo Finance price
- `GET  /api/esg/:ticker` — 3 parallel SERP queries (E / S / G) for ESGAgent
- `GET  /api/log/history/:ticker` — signal history (alias for `/api/log/analysis/:ticker`)
- `GET  /api/stock/:ticker/summary` — now includes `assetProfile` module (officers, longBusinessSummary)

### Market Analysis tabs (Mode A)

Mirror of Portfolio's tab system, persisted independently:
- `echo_modea_tabs_v1` — ordered list of open ticker strings
- `echo_modea_active_v1` — `'new'` (search form) or ticker
- `echo_modea_data_{ticker}` — full `AnalysisResult` saved on completion
- New `+ New` button always available; "Recent: AAPL MSFT…" chips appear on the search form when tabs exist
- Quick-search bar + "Re-run TICKER" button shown above each completed dashboard

### Settings panel

`src/components/SettingsPanel.tsx` — slide-in drawer triggered by the ⚙ button on the inner tab bar. Settings type:
```ts
{
  autoRefresh: {
    enabled: boolean;
    delayHours: 1 | 2 | 4 | 8;     // hours after 4 PM ET
    days: 'weekdays' | 'friday';
    includeNewsCompliance: boolean;
    includeSignal: boolean;
  };
  intervals: {
    price:      'off' | '15min' | '1h' | '4h' | 'daily';
    news:       'off' | 'daily' | 'weekly';
    compliance: 'off' | 'daily' | 'weekly' | 'monthly';
    signal:     'off' | 'after_refresh' | 'weekly';
  };
}
```

### AnalysisDashboard layout rules

- `InvestmentSignalBanner` is **always** rendered below the header as a full-width row — never inside the header toolbar.
- Header is one compact row: company identity left, price chip + 4 icon buttons right.
- All section visibility can be overridden via `sectionOverrides` prop (used by WatchlistDashboard's module toggles).

### Agent registry (one-line responsibilities)
- **FundamentalAgent** — extracts financials, metrics, highlights, risks, and ticker from PDF reports
- **QuantAgent** — fetches live market price, valuation multiples, and technical trend from Yahoo Finance
- **PeerAgent** — identifies 3–5 sector-relevant publicly traded competitors; retries once if fewer than 3 returned
- **ESGAgent** — three-tier data source: Bright Data SERP (`/api/esg/:ticker`, 3 parallel queries) → PDF text extraction → unavailable
- **StakeholderAgent** — maps upstream/downstream/peer entities (top 5 each) with auto-resolved tickers, enriched via Yahoo Finance `assetProfile` (longName / longBusinessSummary / market cap); management via `companyOfficers`. One-shot UI helper: `getBrowseData(ticker)`
- **WebIntelAgent** — fetches live news (3 parallel queries), hiring trend (concrete evidence parsing — skips when no specific numbers / phrases found), regulatory alerts, and competitive signals via Bright Data SERP
- **ComplianceAlertAgent** — runs 3 parallel SERP searches (regulatory / legal / ESG compliance) and classifies urgency
- **CIOAgent** — synthesises all agent outputs into cross-analysis, valuation opinion, and BUY/HOLD/SELL signal with stability constraint
- **AuditAgent** — placeholder; reserved for output consistency auditing
- **CostAgent** — placeholder; reserved for API cost tracking
