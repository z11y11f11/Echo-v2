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

    const esgText = this.extractESGText(input.pdfText || "");
    const hasPDFEvidence = esgText.length > 0;

    onEvent?.({
      agent: "ESGAgent",
      status: hasPDFEvidence
        ? "Using uploaded PDF ESG/CSR evidence"
        : "No PDF ESG/CSR evidence or open-source ESG data available"
    });

    const output: ESGOutput = hasPDFEvidence
      ? this.buildOutputFromPDF(esgText, input)
      : this.buildUnavailableOutput(input);

    validateAgentOutput("ESGAgent", output);
    onEvent?.({ agent: "ESGAgent", status: "Complete" });

    return output;
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
