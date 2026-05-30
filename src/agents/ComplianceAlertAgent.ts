import type { AgentEvent } from "./Orchestrator";
import type { ComplianceAlert, ComplianceOutput } from "../types";
import { validateAgentOutput } from "../utils/validateOutput";

interface ComplianceInput {
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
}

const HIGH_URGENCY = /fine|penalty|violation|lawsuit|banned|criminal/i;
const MEDIUM_URGENCY = /investigation|inquiry|review|warning|probe/i;

export class ComplianceAlertAgent {
  static async run(
    input: ComplianceInput,
    onEvent?: (event: AgentEvent) => void
  ): Promise<ComplianceOutput> {
    onEvent?.({ agent: "ComplianceAlertAgent", status: `Fetching compliance signals for ${input.ticker}...` });

    const dataGaps: string[] = [];

    const [regulatory, legal, esgCompliance] = await Promise.all([
      this.safeSearch("regulatory search", dataGaps, async () => {
        const results = await this.callSerpAPI(`${input.ticker} SEC regulatory change compliance 2025 2026`);
        return this.toAlerts(results, "regulatory");
      }),
      this.safeSearch("legal search", dataGaps, async () => {
        const results = await this.callSerpAPI(`${input.companyName} lawsuit litigation fine penalty 2025 2026`);
        return this.toAlerts(results, "legal");
      }),
      this.safeSearch("esg compliance search", dataGaps, async () => {
        const results = await this.callSerpAPI(`${input.companyName} ESG compliance disclosure requirement 2025 2026`);
        return this.toAlerts(results, "esg_compliance");
      }),
    ]);

    const alerts: ComplianceAlert[] = [
      ...(regulatory || []),
      ...(legal || []),
      ...(esgCompliance || []),
    ];

    const overall_risk: ComplianceOutput["overall_risk"] = alerts.some(a => a.urgency === "high")
      ? "high"
      : alerts.some(a => a.urgency === "medium")
        ? "medium"
        : "low";

    const output: ComplianceOutput = {
      as_of: new Date().toISOString(),
      data_source: "brightdata_serp",
      confidence: dataGaps.length === 0 ? "high" : dataGaps.length < 2 ? "medium" : "low",
      refresh_interval: "Every Monday 09:00",
      ticker: input.ticker,
      alerts,
      overall_risk,
      data_gaps: dataGaps,
    };

    validateAgentOutput("ComplianceAlertAgent", output);
    onEvent?.({
      agent: "ComplianceAlertAgent",
      status: "Complete",
      partial: { compliance: output } as any,
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
      dataGaps.push(`${label} failed: ${error.message || "unknown error"}`);
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        zone,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`,
        format: "json",
      }),
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

  private static toAlerts(
    results: OrganicResult[],
    category: ComplianceAlert["category"]
  ): ComplianceAlert[] {
    return results
      .map(result => {
        const text = `${result.title || ""} ${result.snippet || result.description || ""}`.trim();
        if (!text) return null;

        const urgency: ComplianceAlert["urgency"] = HIGH_URGENCY.test(text)
          ? "high"
          : MEDIUM_URGENCY.test(text)
            ? "medium"
            : "low";

        return {
          summary: text,
          source: result.link || result.url || "",
          urgency,
          date: result.date || null,
          category,
        } satisfies ComplianceAlert;
      })
      .filter((a): a is ComplianceAlert => a !== null)
      .slice(0, 5);
  }
}
