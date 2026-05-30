import type { AgentEvent } from "./Orchestrator";
import type { ESGDimension, ESGOutput } from "../types";
import { validateAgentOutput } from "../utils/validateOutput";

interface ESGAgentInput {
  ticker: string;
  industry: string;
  pdfText?: string | null;
}

type ESGTheme = "environmental" | "social" | "governance";

const REFRESH_INTERVAL = "First business day of each quarter";

const ESG_KEYWORDS = [
  "esg",
  "csr",
  "sustainability",
  "sustainable",
  "environment",
  "environmental",
  "carbon",
  "emission",
  "climate",
  "governance",
  "board",
  "diversity",
  "employee",
  "labor",
  "supply chain",
  "responsibility",
  "安全",
  "环境",
  "社会责任",
  "可持续",
  "治理",
  "董事会",
  "员工",
  "供应链",
  "碳排放"
];

const THEME_KEYWORDS: Record<ESGTheme, string[]> = {
  environmental: ["environment", "environmental", "carbon", "emission", "climate", "energy", "waste", "water", "环境", "碳", "排放", "能源", "气候"],
  social: ["social", "employee", "labor", "safety", "diversity", "community", "customer", "supply chain", "员工", "安全", "多元", "社区", "客户", "供应链"],
  governance: ["governance", "board", "director", "audit", "risk management", "compliance", "shareholder", "治理", "董事会", "审计", "合规", "股东"]
};

export class ESGAgent {
  static async run(
    input: ESGAgentInput,
    onEvent?: (event: AgentEvent) => void
  ): Promise<ESGOutput> {
    onEvent?.({ agent: "ESGAgent", status: `Starting ESG analysis for ${input.ticker}` });

    // ── Priority 1: Bright Data SERP ────────────────────────────────────────
    try {
      onEvent?.({ agent: "ESGAgent", status: "Fetching live ESG signals via Bright Data…" });
      const res = await fetch(`/api/esg/${encodeURIComponent(input.ticker)}`);
      if (res.ok) {
        const data = await res.json();
        const output = this.buildOutputFromSERP(data, input);
        const hasSignals = [output.environmental, output.social, output.governance]
          .some(d => d.key_risks.length > 0 || d.improvement_signals.length > 0);

        if (hasSignals) {
          validateAgentOutput("ESGAgent", output);
          onEvent?.({ agent: "ESGAgent", status: "Complete (Bright Data SERP)" });
          return output;
        }
        onEvent?.({ agent: "ESGAgent", status: "SERP returned no ESG signals — falling back to PDF" });
      }
    } catch (e: any) {
      onEvent?.({ agent: "ESGAgent", status: `Bright Data unavailable: ${e.message} — falling back to PDF` });
    }

    // ── Priority 2: PDF text ─────────────────────────────────────────────────
    const esgText = this.extractESGText(input.pdfText || "");
    if (esgText.length > 0) {
      onEvent?.({ agent: "ESGAgent", status: "Using uploaded PDF ESG/CSR evidence" });
      const output = this.buildOutputFromPDF(esgText, input);
      validateAgentOutput("ESGAgent", output);
      onEvent?.({ agent: "ESGAgent", status: "Complete (PDF extract)" });
      return output;
    }

    // ── Priority 3: Unavailable ──────────────────────────────────────────────
    onEvent?.({ agent: "ESGAgent", status: "No ESG data available" });
    const output = this.buildUnavailableOutput(input);
    validateAgentOutput("ESGAgent", output);
    onEvent?.({ agent: "ESGAgent", status: "Complete (no data)" });
    return output;
  }

  /**
   * Builds ESGOutput from Bright Data SERP results.
   * Extracts key_risks and improvement_signals from snippet text per dimension.
   */
  private static buildOutputFromSERP(
    data: { environmental: any[]; social: any[]; governance: any[]; as_of: string },
    input: ESGAgentInput
  ): ESGOutput {
    const buildDimension = (
      snippets: Array<{ title: string; snippet: string; url: string; date: string | null }>,
      theme: ESGTheme
    ): ESGDimension => {
      const allText = snippets.map(s => `${s.title} ${s.snippet}`).join(" ").toLowerCase();
      const themeKws = THEME_KEYWORDS[theme].map(k => k.toLowerCase());
      const hasRelevant = themeKws.some(kw => allText.includes(kw));

      if (!hasRelevant || snippets.length === 0) return this.emptyDimension();

      const riskWords = ["risk", "penalty", "violation", "fine", "lawsuit", "incident", "recall", "accident", "controversy", "scandal"];
      const improveWords = ["improve", "reduce", "target", "initiative", "certif", "commit", "progress", "award", "achieve", "launch", "invest"];

      const key_risks = snippets
        .filter(s => {
          const t = `${s.title} ${s.snippet}`.toLowerCase();
          return themeKws.some(k => t.includes(k)) && riskWords.some(w => t.includes(w));
        })
        .map(s => s.snippet.slice(0, 160).trim())
        .filter(Boolean)
        .slice(0, 3);

      const improvement_signals = snippets
        .filter(s => {
          const t = `${s.title} ${s.snippet}`.toLowerCase();
          return themeKws.some(k => t.includes(k)) && improveWords.some(w => t.includes(w));
        })
        .map(s => s.snippet.slice(0, 160).trim())
        .filter(Boolean)
        .slice(0, 3);

      // Score: 1-10 based on coverage (number of relevant signals found)
      const totalSignals = key_risks.length + improvement_signals.length;
      const score = totalSignals === 0 ? null : Math.min(10, Math.max(2, 5 + improvement_signals.length - key_risks.length));

      return { score, key_risks, improvement_signals };
    };

    const environmental = buildDimension(data.environmental || [], "environmental");
    const social        = buildDimension(data.social        || [], "social");
    const governance    = buildDimension(data.governance    || [], "governance");

    const scores = [environmental.score, social.score, governance.score].filter((s): s is number => s !== null);
    const overall_score = scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
      : null;

    return {
      as_of:            data.as_of || new Date().toISOString(),
      data_source:      "brightdata_serp",
      confidence:       scores.length >= 2 ? "medium" : "low",
      refresh_interval: REFRESH_INTERVAL,
      environmental,
      social,
      governance,
      overall_score,
      data_gaps: this.getDataGaps(input, { environmental, social, governance })
    };
  }

  private static buildOutputFromPDF(esgText: string, input: ESGAgentInput): ESGOutput {
    const environmental = this.scoreDimension(esgText, "environmental");
    const social = this.scoreDimension(esgText, "social");
    const governance = this.scoreDimension(esgText, "governance");
    const scored = [environmental.score, social.score, governance.score].filter((score): score is number => score !== null);

    return {
      as_of: new Date().toISOString(),
      data_source: "pdf_extract",
      confidence: scored.length >= 2 ? "medium" : "low",
      refresh_interval: REFRESH_INTERVAL,
      environmental,
      social,
      governance,
      overall_score: scored.length > 0
        ? Number((scored.reduce((sum, score) => sum + score, 0) / scored.length).toFixed(1))
        : null,
      data_gaps: this.getDataGaps(input, { environmental, social, governance })
    };
  }

  private static buildUnavailableOutput(input: ESGAgentInput): ESGOutput {
    const emptyDimension = this.emptyDimension();

    return {
      as_of: new Date().toISOString(),
      data_source: "unavailable",
      confidence: "low",
      refresh_interval: REFRESH_INTERVAL,
      environmental: emptyDimension,
      social: emptyDimension,
      governance: emptyDimension,
      overall_score: null,
      data_gaps: [
        `No CSR/ESG evidence found for ${input.ticker}`,
        `No open-source ESG data connected for ${input.industry}`
      ]
    };
  }

  private static extractESGText(text: string): string {
    if (!text.trim()) return "";

    return text
      .split(/\n{2,}|(?<=\.)\s+/)
      .filter(section => {
        const normalized = section.toLowerCase();
        return ESG_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
      })
      .join("\n")
      .slice(0, 12000);
  }

  private static scoreDimension(esgText: string, theme: ESGTheme): ESGDimension {
    const normalized = esgText.toLowerCase();
    const matches = THEME_KEYWORDS[theme].filter(keyword => normalized.includes(keyword.toLowerCase()));

    if (matches.length === 0) {
      return this.emptyDimension();
    }

    const score = Math.min(10, Math.max(1, Number((4 + matches.length * 0.8).toFixed(1))));

    return {
      score,
      key_risks: this.extractSignals(esgText, theme, ["risk", "challenge", "incident", "penalty", "litigation", "风险", "挑战", "处罚", "诉讼"]),
      improvement_signals: this.extractSignals(esgText, theme, ["improve", "reduce", "target", "initiative", "progress", "certification", "提升", "降低", "目标", "改善", "认证"])
    };
  }

  private static extractSignals(text: string, theme: ESGTheme, signalWords: string[]): string[] {
    const keywords = THEME_KEYWORDS[theme].map(keyword => keyword.toLowerCase());
    const signals = text
      .split(/\n|(?<=\.)\s+/)
      .map(sentence => sentence.trim())
      .filter(sentence => {
        const normalized = sentence.toLowerCase();
        return keywords.some(keyword => normalized.includes(keyword)) &&
          signalWords.some(word => normalized.includes(word.toLowerCase()));
      })
      .slice(0, 3);

    return signals.length > 0 ? signals : [];
  }

  private static getDataGaps(
    input: ESGAgentInput,
    dimensions: Record<ESGTheme, ESGDimension>
  ): string[] {
    return (Object.keys(dimensions) as ESGTheme[])
      .filter(theme => dimensions[theme].score === null)
      .map(theme => `No ${theme} score evidence found for ${input.ticker} in ${input.industry}`);
  }

  private static emptyDimension(): ESGDimension {
    return {
      score: null,
      key_risks: [],
      improvement_signals: []
    };
  }
}
