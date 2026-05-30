import { Type } from "@google/genai";
import { runGenerativeAI } from "./LLMProvider";
import { deduplicateBySymbol } from "../utils/entityNormalizer";

export interface Competitor {
  name: string;
  ticker: string;
  rationale: string;
}

export class PeerAgent {
  /**
   * Identifies direct publicly traded competitors for a given company.
   */
  static async identifyPeers(contextPayload: string): Promise<Competitor[]> {
    console.log("PeerAgent: Identifying peers");
    
    const schemaProperties = {
      competitors: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["name", "ticker", "rationale"],
          properties: {
            name: { type: Type.STRING },
            ticker: { type: Type.STRING, description: "Ticker symbol compatible with Yahoo Finance" },
            rationale: { type: Type.STRING, description: "Why they are a competitor" }
          }
        }
      }
    };
    
    const prompt = `
      You are an industry analysis expert specializing in competitive landscapes.

      Step 1 — Identify the company:
      From the context below, determine:
      - Company name (e.g. Xiaomi, Apple, Samsung)
      - Primary industry/sector (e.g. Consumer Electronics, Semiconductors, E-commerce)
      - Primary geographic market (e.g. China, US, Global)

      Step 2 — Select 3-5 DIRECT competitors:
      Competitors must operate in the SAME industry/sector and compete for the SAME customers.
      Prioritize companies with similar products, revenue scale, and geographic reach.

      Sector-specific guidance:
      - Chinese Consumer Electronics (Xiaomi, OPPO, Vivo): peers = Samsung (005930.KS), Apple (AAPL), Xiaomi (1810.HK), Huawei (private — skip), Lenovo (0992.HK), BBK/OPPO/Vivo (private — skip if no public ticker), BYD (002594.SZ for EV overlap)
      - US Big Tech: peers = other FAANG/Mag7 companies in the same product category
      - Chinese EV: peers = BYD, NIO, Li Auto, XPeng, Tesla
      - Do NOT select companies purely based on market cap or country if they are in different sectors.
      - Do NOT select telecom carriers as peers for device/hardware manufacturers.

      Provide Yahoo Finance-compatible ticker symbols. Skip private companies with no public ticker.

      Company Context:
      ${contextPayload.substring(0, 10000)}
    `;
    
    const result = await runGenerativeAI(prompt, schemaProperties, ["competitors"]);
    const raw: Competitor[] = result.competitors || [];
    // Normalise and deduplicate by resolved Yahoo Finance symbol
    return await deduplicateBySymbol(raw);
  }

  /**
   * AI utility to resolve an arbitrary company name to a standard Yahoo Finance ticker.
   */
  static async resolveTickerForPeer(query: string): Promise<string> {
    const schemaProperties = {
      ticker: { type: Type.STRING, description: "Yahoo Finance compatible ticker symbol" }
    };
    const prompt = `Resolve this company name or query into its most likely primary Yahoo Finance ticker symbol. Return ONLY the JSON object. Query: "${query}"`;
    
    const result = await runGenerativeAI(prompt, schemaProperties, ["ticker"]);
    return result.ticker;
  }
}
