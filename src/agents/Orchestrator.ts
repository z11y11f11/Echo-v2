import { AnalysisResult, CrossAnalysisResult, ValuationSummary, ValuationVerdictResult } from "../types";
import { saveAnalysisLog } from "../utils/db";
import { FundamentalAgent } from "./FundamentalAgent";
import { QuantAgent } from "./QuantAgent";
import { PeerAgent } from "./PeerAgent";
import { ESGAgent } from "./ESGAgent";
import { StakeholderAgent } from "./StakeholderAgent";
import { WebIntelAgent } from "./WebIntelAgent";
import { ComplianceAlertAgent } from "./ComplianceAlertAgent";
import { CIOAgent } from "./CIOAgent";
import { OrchestratorToolCall, planOrchestratorToolCalls } from "./LLMProvider";

/** Carries both a status string and an optional partial result when an agent completes. */
export type AgentEvent = {
  agent: string;
  status: string;
  /** Set when an agent has just completed — contains the data it produced. */
  partial?: Partial<AnalysisResult>;
};

export class OrchestratorAgent {
  /**
   * The single entry point for a truly autonomous multi-agent system.
   * It delegates tasks to sub-agents without UI intervention.
   */
  static async runMasterAnalysis(
    input: { ticker?: string; file?: File; options: string[]; userRequest?: string },
    onEvent: (event: AgentEvent) => void
  ): Promise<AnalysisResult> {
    onEvent({ agent: "Orchestrator", status: "Initializing Master Analysis" });
    
    let result: Partial<AnalysisResult> = {};
    const hasNaturalLanguageRequest = Boolean(input.userRequest?.trim());
    const toolPlan = hasNaturalLanguageRequest
      ? await this.planWithLLM(input, onEvent)
      : this.planFromCheckboxFallback(input);

    // Split plan into two dependency groups:
    //   Group 1 (independent) — can run in parallel
    //   Group 2 (needs group 1 results) — must run after
    const GROUP1: OrchestratorToolCall["name"][] = ["fetch_market_data", "analyze_document", "compare_peers"];
    const group1 = toolPlan.filter(t => (GROUP1 as string[]).includes(t.name));
    const group2 = toolPlan.filter(t => !(GROUP1 as string[]).includes(t.name));

    onEvent({
      agent: "Orchestrator",
      status: `Parallel: [${group1.map(t => t.name).join(", ")}] → then: [${group2.map(t => t.name).join(", ") || "—"}]`
    });

    // ── Group 1: parallel ────────────────────────────────────────────────
    const group1Results = await Promise.allSettled(
      group1.map(toolCall => this.executeToolCall(toolCall, result, input, onEvent))
    );
    for (const settled of group1Results) {
      if (settled.status === "fulfilled") {
        result = this.mergePartial(result, settled.value);
      }
    }

    // ── Group 2: sequential (needs accumulated result from group 1) ──────
    for (const toolCall of group2) {
      const contribution = await this.executeToolCall(toolCall, result, input, onEvent);
      result = this.mergePartial(result, contribution);
    }

    // ── Reflection: fill any gaps with LLM knowledge ─────────────────────
    const gaps = this.detectGaps(input.options, input.userRequest || "", result);
    if (gaps.length > 0) {
      onEvent({ agent: "Orchestrator", status: `Reflection: gaps [${gaps.join(", ")}] — synthesising from LLM knowledge...` });
      await this.fillGapsWithKnowledge(gaps, result, input, onEvent);
    }

    if ((result as any).investmentSignal && result.company?.ticker) {
      saveAnalysisLog(result.company.ticker, (result as any).investmentSignal, result.company.name || "");
    }
    onEvent({ agent: "Orchestrator", status: "Analysis Complete" });
    return result as AnalysisResult;
  }

  private static async planWithLLM(
    input: { ticker?: string; file?: File; options: string[]; userRequest?: string },
    onEvent: (event: AgentEvent) => void
  ): Promise<OrchestratorToolCall[]> {
    onEvent({ agent: "Orchestrator", status: "Interpreting natural language request with function calling" });
    try {
      const llmPlan = await planOrchestratorToolCalls({
        userRequest: input.userRequest || "",
        ticker: input.ticker,
        hasDocument: Boolean(input.file),
        fallbackOptions: input.options
      });

      if (llmPlan.length > 0) return llmPlan;
      onEvent({ agent: "Orchestrator", status: "LLM returned no tools; using checkbox fallback" });
    } catch (error: any) {
      onEvent({ agent: "Orchestrator", status: `Planner unavailable; using checkbox fallback (${error.message || "unknown error"})` });
    }
    return this.planFromCheckboxFallback(input);
  }

  private static planFromCheckboxFallback(input: { ticker?: string; file?: File; options: string[] }): OrchestratorToolCall[] {
    const plan: OrchestratorToolCall[] = [];
    if (input.ticker) {
      plan.push({ name: "fetch_market_data", arguments: { ticker: input.ticker, options: input.options } });
    }
    if (input.file) {
      plan.push({ name: "analyze_document", arguments: { options: input.options } });
    }
    if (input.options.includes('competitors')) {
      plan.push({ name: "compare_peers", arguments: {} });
    }
    if (input.ticker && input.file) {
      plan.push({ name: "synthesize_verdict", arguments: {} });
    }
    return plan;
  }

  /**
   * Merges a partial result into the accumulator.
   * Arrays (metrics, highlights, risks) are deduplicated rather than replaced.
   */
  private static mergePartial(
    acc: Partial<AnalysisResult>,
    incoming: Partial<AnalysisResult>
  ): Partial<AnalysisResult> {
    const merged = { ...acc, ...incoming };
    // Deduplicate metrics by label
    if (acc.metrics && incoming.metrics) {
      const existingLabels = new Set(acc.metrics.map(m => m.label));
      merged.metrics = [...acc.metrics, ...incoming.metrics.filter(m => !existingLabels.has(m.label))];
    }
    // Append highlights and risks rather than overwrite
    if (acc.highlights && incoming.highlights) {
      const seen = new Set(acc.highlights.map(h => h.trim()));
      merged.highlights = [...acc.highlights, ...incoming.highlights.filter(h => !seen.has(h.trim()))];
    }
    if (acc.risks && incoming.risks) {
      const seen = new Set(acc.risks.map(r => r.trim()));
      merged.risks = [...acc.risks, ...incoming.risks.filter(r => !seen.has(r.trim()))];
    }
    // Keep fundamental company identity when both exist
    if (acc.company && incoming.company && !acc.company.ticker.includes('.') && !acc.company.ticker) {
      merged.company = incoming.company;
    }
    return merged;
  }

  /**
   * Executes a single tool call and returns its Partial<AnalysisResult> contribution.
   * Also emits onEvent with the partial when the agent completes.
   */
  private static async executeToolCall(
    toolCall: OrchestratorToolCall,
    currentResult: Partial<AnalysisResult>,
    input: { ticker?: string; file?: File; options: string[]; userRequest?: string },
    onEvent: (event: AgentEvent) => void
  ): Promise<Partial<AnalysisResult>> {
    switch (toolCall.name) {
      case "fetch_market_data": {
        const ticker = toolCall.arguments.ticker || input.ticker;
        if (!ticker) { onEvent({ agent: "QuantAgent", status: "Skipped: no ticker available" }); return {}; }
        onEvent({ agent: "Orchestrator", status: "Calling fetch_market_data → QuantAgent + WebIntelAgent + ComplianceAlertAgent" });
        try {
          const companyName = currentResult.company?.name || input.userRequest || ticker;
          const [quantRes, webIntelRes, complianceRes] = await Promise.all([
            QuantAgent.runAutonomousAnalysis(
              ticker, toolCall.arguments.options || input.options,
              (s) => onEvent({ agent: "QuantAgent", status: s.replace("QuantAgent: ", "") })
            ).catch((e: any) => {
              onEvent({ agent: "QuantAgent", status: `Failed: ${e.message}` });
              return {} as Partial<AnalysisResult>;
            }),
            WebIntelAgent.run({ ticker, companyName }, onEvent)
              .then(webIntel => ({ webIntel } as Partial<AnalysisResult>))
              .catch((e: any) => {
                onEvent({ agent: "WebIntelAgent", status: `Failed: ${e.message}` });
                return { webIntel: this.buildUnavailableWebIntel(ticker, e.message) } as Partial<AnalysisResult>;
              }),
            ComplianceAlertAgent.run({ ticker, companyName }, onEvent)
              .then(compliance => ({ compliance } as Partial<AnalysisResult>))
              .catch((e: any) => {
                onEvent({ agent: "ComplianceAlertAgent", status: `Failed: ${e.message}` });
                return { compliance: this.buildUnavailableCompliance(ticker, e.message) } as Partial<AnalysisResult>;
              }),
          ]);
          const partial = this.mergePartial(this.mergePartial(quantRes, webIntelRes), complianceRes);
          onEvent({ agent: "QuantAgent", status: "Complete", partial: quantRes });
          if ((webIntelRes as any).webIntel) {
            onEvent({ agent: "WebIntelAgent", status: "Complete", partial: webIntelRes });
          }
          return partial;
        } catch (e: any) { onEvent({ agent: "QuantAgent", status: `Failed: ${e.message}` }); return {}; }
      }

      case "analyze_document": {
        if (!input.file) { onEvent({ agent: "FundamentalAgent", status: "Skipped: no document uploaded" }); return {}; }
        onEvent({ agent: "Orchestrator", status: "Calling analyze_document → FundamentalAgent" });
        try {
          const fundamentalRes = await FundamentalAgent.runAutonomousAnalysis(
            input.file, toolCall.arguments.options || input.options,
            (s) => onEvent({ agent: "FundamentalAgent", status: s.replace("FundamentalAgent: ", "") })
          );
          onEvent({ agent: "FundamentalAgent", status: "Complete", partial: fundamentalRes });
          return fundamentalRes;
        } catch (e: any) { onEvent({ agent: "FundamentalAgent", status: `Failed: ${e.message}` }); return {}; }
      }

      case "compare_peers": {
        onEvent({ agent: "Orchestrator", status: "Calling compare_peers → PeerAgent" });
        try {
          const ctx = toolCall.arguments.context || currentResult.summary || currentResult.company?.name || input.ticker || input.userRequest || "Financial Document";
          const peers = await PeerAgent.identifyPeers(ctx);
          const partial: Partial<AnalysisResult> = { competitors: peers };
          onEvent({ agent: "PeerAgent", status: `Found ${peers.length} competitors`, partial });
          return partial;
        } catch (e: any) { onEvent({ agent: "PeerAgent", status: `Failed: ${e.message}` }); return {}; }
      }

      case "synthesize_verdict": {
        onEvent({ agent: "Orchestrator", status: "Calling synthesize_verdict → CIOAgent" });
        try {
          const [verdict, investmentSignal] = await Promise.all([
            CIOAgent.crossAnalyze(currentResult, currentResult),
            CIOAgent.generateInvestmentSignal(currentResult).catch(() => undefined)
          ]);
          const partial: Partial<AnalysisResult> = { crossAnalysis: verdict, ...(investmentSignal ? { investmentSignal } : {}) };
          onEvent({ agent: "CIOAgent", status: "Verdict complete", partial });
          return partial;
        } catch (e: any) { onEvent({ agent: "CIOAgent", status: `Failed: ${e.message}` }); return {}; }
      }

      case "synthesize_knowledge": {
        const topic = (toolCall.arguments.topic || "summary") as "esg" | "highlights" | "risks" | "summary";
        const companyName = toolCall.arguments.companyName || currentResult.company?.name || input.ticker || "Unknown Company";
        const ticker = currentResult.company?.ticker || input.ticker || "";
        const context = toolCall.arguments.context || currentResult.summary || "";
        onEvent({ agent: "Orchestrator", status: `Calling synthesize_knowledge(${topic}) → CIOAgent` });
        try {
          const synthesized = await CIOAgent.synthesizeFromKnowledge(companyName, ticker, topic, context);
          const partial: Partial<AnalysisResult> = {};
          if (topic === "esg") partial.esgSummary = synthesized;
          else if (topic === "highlights") partial.highlights = synthesized.split("\n").filter(Boolean);
          else if (topic === "risks") partial.risks = synthesized.split("\n").filter(Boolean);
          else if (topic === "summary") partial.summary = (currentResult.summary ? currentResult.summary + "\n\n" : "") + synthesized;
          onEvent({ agent: "CIOAgent", status: `"${topic}" synthesis complete`, partial });
          return partial;
        } catch (e: any) { onEvent({ agent: "CIOAgent", status: `Knowledge synthesis failed: ${e.message}` }); return {}; }
      }

      default:
        return {};
    }
  }

  /**
   * Compares what the user requested against what agents actually returned.
   * Returns topic names that are missing or clearly insufficient.
   */
  private static detectGaps(
    requestedOptions: string[],
    userRequest: string,
    result: Partial<AnalysisResult>
  ): Array<"esg" | "highlights" | "risks" | "summary" | "ESG data unavailable" | "Stakeholder data unavailable"> {
    const gaps: Array<"esg" | "highlights" | "risks" | "summary" | "ESG data unavailable" | "Stakeholder data unavailable"> = [];
    const lower = userRequest.toLowerCase();
    const extendedResult = result as any;
    const isNotFound = (s: string) =>
      !s || s.length < 80 ||
      /not (found|available|covered|mentioned|included|present)/i.test(s) ||
      /no (esg|environmental|sustainability|specific|relevant)/i.test(s) ||
      /unable to (find|locate|identify|extract)/i.test(s) ||
      /insufficient|not provided|not disclosed/i.test(s);

    if (requestedOptions.includes("esg") || lower.includes("esg") || lower.includes("environment")) {
      if (isNotFound(result.esgSummary || "")) gaps.push("esg");
      if (!extendedResult.esg || extendedResult.esg.data_source === "unavailable") gaps.push("ESG data unavailable");
    }
    if (requestedOptions.includes("stakeholder") || lower.includes("stakeholder") || lower.includes("upstream") || lower.includes("downstream") || lower.includes("management")) {
      if (!extendedResult.stakeholder) gaps.push("Stakeholder data unavailable");
    }
    if (requestedOptions.includes("highlights") || lower.includes("highlight")) {
      if (!result.highlights || result.highlights.length === 0) gaps.push("highlights");
    }
    if (requestedOptions.includes("risks") || lower.includes("risk")) {
      if (!result.risks || result.risks.length === 0) gaps.push("risks");
    }
    return gaps;
  }

  /**
   * For each detected gap, calls CIOAgent.synthesizeFromKnowledge to fill it
   * using LLM training knowledge, with a clear AI-synthesis disclaimer.
   */
  private static async fillGapsWithKnowledge(
    gaps: Array<"esg" | "highlights" | "risks" | "summary" | "ESG data unavailable" | "Stakeholder data unavailable">,
    result: Partial<AnalysisResult>,
    input: { ticker?: string; options: string[]; userRequest?: string },
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const companyName = result.company?.name || input.ticker || "Unknown Company";
    const ticker = result.company?.ticker || input.ticker || "";
    const knownContext = [result.summary, JSON.stringify(result.metrics || [])].filter(Boolean).join("\n").substring(0, 3000);

    for (const gap of gaps) {
      if (gap === "ESG data unavailable" || gap === "Stakeholder data unavailable") {
        onEvent({ agent: "Orchestrator", status: gap });
        continue;
      }

      onEvent({ agent: "CIOAgent", status: `Synthesizing "${gap}" from LLM knowledge for ${companyName}...` });
      try {
        const synthesized = await CIOAgent.synthesizeFromKnowledge(companyName, ticker, gap, knownContext);
        if (gap === "esg") result.esgSummary = synthesized;
        else if (gap === "highlights") result.highlights = synthesized.split('\n').filter(l => l.trim().length > 0);
        else if (gap === "risks") result.risks = synthesized.split('\n').filter(l => l.trim().length > 0);
        else if (gap === "summary") result.summary = (result.summary ? result.summary + "\n\n" : "") + synthesized;
        onEvent({ agent: "CIOAgent", status: `"${gap}" synthesis complete` });
      } catch (err: any) {
        onEvent({ agent: "CIOAgent", status: `"${gap}" synthesis failed: ${err.message}` });
      }
    }
  }

  private static describeAgentReturn(payload: any): string {
    const keys = Object.keys(payload || {});
    if (Array.isArray(payload)) return `Returned ${payload.length} records`;
    if (payload?.summary) return `Returned ${keys.join(", ")}; summary: ${String(payload.summary).slice(0, 120)}`;
    return `Returned ${keys.join(", ") || "no structured fields"}`;
  }

  private static buildUnavailableCompliance(ticker: string, reason: string) {
    return {
      as_of: new Date().toISOString(),
      data_source: "brightdata_serp",
      confidence: "low" as const,
      refresh_interval: "每周一 09:00",
      ticker,
      alerts: [],
      overall_risk: "low" as const,
      data_gaps: [`ComplianceAlertAgent failed: ${reason || "unknown error"}`],
    };
  }

  private static buildUnavailableWebIntel(ticker: string, reason: string) {
    return {
      as_of: new Date().toISOString(),
      data_source: "brightdata_serp",
      confidence: "low" as const,
      refresh_interval: "每天整点",
      ticker,
      news_signals: [],
      hiring_trend: {
        signal: "unknown" as const,
        evidence: "Live web intelligence unavailable."
      },
      regulatory_alerts: [],
      competitive_signals: [],
      data_gaps: [`WebIntelAgent failed: ${reason || "unknown error"}`]
    };
  }

  /**
   * Mode B: PDF-first analysis.
   * 1. FundamentalAgent reads the report and extracts company name + ticker.
   * 2. Ticker extracted from document → QuantAgent + PeerAgent run in parallel.
   * 3. CIOAgent cross-analyses both outputs.
   * No manual ticker input required — the report is the single source of truth.
   */
  static async runParallelAnalysis(
    file: File,
    options: string[],
    onEvent: (event: AgentEvent) => void
  ): Promise<AnalysisResult> {
    let result: Partial<AnalysisResult> = {};
    let fundamentalResult: Partial<AnalysisResult> = {};

    // ── Phase 1: FundamentalAgent — read report, extract ticker ──────────
    onEvent({ agent: "Orchestrator", status: "Reading report — extracting company info and ticker..." });
    try {
      fundamentalResult = await FundamentalAgent.runAutonomousAnalysis(
        file, options,
        (s) => onEvent({ agent: "FundamentalAgent", status: s.replace("FundamentalAgent: ", "") })
      );
      result = this.mergePartial(result, fundamentalResult);
      onEvent({ agent: "FundamentalAgent", status: "Complete", partial: fundamentalResult });
    } catch (e: any) {
      onEvent({ agent: "FundamentalAgent", status: `Failed: ${e.message}` });
    }

    // ── Phase 2: QuantAgent + PeerAgent + ESGAgent + StakeholderAgent + WebIntelAgent in parallel using extracted ticker ─
    // Clean the raw ticker: "1810 (HKD) / 81810 (CNY)" → "1810"
    // The dashboard search API will then resolve "1810" → "1810.HK"
    const rawTicker = result.company?.ticker || "";
    const extractedTicker = rawTicker.split(/[\s\/\(（]/)[0].trim() || rawTicker.trim();

    if (extractedTicker) {
      const parallelAgentNames = ["QuantAgent", ...(options.includes("competitors") ? ["PeerAgent"] : []), "ESGAgent", "StakeholderAgent", "WebIntelAgent", "ComplianceAlertAgent"];
      onEvent({ agent: "Orchestrator", status: `Ticker "${extractedTicker}" extracted from report — dispatching ${parallelAgentNames.join(" + ")} in parallel...` });

      const parallelTasks: Promise<Partial<AnalysisResult>>[] = [
        QuantAgent.runAutonomousAnalysis(extractedTicker, options,
          (s) => onEvent({ agent: "QuantAgent", status: s.replace("QuantAgent: ", "") })
        ).catch((e: any) => {
          onEvent({ agent: "QuantAgent", status: `Failed: ${e.message}` });
          return {} as Partial<AnalysisResult>;
        }),
        ESGAgent.run({
          ticker: extractedTicker,
          industry: result.company?.name || "unknown",
          pdfText: [fundamentalResult.summary, result.esgSummary].filter(Boolean).join("\n") || null
        }, onEvent)
          .then(esg => {
            const partial = { esg } as Partial<AnalysisResult>;
            onEvent({ agent: "ESGAgent", status: "Complete", partial });
            return partial;
          })
          .catch((e: any) => {
            onEvent({ agent: "ESGAgent", status: `Failed: ${e.message}` });
            return {} as Partial<AnalysisResult>;
          }),
        StakeholderAgent.runAutonomousAnalysis({ ticker: extractedTicker }, onEvent)
          .then(stakeholder => {
            const partial = { stakeholder } as Partial<AnalysisResult>;
            onEvent({ agent: "StakeholderAgent", status: "Complete", partial });
            return partial;
          })
          .catch((e: any) => {
            onEvent({ agent: "StakeholderAgent", status: `Failed: ${e.message}` });
            return {} as Partial<AnalysisResult>;
          }),
        WebIntelAgent.run({
          ticker: extractedTicker,
          companyName: result.company?.name || extractedTicker
        }, onEvent)
          .then(webIntel => {
            const partial = { webIntel } as Partial<AnalysisResult>;
            onEvent({ agent: "WebIntelAgent", status: "Complete", partial });
            return partial;
          })
          .catch((e: any) => {
            onEvent({ agent: "WebIntelAgent", status: `Failed: ${e.message}` });
            return { webIntel: this.buildUnavailableWebIntel(extractedTicker, e.message) } as Partial<AnalysisResult>;
          }),
        ComplianceAlertAgent.run({
          ticker: extractedTicker,
          companyName: result.company?.name || extractedTicker
        }, onEvent)
          .then(compliance => {
            const partial = { compliance } as Partial<AnalysisResult>;
            onEvent({ agent: "ComplianceAlertAgent", status: "Complete", partial });
            return partial;
          })
          .catch((e: any) => {
            onEvent({ agent: "ComplianceAlertAgent", status: `Failed: ${e.message}` });
            return { compliance: this.buildUnavailableCompliance(extractedTicker, e.message) } as Partial<AnalysisResult>;
          }),
      ];

      if (options.includes("competitors")) {
        const peerCtx = result.summary || result.company?.name || extractedTicker;
        parallelTasks.push(
          PeerAgent.identifyPeers(peerCtx)
            .then(peers => {
              const partial: Partial<AnalysisResult> = { competitors: peers };
              onEvent({ agent: "PeerAgent", status: `Found ${peers.length} peers`, partial });
              return partial;
            })
            .catch((e: any) => {
              onEvent({ agent: "PeerAgent", status: `Failed: ${e.message}` });
              return {} as Partial<AnalysisResult>;
            })
        );
      }

      const parallelResults = await Promise.allSettled(parallelTasks);
      for (const settled of parallelResults) {
        if (settled.status === "fulfilled") {
          result = this.mergePartial(result, settled.value);
        }
      }

      // Emit QuantAgent partial separately so dashboard updates immediately
      const quantPartial = parallelResults[0].status === "fulfilled" ? parallelResults[0].value : null;
      if (quantPartial && Object.keys(quantPartial).length > 0) {
        onEvent({ agent: "QuantAgent", status: "Complete", partial: quantPartial });
      }
    } else {
      onEvent({ agent: "Orchestrator", status: "No ticker found in document — skipping market data analysis" });
    }

    // ── Phase 3: CIOAgent cross-analysis ─────────────────────────────────
    try {
      onEvent({ agent: "CIOAgent", status: "Running cross-analysis across report, market, ESG, stakeholder, and peer outputs..." });
      const cioContext = {
        ...result,
        esg: (result as any).esg,
        stakeholder: (result as any).stakeholder,
        webIntel: (result as any).webIntel,
        compliance: (result as any).compliance,
      };
      const [crossAnalysis, investmentSignal] = await Promise.all([
        CIOAgent.crossAnalyze(fundamentalResult, cioContext),
        CIOAgent.generateInvestmentSignal(cioContext).catch(() => undefined)
      ]);
      const partial: Partial<AnalysisResult> = { crossAnalysis, ...(investmentSignal ? { investmentSignal } : {}) };
      result = this.mergePartial(result, partial);
      onEvent({ agent: "CIOAgent", status: "Cross-analysis complete", partial });
    } catch (e: any) {
      onEvent({ agent: "CIOAgent", status: `Failed: ${e.message}` });
    }

    // ── Reflection: fill any gaps with LLM knowledge ──────────────────────
    const gaps = this.detectGaps(options, "", result);
    if (gaps.length > 0) {
      onEvent({ agent: "Orchestrator", status: `Reflection: gaps [${gaps.join(", ")}] — synthesising from LLM knowledge...` });
      await this.fillGapsWithKnowledge(gaps, result, { options }, onEvent);
    }

    if ((result as any).investmentSignal && result.company?.ticker) {
      saveAnalysisLog(result.company.ticker, (result as any).investmentSignal, result.company.name || "");
    }
    onEvent({ agent: "Orchestrator", status: "Analysis Complete" });
    return result as AnalysisResult;
  }

  /**
   * Main entry point for Ticker-only flows.
   */
  static async startQuantFlow(ticker: string, marketData: any, options: string[]): Promise<AnalysisResult> {
    console.log("[Orchestrator] Starting Quant Flow for", ticker);
    
    // 1. Quant Agent extraction
    const quantResult = await QuantAgent.processMarketData(ticker, marketData, options);
    
    // 2. Peer Agent identification (if requested)
    if (options.includes('competitors') && !quantResult.competitors) {
       console.log("[Orchestrator] Dispatching to PeerAgent...");
       const peers = await PeerAgent.identifyPeers(JSON.stringify(quantResult));
       quantResult.competitors = peers;
    }

    return quantResult as AnalysisResult;
  }

  /**
   * Main entry point for PDF-based flows.
   */
  static async startFundamentalFlow(text: string, options: string[], fileBase64?: string): Promise<AnalysisResult> {
    console.log("[Orchestrator] Starting Fundamental Flow");
    
    // 1. Fundamental Agent extraction
    const fundamentalResult = await FundamentalAgent.processReport(text, options, fileBase64);
    
    // 2. Peer Agent identification (if requested)
    if (options.includes('competitors') && !fundamentalResult.competitors) {
       console.log("[Orchestrator] Dispatching to PeerAgent...");
       // We only pass a snippet to save context window
       const peers = await PeerAgent.identifyPeers(fundamentalResult.summary || text.substring(0, 5000));
       fundamentalResult.competitors = peers;
    }

    return fundamentalResult as AnalysisResult;
  }

  /**
   * Final CIO alignment analysis
   */
  static async finalizeVerdict(fundamentalAnalysis: any, marketData: any): Promise<CrossAnalysisResult> {
    console.log("[Orchestrator] Dispatching to CIO Agent for Cross Analysis...");
    return await CIOAgent.crossAnalyze(fundamentalAnalysis, marketData);
  }

  static async synthesizeValuation(valuationData: ValuationSummary): Promise<ValuationVerdictResult> {
    console.log("[Orchestrator] Dispatching to CIO Agent for Valuation Synthesis...");
    return await CIOAgent.synthesizeValuation(valuationData);
  }

  static async resolvePeerTicker(query: string): Promise<string> {
    return await PeerAgent.resolveTickerForPeer(query);
  }
}
