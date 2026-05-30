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
    return (result.top_industries || []).slice(0, 5);
  }

  private static async buildCandidates(
    ticker: string,
    industries: string[],
    selectionMode: "specific" | "comprehensive"
  ): Promise<StakeholderEntity[]> {
    if (industries.length === 0) return [];

    const perIndustryLimit = selectionMode === "comprehensive" ? 3 : 5;
    const allCandidates = await Promise.all(
      industries.map(industry => this.identifyCandidatesForIndustry(ticker, industry, perIndustryLimit))
    );
    const flattened = allCandidates.flat();

    // Normalize and deduplicate by Yahoo Finance symbol
    const deduped = await deduplicateBySymbol(flattened);

    if (selectionMode === "specific") {
      return deduped;
    }

    return [
      ...this.takeSortedByType(deduped, "upstream", 5),
      ...this.takeSortedByType(deduped, "downstream", 5),
      ...this.takeSortedByType(deduped, "peer", 5)
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
            name: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["upstream", "downstream", "peer"] },
            industry: { type: Type.STRING },
            description: { type: Type.STRING },
            sort_value: { type: Type.STRING },
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

      Each candidate must include:
      name, type, industry, one-sentence description, sort_value, sort_metric.

      Rules:
      - sort_metric must be "transaction_volume" for upstream/downstream and "market_cap" for peers.
      - If public transaction volume or market cap is unavailable, keep the entity and set sort_value to "no_public_data".
      - For entries with no public data, set description to "no_public_data".
      - Do not drop private or important supply-chain entities only because data is missing.
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["candidates"]);
    return this.normalizeCandidates(result.candidates || [], industry);
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

  private static async analyzeManagement(ticker: string): Promise<ManagementInfo> {
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
