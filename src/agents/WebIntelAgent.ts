import { Type } from "@google/genai";
import type { AgentEvent } from "./Orchestrator";
import { runGenerativeAI } from "./LLMProvider";
import type { NewsSignal, WebIntelOutput } from "../types";
import { validateAgentOutput } from "../utils/validateOutput";

interface WebIntelInput {
  ticker: string;
  companyName: string;
}

interface OrganicResult {
  title?: string;
  link?: string;
  url?: string;
  snippet?: string;
  description?: string;
  date?: string;
  displayed_link?: string;
}

const REFRESH_INTERVAL = "Hourly";

export class WebIntelAgent {
  static async run(
    input: WebIntelInput,
    onEvent?: (event: AgentEvent) => void
  ): Promise<WebIntelOutput> {
    onEvent?.({ agent: "WebIntelAgent", status: `Fetching live web signals for ${input.ticker}...` });

    const dataGaps: string[] = [];

    const [newsSignals, hiringTrend, regulatoryAlerts, competitiveSignals] = await Promise.all([
      this.safeSearch("news signals", dataGaps, async () => {
        const [recent, product, analyst] = await Promise.all([
          this.callSerpAPI(`${input.ticker} ${input.companyName} latest news site:reuters.com OR site:bloomberg.com OR site:wsj.com 2026`),
          this.callSerpAPI(`${input.ticker} ${input.companyName} product launch partnership earnings 2026`),
          this.callSerpAPI(`${input.ticker} analyst rating price target 2026`),
        ]);
        const tickerLower = input.ticker.toLowerCase();
        const companyLower = input.companyName.toLowerCase().split(" ")[0]; // first word is enough
        const IRRELEVANT = /predict|prophecy|psychic|astrology|horoscope|baba vanga|vanga|tarot|zodiac|fortune.tell/i;

        const seen = new Set<string>();
        const merged = [...recent, ...product, ...analyst]
          .map(r => ({ ...r, _title: (r.title || "").trim().toLowerCase() }))
          .filter(r => {
            if (!r._title || seen.has(r._title)) return false;
            seen.add(r._title);
            // Drop obvious irrelevant content
            const combined = `${r.title || ""} ${r.snippet || r.description || ""}`.toLowerCase();
            if (IRRELEVANT.test(combined)) return false;
            // Must mention ticker OR first word of company name
            if (!combined.includes(tickerLower) && !combined.includes(companyLower)) return false;
            return true;
          })
          .sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(b.date).getTime() - new Date(a.date).getTime();
          })
          .slice(0, 10);
        const news = this.toNewsSignals(merged);
        return await this.classifyNewsSentiment(news);
      }),
      this.safeSearch("hiring trend", dataGaps, async () => {
        const [expandingResults, contractingResults] = await Promise.all([
          this.callSerpAPI(`${input.companyName} hiring jobs open positions 2025 2026`),
          this.callSerpAPI(`${input.companyName} layoff restructuring job cut 2025 2026`),
        ]);
        return this.analyzeHiringTrend(expandingResults, contractingResults);
      }),
      this.safeSearch("regulatory alerts", dataGaps, async () => {
        const results = await this.callSerpAPI(`${input.ticker} SEC regulation compliance filing 2025`);
        return this.toRegulatoryAlerts(results);
      }),
      this.safeSearch("competitive signals", dataGaps, async () => {
        const results = await this.callSerpAPI(`${input.companyName} competitor pricing strategy market share 2025`);
        return this.toCompetitiveSignals(results);
      }),
    ]);

    const output: WebIntelOutput = {
      as_of: new Date().toISOString(),
      data_source: "brightdata_serp",
      confidence: dataGaps.length === 0 ? "high" : dataGaps.length < 3 ? "medium" : "low",
      refresh_interval: REFRESH_INTERVAL,
      ticker: input.ticker,
      news_signals: newsSignals || [],
      hiring_trend: hiringTrend || { signal: "unknown", evidence: "Hiring search unavailable." },
      regulatory_alerts: regulatoryAlerts || [],
      competitive_signals: competitiveSignals || [],
      data_gaps: dataGaps
    };

    validateAgentOutput("WebIntelAgent", output);
    onEvent?.({
      agent: "WebIntelAgent",
      status: "Complete",
      partial: { webIntel: output } as any
    });

    return output;
  }

  private static async safeSearch<T>(
    label: string,
    dataGaps: string[],
    fn: () => Promise<T>
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (error: any) {
      dataGaps.push(`${label} search failed: ${error.message || "unknown error"}`);
      return null;
    }
  }

  private static async callSerpAPI(query: string): Promise<OrganicResult[]> {
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    const zone = process.env.BRIGHTDATA_SERP_ZONE || "serp_api1";

    if (!apiKey) {
      throw new Error("BRIGHTDATA_API_KEY is missing");
    }

    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        zone,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`,
        format: "json"
      })
    });

    if (!response.ok) {
      throw new Error(`Bright Data SERP failed (${response.status})`);
    }

    const payload = await response.json();
    return this.extractOrganicResults(payload);
  }

  private static extractOrganicResults(payload: any): OrganicResult[] {
    if (Array.isArray(payload?.organic)) return payload.organic;
    if (Array.isArray(payload?.organic_results)) return payload.organic_results;
    if (Array.isArray(payload?.body?.organic)) return payload.body.organic;
    if (Array.isArray(payload?.body?.organic_results)) return payload.body.organic_results;
    if (typeof payload?.body === "string") {
      try {
        const parsed = JSON.parse(payload.body);
        if (Array.isArray(parsed?.organic)) return parsed.organic;
        if (Array.isArray(parsed?.organic_results)) return parsed.organic_results;
      } catch {
        return [];
      }
    }
    return [];
  }

  private static toNewsSignals(results: OrganicResult[]): NewsSignal[] {
    return results.map(result => ({
      title: result.title || "Untitled",
      url: result.link || result.url || "",
      snippet: result.snippet || result.description || "",
      date: result.date || null,
      sentiment: "neutral" as const
    })).filter(item => item.title || item.snippet);
  }

  private static async classifyNewsSentiment(news: NewsSignal[]): Promise<NewsSignal[]> {
    if (news.length === 0) return [];

    const schemaProperties = {
      sentiments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["index", "sentiment"],
          properties: {
            index: { type: Type.NUMBER },
            sentiment: { type: Type.STRING, enum: ["positive", "negative", "neutral"] }
          }
        }
      }
    };

    const prompt = `
      Classify each news item sentiment for an equity research context.
      Return sentiment only as positive, negative, or neutral.

      News:
      ${JSON.stringify(news.map((item, index) => ({
        index,
        title: item.title,
        snippet: item.snippet
      })))}
    `;

    const result = await runGenerativeAI(prompt, schemaProperties, ["sentiments"]);
    const sentimentByIndex = new Map<number, NewsSignal["sentiment"]>();
    for (const item of result.sentiments || []) {
      if (["positive", "negative", "neutral"].includes(item.sentiment)) {
        sentimentByIndex.set(item.index, item.sentiment);
      }
    }

    return news.map((item, index) => ({
      ...item,
      sentiment: sentimentByIndex.get(index) || "neutral"
    }));
  }

  private static analyzeHiringTrend(
    expandingResults: OrganicResult[],
    contractingResults: OrganicResult[]
  ): WebIntelOutput["hiring_trend"] {
    const x = expandingResults.length;
    const y = contractingResults.length;

    if (x === 0 && y === 0) {
      return { signal: "unknown", evidence: "No hiring results found." };
    }

    let signal: WebIntelOutput["hiring_trend"]["signal"];
    if (x > y * 1.5) {
      signal = "expanding";
    } else if (y > x * 1.5) {
      signal = "contracting";
    } else {
      signal = "stable";
    }

    return {
      signal,
      evidence: `Found ${x} hiring signals vs ${y} contraction signals from web search`,
    };
  }

  private static toRegulatoryAlerts(results: OrganicResult[]): WebIntelOutput["regulatory_alerts"] {
    return results
      .map(result => {
        const text = `${result.title || ""} ${result.snippet || result.description || ""}`;
        const lower = text.toLowerCase();
        const urgency: "high" | "medium" | "low" = /violation|fine|penalty|lawsuit/.test(lower)
          ? "high"
          : /investigation|review|inquiry/.test(lower)
            ? "medium"
            : "low";

        return {
          summary: text.trim() || "Regulatory result found.",
          urgency,
          date: result.date || null
        };
      })
      .filter(alert => /sec|regulation|regulatory|compliance|filing|violation|fine|penalty|lawsuit|investigation|review|inquiry/i.test(alert.summary))
      .slice(0, 6);
  }

  private static toCompetitiveSignals(results: OrganicResult[]): WebIntelOutput["competitive_signals"] {
    return results.slice(0, 8).map(result => ({
      signal: [result.title, result.snippet || result.description].filter(Boolean).join(" — "),
      source: result.link || result.url || result.displayed_link || ""
    })).filter(item => item.signal);
  }
}
