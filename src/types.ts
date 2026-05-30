/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Metric {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'flat';
  /** Which agent produced this metric — used for grouping in the dashboard */
  source?: 'fundamental' | 'market';
}

export interface AnalysisResult {
  company: {
    name: string;
    ticker: string;
  };
  reportDate?: string;
  isHistorical?: boolean;
  metrics: Metric[];
  risks?: string[];
  highlights?: string[];
  esgSummary?: string;
  esg?: ESGOutput;
  stakeholder?: StakeholderOutput;
  webIntel?: WebIntelOutput;
  compliance?: ComplianceOutput;
  investmentSignal?: InvestmentSignal;
  competitors?: {
    name: string;
    ticker: string;
    rationale: string;
  }[];
  crossAnalysis?: CrossAnalysisResult;
  summary: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
}

export interface CrossAnalysisResult {
  alignmentScore?: number;
  financialsAlignWithStockPerformance: boolean;
  alignmentSummary: string;
  divergenceSignals: string[];
  investmentVerdict: string;
}

export interface ValuationVerdictResult {
  overallVerdict: 'Undervalued' | 'Fair Value' | 'Overvalued';
  confidenceLevel: 'High' | 'Medium' | 'Low';
  keyReason: string;
}

export interface StockData {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  longName?: string;
}

export interface HistoricalBar {
  date: string;
  close: number;
  adjClose?: number;
  ma20?: number;
  ma50?: number;
  ma200?: number;
}

export interface ValuationSummary {
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  pegRatio?: number;
  dividendYield?: number;
  payoutRatio?: number;
  ebitdaMargins?: number;
  enterpriseToEbitda?: number;
  returnOnEquity?: number;
  revenueGrowth?: number;
  recommendationKey?: string;
  targetMeanPrice?: number;
  targetHighPrice?: number;
  targetLowPrice?: number;
  numberOfAnalystOpinions?: number;
  recommendationTrend?: any[];
}

export interface ESGDimension {
  score: number | null
  key_risks: string[]
  improvement_signals: string[]
}

export interface ESGOutput {
  as_of: string
  data_source: string
  confidence: 'high' | 'medium' | 'low'
  refresh_interval: string
  environmental: ESGDimension
  social: ESGDimension
  governance: ESGDimension
  overall_score: number | null
  data_gaps: string[]
}

export interface IndustryRevenue {
  industry: string
  revenue_share_pct: number
  period: string
}

export interface StakeholderEntity {
  name: string
  ticker?: string                          // Yahoo Finance symbol, resolved from LLM or search API
  exchange?: string                        // e.g. NYSE, NASDAQ, HKEX, KRX
  type: 'upstream' | 'downstream' | 'peer'
  industry: string
  description: string
  sort_value: string | 'no_public_data'
  sort_metric: 'transaction_volume' | 'market_cap'
  analysis?: string
}

export interface ManagementInfo {
  ceo: { name: string | null; tenure_years: number | null; recent_changes: string[] }
  cfo: { name: string | null; tenure_years: number | null; recent_changes: string[] }
  compensation_alignment: 'aligned' | 'misaligned' | 'neutral' | null
}

export interface StakeholderOutput {
  as_of: string
  data_source: string
  confidence: 'high' | 'medium' | 'low'
  refresh_interval: string
  top_industries: IndustryRevenue[]
  selected_industries: string[]
  selection_mode: 'specific' | 'comprehensive'
  candidates: StakeholderEntity[]
  selected_entities: StakeholderEntity[]
  management: ManagementInfo
  company_intro: string
}

export interface NewsSignal {
  title: string
  url: string
  snippet: string
  date: string | null
  sentiment: 'positive' | 'negative' | 'neutral'
}

export interface WebIntelOutput {
  as_of: string
  data_source: string
  confidence: 'high' | 'medium' | 'low'
  refresh_interval: string
  ticker: string
  news_signals: NewsSignal[]
  hiring_trend: {
    signal: 'expanding' | 'contracting' | 'stable' | 'unknown'
    evidence: string
  }
  regulatory_alerts: Array<{
    summary: string
    urgency: 'high' | 'medium' | 'low'
    date: string | null
  }>
  competitive_signals: Array<{
    signal: string
    source: string
  }>
  data_gaps: string[]
}

export interface InvestmentSignal {
  verdict: 'BUY' | 'HOLD' | 'SELL'
  confidence: 'high' | 'medium' | 'low'
  key_reasons: string[]
  risk_warnings: string[]
  generated_at: string
}

export interface ComplianceAlert {
  summary: string
  source: string
  urgency: 'high' | 'medium' | 'low'
  date: string | null
  category: 'regulatory' | 'legal' | 'esg_compliance' | 'filing'
}

export interface ComplianceOutput {
  as_of: string
  data_source: string
  confidence: 'high' | 'medium' | 'low'
  refresh_interval: string
  ticker: string
  alerts: ComplianceAlert[]
  overall_risk: 'high' | 'medium' | 'low'
  data_gaps: string[]
}
