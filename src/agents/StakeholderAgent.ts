import { Type } from "@google/genai";
import type { AgentEvent } from "./Orchestrator";
import { runGenerativeAI } from "./LLMProvider";
import type {
  IndustryRevenue,
  ManagementInfo,
  StakeholderEntity,
  StakeholderOutput
} from "../types";
import { validateAgentOutput } from "../utils/validateOutput";
import { deduplicateBySymbol } from "../utils/entityNormalizer";

interface StakeholderAgentInput {
  ticker: string;
  selectedIndustries?: string[];
  selectionMode?: "specific" | "comprehensive";
  selectedEntityNames?: string[];
}

interface StakeholderSelectionInput {
  ticker: string;
  topIndustries: IndustryRevenue[];
  selectedIndustries: string[];
  selectionMode: "specific" | "comprehensive";
  candidates: StakeholderEntity[];
  selectedEntityNames: string[];
  selectedEntityKeys?: string[];
}

const REFRESH_INTERVAL = "Every Monday 09:00";

export class StakeholderAgent {
  static async getTopIndustries(ticker: string): Promise<IndustryRevenue[]> {
    return await this.identifyTopIndustries(ticker);
  }

  static async getCandidates(
    ticker: string,
    industries: string[],
    selectionMode: "specific" | "comprehensive"
  ): Promise<StakeholderEntity[]> {
    return await this.buildCandidates(ticker, industries, selectionMode);
  }

  /**
   * One-shot data fetch for the stakeholder browse view:
   * returns company intro, top industries, and all upstream/downstream/peer
   * candidates ready to display.
   */
  static async getBrowseData(
    ticker: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<{
    topIndustries: IndustryRevenue[];
    candidates: StakeholderEntity[];
    companyIntro: string;
  }> {
    onEvent?.({ agent: "StakeholderAgent", status: `Loading top industries for ${ticker}…` });
    const topIndustries = await this.identifyTopIndustries(ticker);
    const industryNames = topIndustries.map(i => i.industry);

    onEvent?.({ agent: "StakeholderAgent", status: `Loading stakeholders across ${industryNames.length} segments…` });
    const [candidates, companyIntro] = await Promise.all([
      this.buildCandidates(ticker, industryNames, "comprehensive"),
      this.generateCompanyIntro(ticker, industryNames),
    ]);

    return { topIndustries, candidates, companyIntro };
  }

  static async runSelectedAnalysis(
    input: StakeholderSelectionInput,
    onEvent?: (event: AgentEvent) => void
  ): Promise<StakeholderOutput> {
    const selectedKeys = new Set((input.selectedEntityKeys || []).map(key => key.toLowerCase()));
    const selectedNames = new Set(input.selectedEntityNames.map(name => name.toLowerCase()));
    const selectedEntities = selectedKeys.size > 0
      ? input.candidates.filter(candidate => selectedKeys.has(this.entityKey(candidate).toLowerCase()))
      : input.candidates.filter(candidate => selectedNames.has(candidate.name.toLowerCase()));

    onEvent?.({
      agent: "StakeholderAgent",
      status: `Analyzing ${selectedEntities.length} selected stakeholder entities...`
    });

    const analyzedEntities = await this.analyzeSelectedEntities(input.ticker, selectedEntities);
    const management = await this.analyzeManagement(input.ticker);
    const companyIntro = await this.generateCompanyIntro(input.ticker, input.selectedIndustries);

    const output: StakeholderOutput = {
      as_of: new Date().toISOString(),
      data_source: "llm_synthesis",
      confidence: input.selectedIndustries.length > 0 ? "medium" : "low",
      refresh_interval: REFRESH_INTERVAL,
      top_industries: input.topIndustries,
      selected_industries: input.selectedIndustries,
      selection_mode: input.selectionMode,
      candidates: input.candidates,
      selected_entities: analyzedEntities,
      management,
      company_intro: companyIntro
    };

    validateAgentOutput("StakeholderAgent", output);
    onEvent?.({
      agent: "StakeholderAgent",
      status: "Complete",
      partial: { stakeholder: output } as any
    });

    return output;
  }

  static async runAutonomousAnalysis(
    input: StakeholderAgentInput,
    onEvent?: (event: AgentEvent) => void
  ): Promise<StakeholderOutput> {
    onEvent?.({ agent: "StakeholderAgent", status: `Identifying top revenue industries for ${input.ticker}...` });

    const topIndustries = await this.identifyTopIndustries(input.ticker);
    onEvent?.({
      agent: "StakeholderAgent",
      status: `Industry options ready: ${topIndustries.map(item => `${item.industry} ${item.revenue_share_pct}%`).join(", ")}`,
      partial: { stakeholderTopIndustries: topIndustries } as any
    });

    const selectionMode = input.selectionMode || "comprehensive";
    const selectedIndustries = selectionMode === "comprehensive"
      ? topIndustries.map(item => item.industry)
      : (input.selectedIndustries || []).filter(Boolean);

    onEvent?.({
      agent: "StakeholderAgent",
      status: selectionMode === "comprehensive"
        ? "Using comprehensive industry mode"
        : `Using selected industries: ${selectedIndustries.join(", ") || "none selected"}`
    });

    const candidates = await this.buildCandidates(input.ticker, selectedIndustries, selectionMode);
    onEvent?.({
      agent: "StakeholderAgent",
      status: `Candidate list ready: ${candidates.length} entities`,
      partial: { stakeholderCandidates: candidates } as any
    });

    const selectedNames = new Set((input.selectedEntityNames || []).map(name => name.toLowerCase()));
    const selectedEntities = selectedNames.size > 0
      ? candidates.filter(candidate => selectedNames.has(candidate.name.toLowerCase()))
      : [];

    onEvent?.({
      agent: "StakeholderAgent",
      status: selectedEntities.length > 0
        ? `Analyzing ${selectedEntities.length} selected stakeholder entities...`
        : "No stakeholder entities selected for deep analysis"
    });

    const analyzedEntities = await this.analyzeSelectedEntities(input.ticker, selectedEntities);
    const management = await this.analyzeManagement(input.ticker);
    const companyIntro = await this.generateCompanyIntro(input.ticker, selectedIndustries);

    const output: StakeholderOutput = {
      as_of: new Date().toISOString(),
      data_source: "llm_synthesis",
      confidence: selectedIndustries.length > 0 ? "medium" : "low",
      refresh_interval: REFRESH_INTERVAL,
      top_industries: topIndustries,
      selected_industries: selectedIndustries,
      selection_mode: selectionMode,
      candidates,
      selected_entities: analyzedEntities,
      management,
      company_intro: companyIntro
    };

    validateAgentOutput("StakeholderAgent", output);
    onEvent?.({
      agent: "StakeholderAgent",
      status: "Complete",
      partial: { stakeholder: output } as any
    });

    return output;
  }

  private static async identifyTopIndustries(ticker: string): Promise<IndustryRevenue[]> {
    const schemaProperties = {
      top_industries: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["industry", "revenue_share_pct", "period"],
          properties: {
            industry: { type: Type.STRING },
            revenue_share_pct: { type: Type.NUMBER },
            period: { type: Type.STRING }
          }
        }
      }
    };

    const prompt = `
      Identify the top 5 revenue industries or business segments for ticker ${ticker}, based on the most recent two fiscal years of public reporting.
      Return approximate revenue share percentages by industry/segment.
      Use public filings or public company disclosures where available.
      If exact percentages are unavailable, provide the best public-disclosure estimate and keep the period explicit.
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["top_industries"]);
    const raw: IndustryRevenue[] = result.top_industries || [];

    // Deduplicate by industry name — keep the entry with the most recent period.
    // "Most recent" = lexicographically largest period string (FY2024 > FY2023, Q4 2024 > Q3 2023).
    const byIndustry = new Map<string, IndustryRevenue>();
    for (const item of raw) {
      const key = item.industry.trim().toLowerCase();
      const existing = byIndustry.get(key);
      if (!existing || item.period > existing.period) {
        byIndustry.set(key, item);
      }
    }
    return [...byIndustry.values()].slice(0, 5);
  }

  private static async buildCandidates(
    ticker: string,
    industries: string[],
    selectionMode: "specific" | "comprehensive"
  ): Promise<StakeholderEntity[]> {
    if (industries.length === 0) return [];

    const perIndustryLimit = 5; // top 5 per type (upstream 5 + downstream 5 + peers 5 = max 15)
    const allCandidates = await Promise.all(
      industries.map(industry => this.identifyCandidatesForIndustry(ticker, industry, perIndustryLimit))
    );
    const flattened = allCandidates.flat();

    // Normalize and deduplicate by Yahoo Finance symbol
    const deduped = await deduplicateBySymbol(flattened);

    // Enrich with real Yahoo Finance data (market cap, confirmed name)
    const enriched = await this.enrichCandidatesWithYahooData(deduped);

    if (selectionMode === "specific") {
      return enriched;
    }

    return [
      ...this.takeSortedByType(enriched, "upstream", 5),
      ...this.takeSortedByType(enriched, "downstream", 5),
      ...this.takeSortedByType(enriched, "peer", 5)
    ];
  }

  private static async identifyCandidatesForIndustry(
    ticker: string,
    industry: string,
    limitPerType: number
  ): Promise<StakeholderEntity[]> {
    const schemaProperties = {
      candidates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["name", "type", "industry", "description", "sort_value", "sort_metric"],
          properties: {
            name:        { type: Type.STRING },
            ticker:      { type: Type.STRING, description: "Stock ticker symbol (e.g. AAPL, 005930.KS, 0700.HK). Required for public companies." },
            exchange:    { type: Type.STRING, description: "Exchange name (NYSE, NASDAQ, HKEX, KRX, SSE, SZSE, TSE, etc.)" },
            type:        { type: Type.STRING, enum: ["upstream", "downstream", "peer"] },
            industry:    { type: Type.STRING },
            description: { type: Type.STRING },
            sort_value:  { type: Type.STRING },
            sort_metric: { type: Type.STRING, enum: ["transaction_volume", "market_cap"] }
          }
        }
      }
    };

    const prompt = `
      For ticker ${ticker} and industry "${industry}", identify stakeholder candidates:
      - top ${limitPerType} upstream companies by transaction volume with the target company
      - top ${limitPerType} downstream companies by transaction volume with the target company
      - top ${limitPerType} public peers by market capitalization

      Each candidate MUST include: name, type, industry, one-sentence description, sort_value, sort_metric.

      CRITICAL — ticker requirement:
      For each company you identify, you MUST provide:
      - ticker: the stock ticker symbol compatible with Yahoo Finance (e.g. AAPL, 005930.KS, 0700.HK, 9988.HK)
      - exchange: the exchange it trades on (NYSE, NASDAQ, HKEX, KRX, SSE, SZSE, TSE, etc.)
      If you cannot identify the public ticker for a company, DO NOT include that company.
      Only include publicly listed companies with verifiable ticker symbols.

      Other rules:
      - sort_metric must be "transaction_volume" for upstream/downstream and "market_cap" for peers.
      - If public transaction volume or market cap is unavailable, set sort_value to "no_public_data".
      - For entries with no public data, set description to "no_public_data".
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["candidates"]);
    const rawCandidates = this.normalizeCandidates(result.candidates || [], industry);

    // Auto-resolve tickers: use LLM-provided ticker first, fall back to /api/search/:name
    return await this.resolveTickersForCandidates(rawCandidates);
  }

  private static async analyzeSelectedEntities(
    ticker: string,
    entities: StakeholderEntity[]
  ): Promise<StakeholderEntity[]> {
    if (entities.length === 0) return [];

    const schemaProperties = {
      selected_entities: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["name", "type", "industry", "description", "sort_value", "sort_metric", "analysis"],
          properties: {
            name: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["upstream", "downstream", "peer"] },
            industry: { type: Type.STRING },
            description: { type: Type.STRING },
            sort_value: { type: Type.STRING },
            sort_metric: { type: Type.STRING, enum: ["transaction_volume", "market_cap"] },
            analysis: { type: Type.STRING }
          }
        }
      }
    };

    const prompt = `
      Generate detailed stakeholder analysis for ticker ${ticker}.
      Analyze ONLY these user-selected entities; ignore all others:
      ${JSON.stringify(entities)}

      For each selected entity, preserve the original fields and add analysis covering:
      - If type is "peer": compare it with ${ticker} using key performance indicators only, excluding valuation.
        Focus on market overview, scale, market position, revenue growth, margin quality, cash/debt posture, operating leverage, and financial resilience where public data exists.
      - If type is "upstream" or "downstream": do NOT compare performance against ${ticker}.
        Explain its supply-chain/channel relationship, dependency, bargaining power, concentration risk, switching risk, and what the target company should monitor.
      - For every entity: include key risk/opportunity signals.

      Do NOT analyze valuation multiples, target price, DCF, P/E, P/B, EV/EBITDA, or whether the selected entity is cheap/expensive.
      If KPI data is not public, say so clearly and explain what data would be needed.
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["selected_entities"]);
    return this.normalizeCandidates(result.selected_entities || entities, "").map((entity, index) => ({
      ...entities[index],
      ...entity,
      analysis: entity.analysis || entities[index]?.analysis || ""
    }));
  }

  /**
   * Enriches candidate entities with real Yahoo Finance data.
   * - Peers: replaces sort_value with actual market cap from Yahoo Finance
   * - All entities: confirms company longName if available
   * - Falls back to LLM-provided data on any error
   */
  private static async enrichCandidatesWithYahooData(
    candidates: StakeholderEntity[]
  ): Promise<StakeholderEntity[]> {
    return Promise.all(candidates.map(async (entity) => {
      if (!entity.ticker || entity.ticker === "N/A") return entity;
      try {
        const res = await fetch(`/api/stock/${encodeURIComponent(entity.ticker)}/summary`);
        if (!res.ok) return entity;
        const data = await res.json();
        const price = data.price || {};
        const marketCap: number | undefined = price.marketCap || data.summaryDetail?.marketCap;
        const currency: string = price.currency || "USD";
        const longName: string = price.longName || price.shortName || "";

        let enriched = { ...entity };

        // Update display name with official Yahoo Finance name
        if (longName) enriched.name = longName;

        // For peers: replace sort_value with real market cap
        if (entity.type === "peer" && marketCap && marketCap > 0) {
          if (marketCap >= 1e12)      enriched.sort_value = `${(marketCap / 1e12).toFixed(1)}T ${currency}`;
          else if (marketCap >= 1e9)  enriched.sort_value = `${(marketCap / 1e9).toFixed(1)}B ${currency}`;
          else if (marketCap >= 1e6)  enriched.sort_value = `${(marketCap / 1e6).toFixed(1)}M ${currency}`;
          else                        enriched.sort_value = `${marketCap.toLocaleString()} ${currency}`;
          enriched.description = price.longBusinessSummary?.slice(0, 200)
            || (data.assetProfile?.longBusinessSummary?.slice(0, 200))
            || enriched.description;
        }

        // For upstream/downstream: at least confirm the company is real
        if (entity.sort_value === "no_public_data" && longName) {
          enriched.description = data.assetProfile?.longBusinessSummary?.slice(0, 200) || enriched.description;
        }

        return enriched;
      } catch {
        return entity;
      }
    }));
  }

  /**
   * Fetches management info: tries Yahoo Finance assetProfile first (real names),
   * falls back to LLM if Yahoo Finance returns no officers.
   */
  private static async analyzeManagement(ticker: string): Promise<ManagementInfo> {
    // ── Try Yahoo Finance assetProfile first ─────────────────────────────────
    try {
      const res = await fetch(`/api/stock/${encodeURIComponent(ticker)}/summary`);
      if (res.ok) {
        const data = await res.json();
        const officers: any[] = data.assetProfile?.companyOfficers || [];

        const findOfficer = (keywords: string[]) =>
          officers.find(o =>
            keywords.some(kw => (o.title || "").toLowerCase().includes(kw))
          );

        const ceoData = findOfficer(["chief executive", " ceo", "(ceo)"]);
        const cfoData = findOfficer(["chief financial", " cfo", "(cfo)"]);

        if (ceoData || cfoData) {
          // Estimate tenure from Yahoo Finance's yearBorn vs current year (rough proxy)
          // Yahoo Finance doesn't expose hire date — leave as null
          return {
            ceo: {
              name: ceoData?.name ?? null,
              tenure_years: null,
              recent_changes: []
            },
            cfo: {
              name: cfoData?.name ?? null,
              tenure_years: null,
              recent_changes: []
            },
            compensation_alignment: "neutral"
          };
        }
      }
    } catch {
      // Fall through to LLM
    }

    // ── LLM fallback ─────────────────────────────────────────────────────────
    const schemaProperties = {
      management: {
        type: Type.OBJECT,
        required: ["ceo", "cfo", "compensation_alignment"],
        properties: {
          ceo: {
            type: Type.OBJECT,
            required: ["name", "tenure_years", "recent_changes"],
            properties: {
              name: { type: Type.STRING, nullable: true },
              tenure_years: { type: Type.NUMBER, nullable: true },
              recent_changes: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          },
          cfo: {
            type: Type.OBJECT,
            required: ["name", "tenure_years", "recent_changes"],
            properties: {
              name: { type: Type.STRING, nullable: true },
              tenure_years: { type: Type.NUMBER, nullable: true },
              recent_changes: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          },
          compensation_alignment: {
            type: Type.STRING,
            enum: ["aligned", "misaligned", "neutral"]
          }
        }
      }
    };

    const prompt = `
      Summarize current management information for ticker ${ticker}.
      Include CEO, CFO, tenure in years where publicly disclosed, recent management changes, and whether compensation appears aligned, misaligned, or neutral.
      If a field is not publicly disclosed, use null for name/tenure and an empty array for recent_changes.
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["management"]);
    return this.normalizeManagement(result.management);
  }

  private static async generateCompanyIntro(ticker: string, industries: string[]): Promise<string> {
    const schemaProperties = {
      company_intro: { type: Type.STRING }
    };

    const prompt = `
      Write a concise one-paragraph company introduction for ticker ${ticker}.
      Mention the selected industries if relevant: ${industries.join(", ") || "none"}.
      Keep it factual and suitable for an investment analysis report.
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["company_intro"]);
    return result.company_intro || "";
  }

  private static normalizeCandidates(candidates: any[], fallbackIndustry: string): StakeholderEntity[] {
    return candidates.map(candidate => {
      const type = ["upstream", "downstream", "peer"].includes(candidate.type)
        ? candidate.type
        : "peer";
      const sortMetric = type === "peer" ? "market_cap" : "transaction_volume";
      const sortValue = candidate.sort_value || "no_public_data";

      return {
        name: candidate.name || "no_public_data",
        ticker: candidate.ticker || undefined,
        exchange: candidate.exchange || undefined,
        type,
        industry: candidate.industry || fallbackIndustry,
        description: sortValue === "no_public_data"
          ? "no_public_data"
          : (candidate.description || "no_public_data"),
        sort_value: sortValue,
        sort_metric: candidate.sort_metric || sortMetric,
        analysis: candidate.analysis
      } as StakeholderEntity;
    });
  }

  /**
   * For each candidate:
   * 1. If the LLM provided a ticker, validate it against Yahoo Finance search.
   * 2. If no ticker, query /api/search/:name to resolve one.
   * 3. If still unresolvable, mark sort_value as "no_public_data".
   * All failures are silent — the candidate is kept regardless.
   */
  private static async resolveTickersForCandidates(
    candidates: StakeholderEntity[]
  ): Promise<StakeholderEntity[]> {
    return Promise.all(
      candidates.map(async (entity) => {
        // Already has a ticker from LLM — trust it (Yahoo Finance will validate at render time)
        if (entity.ticker) return entity;

        // No ticker: try search API by company name
        try {
          const res = await fetch(`/api/search/${encodeURIComponent(entity.name)}`);
          if (!res.ok) return entity;
          const data = await res.json();
          const quotes: any[] = data.quotes || [];
          const match = quotes.find(
            (q) => q.typeDisp === "Equity" || q.quoteType === "EQUITY"
          ) || quotes[0];
          if (match?.symbol) {
            return {
              ...entity,
              ticker: match.symbol,
              exchange: match.exchange || entity.exchange,
            };
          }
        } catch {
          // silent — keep entity as-is
        }
        return entity;
      })
    );
  }

  private static normalizeManagement(management: any): ManagementInfo {
    return {
      ceo: {
        name: management?.ceo?.name || null,
        tenure_years: typeof management?.ceo?.tenure_years === "number" ? management.ceo.tenure_years : null,
        recent_changes: Array.isArray(management?.ceo?.recent_changes) ? management.ceo.recent_changes : []
      },
      cfo: {
        name: management?.cfo?.name || null,
        tenure_years: typeof management?.cfo?.tenure_years === "number" ? management.cfo.tenure_years : null,
        recent_changes: Array.isArray(management?.cfo?.recent_changes) ? management.cfo.recent_changes : []
      },
      compensation_alignment: ["aligned", "misaligned", "neutral"].includes(management?.compensation_alignment)
        ? management.compensation_alignment
        : null
    };
  }

  private static takeSortedByType(
    candidates: StakeholderEntity[],
    type: StakeholderEntity["type"],
    limit: number
  ): StakeholderEntity[] {
    return candidates
      .filter(candidate => candidate.type === type)
      .sort((a, b) => this.sortValueToNumber(b.sort_value) - this.sortValueToNumber(a.sort_value))
      .slice(0, limit);
  }

  private static entityKey(entity: StakeholderEntity): string {
    return `${entity.type}|${entity.industry}|${entity.name}`;
  }

  private static sortValueToNumber(value: string): number {
    if (value === "no_public_data") return Number.NEGATIVE_INFINITY;
    const normalized = value.replace(/,/g, "").trim().toUpperCase();
    const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*([BMK])?/);
    if (!match) return Number.NEGATIVE_INFINITY;

    const number = Number(match[1]);
    const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
    return number * multiplier;
  }
}
