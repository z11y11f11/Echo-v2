import { Type } from "@google/genai";
import { runGenerativeAI } from "./LLMProvider";
import { CrossAnalysisResult, ValuationVerdictResult, ValuationSummary, InvestmentSignal } from "../types";

export class CIOAgent {
  /**
   * Synthesizes fundamental data mapping with live market data to look for divergences
   * and create an alignment score and final investment verdict.
   */
  static async crossAnalyze(fundamentalAnalysis: any, marketData: any): Promise<CrossAnalysisResult> {
    console.log("CIOAgent: Running cross analysis");
    
    const schemaProperties = {
      alignmentScore: { type: Type.NUMBER, description: "Score from 0 to 100" },
      financialsAlignWithStockPerformance: { type: Type.BOOLEAN },
      alignmentSummary: { type: Type.STRING },
      divergenceSignals: { type: Type.ARRAY, items: { type: Type.STRING } },
      investmentVerdict: { type: Type.STRING }
    };
    
    const prompt = `
      You are the Chief Investment Officer (CIO) agent. Compare the fundamental report analysis with the real-time market data.
      Identify divergences and calculate an alignment score (0-100). Provide max 3 divergence signals, and a 1-sentence overall investment verdict.
  
      Report Fundamentals: ${JSON.stringify(fundamentalAnalysis)}
      Market Data/Technical Trend: ${JSON.stringify(marketData)}
    `;
  
    return await runGenerativeAI(prompt, schemaProperties, Object.keys(schemaProperties));
  }

  /**
   * Generates analysis on a specific topic using LLM training knowledge when the source
   * document or market data did not contain the requested information.
   * Always appends a disclaimer marking the content as AI-synthesized.
   */
  static async synthesizeFromKnowledge(
    companyName: string,
    ticker: string,
    topic: "esg" | "highlights" | "risks" | "summary",
    knownContext: string
  ): Promise<string> {
    const schemaProperties = {
      content: { type: Type.STRING }
    };

    const topicDescriptions: Record<string, string> = {
      esg: "ESG (Environmental, Social, Governance) profile — environmental initiatives, carbon footprint, social responsibility practices, governance structure, sustainability commitments, and key ESG risks",
      highlights: "Top 3-5 investment highlights as a bullet-point list — key competitive advantages, growth drivers, market position, and strategic strengths",
      risks: "Top 3-5 key investment risks as a bullet-point list — competitive threats, regulatory exposure, market risks, and execution risks",
      summary: "A concise investment summary — business model, market position, recent performance trends, and outlook"
    };

    const prompt = `
      You are the CIO agent. The source document did not contain sufficient ${topic.toUpperCase()} information for ${companyName} (${ticker}).

      Using your training knowledge about this publicly listed company, generate a well-informed ${topicDescriptions[topic] || topic}.

      Known context already extracted:
      ${knownContext.substring(0, 3000)}

      Requirements:
      - Be specific and factual. Do NOT invent precise financial figures.
      - Reference real publicly known facts about ${companyName} (e.g. products, markets, initiatives, controversies).
      - Conclude with this exact sentence on a new line: "[Based on publicly available disclosures and filings. Supplemented where the uploaded document did not contain this section.]"
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["content"]);
    return result.content;
  }

  /**
   * Provides a final valuation verdict based purely on numerical multiples and metrics.
   */
  /**
   * Generates a structured BUY / HOLD / SELL signal from aggregated context.
   * BUY:  valuation below historical norm + positive news + analyst upgrade signals
   * SELL: price >15% above target + negative signals + high regulatory risk
   * HOLD: all other cases
   * Confidence reflects signal consistency across all available data.
   */
  static async generateInvestmentSignal(context: any): Promise<InvestmentSignal> {
    const schemaProperties = {
      verdict: { type: Type.STRING, enum: ["BUY", "HOLD", "SELL"] },
      confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
      key_reasons: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Exactly 3 primary reasons supporting the verdict"
      },
      risk_warnings: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Exactly 2 key risk warnings investors should note"
      }
    };

    const prompt = `
      You are the CIO agent. Based on all available analysis context, generate a structured investment signal.

      Decision rules:
      - BUY: valuation multiples below historical averages AND positive news sentiment AND analyst upgrade/price-target raise signals present
      - SELL: current price >15% above analyst mean target AND negative fundamental/news signals AND high regulatory or legal risk present
      - HOLD: all other cases — mixed signals, insufficient data, or no clear edge

      Confidence rules:
      - high: 3+ data sources agree on the same direction
      - medium: 2 sources agree, or 1 strong signal
      - low: conflicting signals or thin data

      Return exactly 3 key_reasons and exactly 2 risk_warnings as concise bullet strings (no leading dashes).

      Analysis context:
      ${JSON.stringify(context).substring(0, 6000)}
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, Object.keys(schemaProperties));
    return {
      verdict: result.verdict as InvestmentSignal["verdict"],
      confidence: result.confidence as InvestmentSignal["confidence"],
      key_reasons: (result.key_reasons || []).slice(0, 3),
      risk_warnings: (result.risk_warnings || []).slice(0, 2),
      generated_at: new Date().toISOString()
    };
  }

  static async synthesizeValuation(valuationData: ValuationSummary): Promise<ValuationVerdictResult> {
    console.log("CIOAgent: Synthesizing valuation metrics");
    
    const schemaProperties = {
      overallVerdict: { type: Type.STRING, enum: ["Undervalued", "Fair Value", "Overvalued"] },
      confidenceLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
      keyReason: { type: Type.STRING, description: "1 sentence reason" }
    };
    
    const prompt = `
      You are the CIO agent evaluating company valuation. Evaluate the following valuation metrics and determine
      if the stock is Undervalued, Fair Value, or Overvalued. Give a confidence level and a 1-sentence reason.
      Cross-reference PE, PB, PEG, EV/EBITDA, dividend yield, and analyst target price recommendation.
  
      Valuation Data: ${JSON.stringify(valuationData)}
    `;
  
    return await runGenerativeAI(prompt, schemaProperties, Object.keys(schemaProperties));
  }
}
