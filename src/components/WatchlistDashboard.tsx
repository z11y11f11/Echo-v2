/**
 * WatchlistDashboard — two-view monitoring page.
 *
 * View 1 (Portfolio Overview):  summary cards + holdings table
 * View 2 (Individual Stock):    signal card + price card + news + compliance + history
 *
 * Data sources:
 *   Signal / history : GET /api/log/history/:ticker
 *   Market price     : GET /api/stock/:ticker
 *   News / compliance: POST /api/refresh/:ticker  (live)
 *                      or localStorage echo_webintel_{ticker} / echo_compliance_{ticker} (cached)
 *
 * Key design: webIntel + compliance are held in React state (`liveData`) — never
 * read directly from localStorage inside render — so refreshes trigger re-renders.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, X, RefreshCw, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock,
  ExternalLink, Loader2, ShieldAlert, Globe,
  History, Zap, RefreshCcw, Bot, BarChart3, Settings, AlertCircle, Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CIOAgent } from '../agents/CIOAgent';
import { saveAnalysisLog } from '../utils/db';
import { runMasterAnalysis } from '../services/ai';
import type { AgentEvent } from '../services/ai';
import type { AnalysisResult } from '../types';
import AnalysisDashboard from './AnalysisDashboard';
import StakeholderModal from './StakeholderModal';
import SettingsPanel, {
  type EchoSettings, loadSettings, saveSettings, getNextAutoRefreshLabel
} from './SettingsPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergePartial(acc: Partial<AnalysisResult>, incoming: Partial<AnalysisResult>): Partial<AnalysisResult> {
  const merged = { ...acc, ...incoming };
  if (acc.metrics && incoming.metrics) {
    const seen = new Set(acc.metrics.map(m => m.label));
    merged.metrics = [...acc.metrics, ...incoming.metrics.filter(m => !seen.has(m.label))];
  }
  if (acc.highlights && incoming.highlights) {
    const seen = new Set(acc.highlights);
    merged.highlights = [...acc.highlights, ...incoming.highlights.filter(h => !seen.has(h))];
  }
  if (acc.risks && incoming.risks) {
    const seen = new Set(acc.risks);
    merged.risks = [...acc.risks, ...incoming.risks.filter(r => !seen.has(r))];
  }
  return merged;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchlistItem { ticker: string; addedAt: string; }

interface StockQuote {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  longName?: string;
  shortName?: string;
  marketCap?: number;
  trailingPE?: number;
  description?: string;   // first 1-2 sentences from assetProfile.longBusinessSummary
  sector?: string;
  industry?: string;
}

interface SignalRecord {
  verdict: 'BUY' | 'HOLD' | 'SELL';
  confidence: 'high' | 'medium' | 'low';
  key_reasons: string[];
  risk_warnings: string[];
  generated_at: string;
  created_at: string;
}

interface NewsSignal {
  title: string; url: string; snippet: string; date: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
}
interface ComplianceAlert {
  summary: string; source: string; urgency: 'high' | 'medium' | 'low';
  date: string | null; category: string;
}
interface WebIntelData { news_signals?: NewsSignal[]; data_gaps?: string[]; }
interface ComplianceData { alerts?: ComplianceAlert[]; overall_risk?: string; data_gaps?: string[]; }

interface LiveEntry {
  webIntel: WebIntelData;
  compliance: ComplianceData;
  refreshedAt: string;
}

type RefreshStatus = 'idle' | 'refreshing' | 'error';
type EmailStatus = 'idle' | 'sending' | 'sent' | 'error';
type ReportPeriodMode = 'last30' | 'month';

interface AlertEmailItem {
  alertKey: string;
  ticker: string;
  type: 'High Compliance' | 'Negative News' | 'SELL Signal' | 'Price Move';
  title: string;
  detail: string;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

const LS_WATCHLIST   = 'echo_watchlist_v2';
const LS_OPEN_TABS   = 'echo_open_tabs_v1';
const LS_ACTIVE_VIEW = 'echo_active_view_v1';

function loadOpenTabs(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_OPEN_TABS) || '[]'); } catch { return []; }
}
function loadActiveView(): string {
  return localStorage.getItem(LS_ACTIVE_VIEW) || 'portfolio';
}

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'
].map(ticker => ({ ticker, addedAt: new Date().toISOString() }));

function loadWatchlist(): WatchlistItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_WATCHLIST) || '[]');
    return Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_WATCHLIST;
  } catch { return DEFAULT_WATCHLIST; }
}
function saveWatchlist(items: WatchlistItem[]) {
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(items));
}

/** Load cached webIntel+compliance from localStorage into liveData state on mount. */
function loadCachedLiveData(tickers: string[]): Record<string, LiveEntry> {
  const result: Record<string, LiveEntry> = {};
  for (const t of tickers) {
    try {
      const wi = JSON.parse(localStorage.getItem(`echo_webintel_${t}`) || 'null');
      const co = JSON.parse(localStorage.getItem(`echo_compliance_${t}`) || 'null');
      if (wi || co) {
        result[t] = {
          webIntel:    wi  ?? {},
          compliance:  co  ?? {},
          refreshedAt: wi?.as_of ?? co?.as_of ?? '',
        };
      }
    } catch {}
  }
  return result;
}

function persistLiveData(ticker: string, entry: LiveEntry) {
  try {
    localStorage.setItem(`echo_webintel_${ticker}`,   JSON.stringify(entry.webIntel));
    localStorage.setItem(`echo_compliance_${ticker}`, JSON.stringify(entry.compliance));
  } catch {}
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function verdictStyle(v?: string) {
  if (v === 'BUY')  return { badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', text: 'text-emerald-300' };
  if (v === 'SELL') return { badge: 'bg-rose-950/60 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400',    text: 'text-rose-300' };
  return              { badge: 'bg-amber-950/60 text-amber-300 border-amber-500/40',              dot: 'bg-amber-400',   text: 'text-amber-300' };
}
function confidenceStyle(c?: string) {
  return c === 'high' ? 'text-emerald-400' : c === 'medium' ? 'text-amber-400' : 'text-slate-400';
}
function urgencyStyle(u?: string) {
  if (u === 'high')   return 'bg-rose-950/40 text-rose-400 border-rose-500/30';
  if (u === 'medium') return 'bg-amber-950/40 text-amber-400 border-amber-500/30';
  return 'bg-slate-800/50 text-slate-400 border-slate-700';
}
function sentimentStyle(s?: string) {
  if (s === 'positive') return 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30';
  if (s === 'negative') return 'bg-rose-950/40 text-rose-400 border-rose-500/30';
  return 'bg-slate-800/50 text-slate-400 border-slate-700';
}
function urgencyRank(u?: string) {
  if (u === 'high') return 0;
  if (u === 'medium') return 1;
  return 2;
}
function eventTime(date?: string | null, fallback?: string): number {
  const parsed = date ? Date.parse(date) : NaN;
  if (!Number.isNaN(parsed)) return parsed;
  const fallbackParsed = fallback ? Date.parse(fallback) : NaN;
  return Number.isNaN(fallbackParsed) ? 0 : fallbackParsed;
}
function alertHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}
function defaultReportMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function getReportRange(mode: ReportPeriodMode, month: string) {
  const now = new Date();
  if (mode === 'month') {
    const [yearRaw, monthRaw] = month.split('-').map(Number);
    const year = Number.isFinite(yearRaw) ? yearRaw : now.getFullYear();
    const monthIndex = Number.isFinite(monthRaw) ? monthRaw - 1 : now.getMonth();
    const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
    return {
      start,
      end,
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end: now, label: 'Last 30 days' };
}
function isWithinReportRange(date?: string | null, fallback?: string, range?: { start: Date; end: Date }) {
  if (!range) return true;
  const time = eventTime(date, fallback);
  return time >= range.start.getTime() && time <= range.end.getTime();
}
function relTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
function fmtPrice(price?: number, currency?: string) {
  if (!price) return '—';
  const sym = currency === 'USD' ? '$' : (currency || '');
  const val = (currency === 'KRW' || currency === 'JPY')
    ? Math.round(price).toLocaleString()
    : price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${sym}${val}`;
}
function fmtChange(pct?: number) {
  if (pct == null) return { text: '—', cls: 'text-slate-500' };
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, cls: pct >= 0 ? 'text-emerald-400' : 'text-rose-400' };
}
function fmtMktCap(v?: number, currency?: string) {
  if (!v) return '—';
  const cur = currency ? ` ${currency}` : '';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T${cur}`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B${cur}`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M${cur}`;
  return `${v.toLocaleString()}${cur}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

const Sk = ({ h = 'h-4', w = 'w-full' }: { h?: string; w?: string }) => (
  <div className={`${h} ${w} bg-slate-800 rounded animate-pulse`} />
);

// ── Main component ────────────────────────────────────────────────────────────

// onNavigateToAnalysis kept as no-op prop for App.tsx compatibility
export default function WatchlistDashboard({ onNavigateToAnalysis: _unused }: { onNavigateToAnalysis: () => void }) {
  const [watchlist, setWatchlist]     = useState<WatchlistItem[]>(loadWatchlist);
  const [openTabs, setOpenTabs]       = useState<string[]>(loadOpenTabs);
  const [activeView, setActiveView]   = useState<'portfolio' | string>(loadActiveView);

  const [quotes,         setQuotes]         = useState<Record<string, StockQuote>>({});
  const [signals,        setSignals]        = useState<Record<string, SignalRecord[]>>({});
  const [liveData,       setLiveData]       = useState<Record<string, LiveEntry>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const [refreshStatus,  setRefreshStatus]  = useState<Record<string, RefreshStatus>>({});

  const [addInput, setAddInput] = useState('');
  const [addOpen,  setAddOpen]  = useState(false);
  const [addError, setAddError] = useState('');
  const [refreshAllActive, setRefreshAllActive] = useState(false);
  const [refreshAllCurrent, setRefreshAllCurrent] = useState<string>('');
  const [alertEmailStatus, setAlertEmailStatus] = useState<EmailStatus>('idle');
  const [monthlyReportStatus, setMonthlyReportStatus] = useState<EmailStatus>('idle');
  const [alertEmailMessage, setAlertEmailMessage] = useState('');
  const [monthlyReportMessage, setMonthlyReportMessage] = useState('');
  const [reportPeriodMode, setReportPeriodMode] = useState<ReportPeriodMode>('last30');
  const [reportMonth, setReportMonth] = useState(defaultReportMonth);

  // Inline full analysis per ticker
  const [analysisData,    setAnalysisData]    = useState<Record<string, Partial<AnalysisResult>>>({});
  const [analysisRunning, setAnalysisRunning] = useState<Record<string, boolean>>({});
  const [analysisAgent,   setAnalysisAgent]   = useState<Record<string, string>>({});

  // StakeholderModal
  const [stakeholderTicker, setStakeholderTicker] = useState<string | null>(null);

  // Settings + auto-refresh
  const [settings,       setSettings]      = useState<EchoSettings>(loadSettings);
  const [showSettings,   setShowSettings]  = useState(false);
  const [lastAutoRefresh, setLastAutoRefresh] = useState<string>(
    () => localStorage.getItem('echo_last_auto_refresh') || ''
  );

  const inputRef = useRef<HTMLInputElement>(null);

  // Persist state across tab switches
  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);
  useEffect(() => { localStorage.setItem(LS_OPEN_TABS, JSON.stringify(openTabs)); }, [openTabs]);
  useEffect(() => { localStorage.setItem(LS_ACTIVE_VIEW, activeView); }, [activeView]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  // Focus add input
  useEffect(() => { if (addOpen) setTimeout(() => inputRef.current?.focus(), 50); }, [addOpen]);

  // ── Fetch price + signal history ────────────────────────────────────────────

  const fetchTickerData = useCallback(async (ticker: string) => {
    setLoadingTickers(prev => new Set(prev).add(ticker));
    try {
      const [quoteRes, histRes, summaryRes] = await Promise.allSettled([
        fetch(`/api/stock/${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/log/history/${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : []),
        fetch(`/api/stock/${encodeURIComponent(ticker)}/summary`).then(r => r.ok ? r.json() : null),
      ]);
      if (quoteRes.status === 'fulfilled' && quoteRes.value) {
        const q = quoteRes.value;
        // Extract 1-2 sentence description from assetProfile
        let description: string | undefined;
        let sector: string | undefined;
        let industry: string | undefined;
        if (summaryRes.status === 'fulfilled' && summaryRes.value) {
          const profile = summaryRes.value.assetProfile || {};
          const raw: string = profile.longBusinessSummary || '';
          if (raw) {
            // Take first 2 sentences
            const sentences = raw.match(/[^.!?]+[.!?]+/g) || [];
            description = sentences.slice(0, 2).join(' ').trim() || raw.slice(0, 200);
          }
          sector   = profile.sector   || undefined;
          industry = profile.industry || undefined;
        }
        setQuotes(prev => ({ ...prev, [ticker]: {
          regularMarketPrice: q.regularMarketPrice,
          regularMarketChangePercent: q.regularMarketChangePercent,
          currency: q.currency, longName: q.longName || q.shortName,
          marketCap: q.marketCap, trailingPE: q.trailingPE,
          description, sector, industry,
        }}));
      }
      if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) {
        setSignals(prev => ({ ...prev, [ticker]: histRes.value }));
      }
    } finally {
      setLoadingTickers(prev => { const n = new Set(prev); n.delete(ticker); return n; });
    }
  }, []);

  // ── Refresh (price + webIntel + compliance via server) ──────────────────────

  const refreshTicker = useCallback(async (ticker: string) => {
    setRefreshStatus(prev => ({ ...prev, [ticker]: 'refreshing' }));
    try {
      const res = await fetch(`/api/refresh/${encodeURIComponent(ticker)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Update price
      if (data.price) {
        const q = data.price;
        setQuotes(prev => ({ ...prev, [ticker]: {
          regularMarketPrice: q.regularMarketPrice,
          regularMarketChangePercent: q.regularMarketChangePercent,
          currency: q.currency, longName: q.longName || q.shortName,
          marketCap: q.marketCap, trailingPE: q.trailingPE,
        }}));
      }

      // Update liveData (webIntel + compliance) — triggers re-render in all consumers
      const entry: LiveEntry = {
        webIntel:    data.webIntel   ?? {},
        compliance:  data.compliance ?? {},
        refreshedAt: data.refreshed_at ?? new Date().toISOString(),
      };
      setLiveData(prev => ({ ...prev, [ticker]: entry }));
      persistLiveData(ticker, entry);
      setRefreshStatus(prev => ({ ...prev, [ticker]: 'idle' }));
    } catch (e: any) {
      console.error(`[Refresh] ${ticker}:`, e);
      setRefreshStatus(prev => ({ ...prev, [ticker]: 'error' }));
      // Reset error status after 4 seconds so user can retry
      setTimeout(() => setRefreshStatus(prev => ({ ...prev, [ticker]: 'idle' })), 4000);
    }
  }, []);

  // ── Inline full analysis ────────────────────────────────────────────────────

  const runInlineAnalysis = useCallback(async (ticker: string) => {
    setAnalysisRunning(prev => ({ ...prev, [ticker]: true }));
    setAnalysisData(prev => { const n = {...prev}; delete n[ticker]; return n; }); // clear stale
    let partial: Partial<AnalysisResult> = {};
    try {
      const final = await runMasterAnalysis(
        { ticker, options: ['highlights', 'risks', 'esg', 'competitors'] },
        (evt: AgentEvent) => {
          setAnalysisAgent(prev => ({ ...prev, [ticker]: `${evt.agent}: ${evt.status}` }));
          if (evt.partial) {
            partial = mergePartial(partial, evt.partial);
            setAnalysisData(prev => ({ ...prev, [ticker]: partial }));
          }
        }
      );
      setAnalysisData(prev => ({ ...prev, [ticker]: final }));
    } catch (e: any) {
      console.error(`[InlineAnalysis] ${ticker}:`, e);
    } finally {
      setAnalysisRunning(prev => ({ ...prev, [ticker]: false }));
      setAnalysisAgent(prev => { const n = {...prev}; delete n[ticker]; return n; });
    }
  }, []);

  const sendAlertEmail = useCallback(async (alerts: AlertEmailItem[]) => {
    const recipients = settings.alerts.recipients
      .split(/[,\n;]/)
      .map(v => v.trim())
      .filter(Boolean);
    if (!settings.alerts.enabled || recipients.length === 0 || alerts.length === 0) return;

    setAlertEmailStatus('sending');
    setAlertEmailMessage('');
    try {
      const res = await fetch('/api/alerts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients, alerts }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      setAlertEmailStatus('sent');
      setAlertEmailMessage(payload.sent === false ? 'Duplicate alerts skipped' : 'Alert email sent');
      setTimeout(() => { setAlertEmailStatus('idle'); setAlertEmailMessage(''); }, 3000);
    } catch (err: any) {
      console.error('[AlertEmail]', err);
      setAlertEmailStatus('error');
      setAlertEmailMessage(err.message || 'Alert email failed');
      setTimeout(() => { setAlertEmailStatus('idle'); setAlertEmailMessage(''); }, 7000);
    }
  }, [settings.alerts]);

  const buildAlertEmailItems = useCallback((
    ticker: string,
    entry: LiveEntry,
    quote?: StockQuote,
    previousSignal?: SignalRecord,
    nextSignal?: SignalRecord,
  ): AlertEmailItem[] => {
    const alerts: AlertEmailItem[] = [];
    const today = new Date().toISOString().slice(0, 10);

    if (settings.alerts.highCompliance) {
      (entry.compliance?.alerts ?? [])
        .filter(alert => alert.urgency === 'high')
        .forEach(alert => {
          const source = alert.source || alert.summary;
          alerts.push({
            alertKey: `high-compliance:${ticker}:${alertHash(source)}`,
            ticker,
            type: 'High Compliance',
            title: alert.summary.slice(0, 160),
            detail: [alert.category, alert.date].filter(Boolean).join(' · '),
          });
        });
    }

    if (settings.alerts.negativeNews) {
      (entry.webIntel?.news_signals ?? [])
        .filter(news => news.sentiment === 'negative')
        .forEach(news => {
          const source = news.url || news.title;
          alerts.push({
            alertKey: `negative-news:${ticker}:${alertHash(source)}`,
            ticker,
            type: 'Negative News',
            title: news.title,
            detail: [news.date, news.snippet].filter(Boolean).join(' — ').slice(0, 240),
          });
        });
    }

    if (settings.alerts.sellSignal && nextSignal?.verdict === 'SELL' && previousSignal?.verdict !== 'SELL') {
      alerts.push({
        alertKey: `sell-signal:${ticker}:${nextSignal.created_at || nextSignal.generated_at}`,
        ticker,
        type: 'SELL Signal',
        title: 'Investment signal changed to SELL',
        detail: nextSignal.risk_warnings?.[0] || nextSignal.key_reasons?.[0] || `${nextSignal.confidence} confidence`,
      });
    }

    const move = quote?.regularMarketChangePercent;
    if (move != null && Math.abs(move) >= settings.alerts.priceMovePct) {
      alerts.push({
        alertKey: `price-move:${ticker}:${today}:${Math.round(move * 100)}`,
        ticker,
        type: 'Price Move',
        title: `${ticker} moved ${move.toFixed(2)}% in one trading day`,
        detail: `Threshold: ${settings.alerts.priceMovePct}% · Price: ${fmtPrice(quote.regularMarketPrice, quote.currency)}`,
      });
    }

    return alerts;
  }, [settings.alerts]);

  const sendMonthlyReport = useCallback(async () => {
    const recipients = settings.alerts.recipients
      .split(/[,\n;]/)
      .map(v => v.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      setMonthlyReportStatus('error');
      setMonthlyReportMessage('Add recipient email in Settings');
      setTimeout(() => { setMonthlyReportStatus('idle'); setMonthlyReportMessage(''); }, 7000);
      return;
    }

    const range = getReportRange(reportPeriodMode, reportMonth);
    const portfolio = watchlist.map(item => {
      const ticker = item.ticker;
      const q = quotes[ticker];
      const latest = signals[ticker]?.[0];
      const entry = liveData[ticker];
      const highAlerts = entry?.compliance?.alerts
        ?.filter(alert => alert.urgency === 'high')
        .filter(alert => isWithinReportRange(alert.date, entry?.refreshedAt, range)).length ?? 0;
      const negativeNews = entry?.webIntel?.news_signals
        ?.filter(news => news.sentiment === 'negative')
        .filter(news => isWithinReportRange(news.date, entry?.refreshedAt, range)).length ?? 0;
      return {
        ticker,
        company: q?.longName || ticker,
        signal: latest?.verdict || 'NONE',
        highAlerts,
        negativeNews,
        priceChange: q?.regularMarketChangePercent ?? 0,
      };
    });

    setMonthlyReportStatus('sending');
    setMonthlyReportMessage('');
    try {
      const res = await fetch('/api/alerts/monthly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients,
          portfolio,
          periodLabel: range.label,
          periodStart: range.start.toISOString(),
          periodEnd: range.end.toISOString(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      setMonthlyReportStatus('sent');
      setMonthlyReportMessage('Monthly report email sent');
      setTimeout(() => { setMonthlyReportStatus('idle'); setMonthlyReportMessage(''); }, 4000);
    } catch (err: any) {
      console.error('[MonthlyReport]', err);
      setMonthlyReportStatus('error');
      setMonthlyReportMessage(err.message || 'Monthly report failed');
      setTimeout(() => { setMonthlyReportStatus('idle'); setMonthlyReportMessage(''); }, 7000);
    }
  }, [settings.alerts.recipients, watchlist, quotes, signals, liveData, reportPeriodMode, reportMonth]);

  // ── Portfolio-mode refresh: risk news + compliance + CIOAgent signal ──────────

  const portfolioRefreshTicker = useCallback(async (ticker: string) => {
    setRefreshStatus(prev => ({ ...prev, [ticker]: 'refreshing' }));
    try {
      const res = await fetch(`/api/portfolio-refresh/${encodeURIComponent(ticker)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const previousSignal = signals[ticker]?.[0];
      let refreshedQuote: StockQuote | undefined;
      let generatedSignal: SignalRecord | undefined;

      // Update price
      if (data.price) {
        const q = data.price;
        refreshedQuote = {
          regularMarketPrice: q.regularMarketPrice,
          regularMarketChangePercent: q.regularMarketChangePercent,
          currency: q.currency, longName: q.longName || q.shortName,
          marketCap: q.marketCap, trailingPE: q.trailingPE,
        };
        setQuotes(prev => ({ ...prev, [ticker]: refreshedQuote! }));
      }

      // Update live data
      const entry: LiveEntry = {
        webIntel:    data.webIntel   ?? {},
        compliance:  data.compliance ?? {},
        refreshedAt: data.refreshed_at ?? new Date().toISOString(),
      };
      setLiveData(prev => ({ ...prev, [ticker]: entry }));
      persistLiveData(ticker, entry);

      // Generate updated investment signal via CIOAgent
      try {
        const companyName = data.price?.longName || data.price?.shortName || ticker;
        const context = {
          company: { ticker, name: companyName },
          webIntel: entry.webIntel,
          compliance: entry.compliance,
        };
        const signal = await CIOAgent.generateInvestmentSignal(context);
        if (signal) {
          generatedSignal = { ...signal, created_at: signal.generated_at };
          // Prepend to signals list so it shows as latest
          setSignals(prev => ({
            ...prev,
            [ticker]: [
              generatedSignal!,
              ...(prev[ticker] || [])
            ]
          }));
          saveAnalysisLog(ticker, signal, companyName);
        }
      } catch (sigErr) {
        console.warn(`[portfolioRefresh] CIOAgent signal failed for ${ticker}:`, sigErr);
        // Non-fatal — price + webIntel + compliance already updated
      }

      const alertItems = buildAlertEmailItems(ticker, entry, refreshedQuote || quotes[ticker], previousSignal, generatedSignal);
      sendAlertEmail(alertItems);

      setRefreshStatus(prev => ({ ...prev, [ticker]: 'idle' }));
    } catch (e: any) {
      console.error(`[PortfolioRefresh] ${ticker}:`, e);
      setRefreshStatus(prev => ({ ...prev, [ticker]: 'error' }));
      setTimeout(() => setRefreshStatus(prev => ({ ...prev, [ticker]: 'idle' })), 4000);
    }
  }, [buildAlertEmailItems, quotes, sendAlertEmail, signals]);

  // ── Refresh All: serial to avoid API overload ────────────────────────────────

  const refreshAllTickers = useCallback(async () => {
    if (refreshAllActive) return;
    setRefreshAllActive(true);
    const tickers = watchlist.map(w => w.ticker);
    for (const t of tickers) {
      setRefreshAllCurrent(t);
      await portfolioRefreshTicker(t);
    }
    setRefreshAllCurrent('');
    setRefreshAllActive(false);
  }, [watchlist, refreshAllActive, portfolioRefreshTicker]);

  // ── Auto-refresh timer ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!settings.autoRefresh.enabled) return;

    const nowInET = (): Date => {
      const s = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      return new Date(s);
    };

    const checkAndRefresh = () => {
      const et   = nowInET();
      const hour = et.getHours();
      const day  = et.getDay(); // 0=Sun…6=Sat
      const triggerHour = 16 + settings.autoRefresh.delayHours;

      const isValidDay = settings.autoRefresh.days === 'weekdays'
        ? (day >= 1 && day <= 5)
        : day === 5;

      if (!isValidDay || hour < triggerHour) return;

      // Only once per day (ET date as key)
      const todayKey = et.toISOString().slice(0, 10);
      const lastKey  = localStorage.getItem('echo_last_auto_refresh');
      if (lastKey === todayKey) return;

      console.log(`[AutoRefresh] Triggering at ${et.toLocaleTimeString()} ET`);
      localStorage.setItem('echo_last_auto_refresh', todayKey);
      setLastAutoRefresh(todayKey);
      refreshAllTickers();
    };

    checkAndRefresh(); // check immediately on mount / settings change
    const timer = setInterval(checkAndRefresh, 60_000); // re-check every minute
    return () => clearInterval(timer);
  }, [settings.autoRefresh, refreshAllTickers]);

  // ── Stale data helper ────────────────────────────────────────────────────────

  const isStale = (ticker: string): boolean => {
    const entry = liveData[ticker];
    if (!entry?.refreshedAt) return false;
    const iv = settings.intervals.news;
    if (iv === 'off') return false;
    const ageMs = Date.now() - new Date(entry.refreshedAt).getTime();
    if (iv === 'daily')  return ageMs > 24 * 60 * 60 * 1000;
    if (iv === 'weekly') return ageMs > 7 * 24 * 60 * 60 * 1000;
    return false;
  };

  // On mount: fetch all tickers + load cached liveData from localStorage
  useEffect(() => {
    const tickers = watchlist.map(w => w.ticker);
    tickers.forEach(t => fetchTickerData(t));
    setLiveData(loadCachedLiveData(tickers));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watchlist management ────────────────────────────────────────────────────

  const addTicker = () => {
    const t = addInput.trim().toUpperCase();
    if (!t) return;
    if (/\s/.test(t) || t.length > 20) { setAddError('Invalid ticker'); return; }
    if (watchlist.some(w => w.ticker === t)) { setAddError('Already in watchlist'); return; }
    setWatchlist(prev => [...prev, { ticker: t, addedAt: new Date().toISOString() }]);
    fetchTickerData(t);
    // Load any cached data for the newly added ticker
    const cached = loadCachedLiveData([t]);
    if (cached[t]) setLiveData(prev => ({ ...prev, [t]: cached[t] }));
    setAddInput(''); setAddError(''); setAddOpen(false);
  };

  const removeTicker = (ticker: string) => {
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker));
    setOpenTabs(prev => prev.filter(t => t !== ticker));
    if (activeView === ticker) setActiveView('portfolio');
    setQuotes(prev => { const n = {...prev}; delete n[ticker]; return n; });
    setSignals(prev => { const n = {...prev}; delete n[ticker]; return n; });
    setLiveData(prev => { const n = {...prev}; delete n[ticker]; return n; });
  };

  const openStockTab = (ticker: string) => {
    if (!openTabs.includes(ticker)) setOpenTabs(prev => [...prev, ticker]);
    setActiveView(ticker);
  };
  const closeStockTab = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t !== ticker));
    if (activeView === ticker) setActiveView('portfolio');
  };

  // ── Summary for portfolio header (uses liveData for fresh compliance counts) ─

  const totalHoldings = watchlist.length;
  const signalCounts = { BUY: 0, HOLD: 0, SELL: 0 };
  let activeAlerts = 0;
  watchlist.forEach(w => {
    const latest = signals[w.ticker]?.[0];
    if (latest?.verdict) signalCounts[latest.verdict as keyof typeof signalCounts]++;
    const comp = liveData[w.ticker]?.compliance;
    activeAlerts += comp?.alerts?.filter(a => a.urgency === 'high').length ?? 0;
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#02040a]">

      {/* Inner tab bar */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-10 border-b border-slate-800/60 bg-[#080a0f]/80 overflow-x-auto">
        <button
          onClick={() => setActiveView('portfolio')}
          className={`shrink-0 px-3 py-1 rounded-md text-xs font-bold transition-colors ${
            activeView === 'portfolio' ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/20' : 'text-slate-500 hover:text-slate-300'
          }`}
        >Portfolio</button>
        {openTabs.map(ticker => {
          const isActive = activeView === ticker;
          return (
            <div key={ticker} className="shrink-0 flex items-center">
              <button
                onClick={() => setActiveView(ticker)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                  isActive ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="font-mono">{ticker}</span>
              </button>
              {/* X separated from the nav button to prevent accidental closes */}
              <button
                onClick={e => closeStockTab(ticker, e)}
                className={`ml-0.5 p-0.5 rounded transition-colors hover:text-rose-400 ${
                  isActive ? 'text-blue-400/60 hover:text-rose-400' : 'text-transparent pointer-events-none'
                }`}
                tabIndex={isActive ? 0 : -1}
                aria-label={`Close ${ticker} tab`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Settings button — right side of tab bar */}
        <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
          {settings.autoRefresh.enabled && (
            <span className="text-[10px] text-slate-600 hidden sm:block">
              {getNextAutoRefreshLabel(settings)}
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
            title="Dashboard Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
            lastAutoRefresh={lastAutoRefresh || undefined}
          />
        )}
      </AnimatePresence>

      {/* StakeholderModal — browse view; click an entity to open it as monitor tab */}
      {stakeholderTicker && (
        <StakeholderModal
          ticker={stakeholderTicker}
          onClose={() => setStakeholderTicker(null)}
          onSelectEntity={(entityTicker) => {
            const tk = entityTicker.trim().toUpperCase();
            if (!tk) return;
            // Add to watchlist if not present, then open as tab
            if (!watchlist.some(w => w.ticker === tk)) {
              setWatchlist(prev => [...prev, { ticker: tk, addedAt: new Date().toISOString() }]);
              fetchTickerData(tk);
            }
            openStockTab(tk);
            setStakeholderTicker(null);
          }}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="sync">
          {activeView === 'portfolio' ? (
            <motion.div key="portfolio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <PortfolioView
                watchlist={watchlist} quotes={quotes} signals={signals} liveData={liveData}
                loadingTickers={loadingTickers} refreshStatus={refreshStatus}
                signalCounts={signalCounts} totalHoldings={totalHoldings} activeAlerts={activeAlerts}
                addInput={addInput} setAddInput={setAddInput} addOpen={addOpen} setAddOpen={setAddOpen}
                addError={addError} setAddError={setAddError} inputRef={inputRef}
                onAddTicker={addTicker} onRemoveTicker={removeTicker}
                onSelectTicker={openStockTab}
                onRefresh={portfolioRefreshTicker}
                onRefreshAll={refreshAllTickers}
                refreshAllActive={refreshAllActive}
                refreshAllCurrent={refreshAllCurrent}
                isStale={isStale}
                onSendMonthlyReport={sendMonthlyReport}
                monthlyReportStatus={monthlyReportStatus}
                alertEmailStatus={alertEmailStatus}
                monthlyReportMessage={monthlyReportMessage}
                alertEmailMessage={alertEmailMessage}
                reportPeriodMode={reportPeriodMode}
                setReportPeriodMode={setReportPeriodMode}
                reportMonth={reportMonth}
                setReportMonth={setReportMonth}
                hasAlertRecipients={settings.alerts.recipients.split(/[,\n;]/).some(v => v.trim())}
                onOpenSettings={() => setShowSettings(true)}
              />
            </motion.div>
          ) : (
            <motion.div key={activeView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <IndividualStockView
                ticker={activeView}
                quote={quotes[activeView]}
                signalHistory={signals[activeView] || []}
                liveEntry={liveData[activeView]}
                loading={loadingTickers.has(activeView)}
                refreshStatus={refreshStatus[activeView] ?? 'idle'}
                analysisData={analysisData[activeView]}
                analysisLoading={analysisRunning[activeView] ?? false}
                analysisAgentStatus={analysisAgent[activeView] ?? ''}
                onRefresh={() => refreshTicker(activeView)}
                onRunAnalysis={() => runInlineAnalysis(activeView)}
                onOpenStakeholder={() => setStakeholderTicker(activeView)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Portfolio view ────────────────────────────────────────────────────────────

interface PortfolioViewProps {
  watchlist: WatchlistItem[];
  quotes: Record<string, StockQuote>;
  signals: Record<string, SignalRecord[]>;
  liveData: Record<string, LiveEntry>;
  loadingTickers: Set<string>;
  refreshStatus: Record<string, RefreshStatus>;
  signalCounts: Record<string, number>;
  totalHoldings: number;
  activeAlerts: number;
  addInput: string; setAddInput: (v: string) => void;
  addOpen: boolean;  setAddOpen: (v: boolean) => void;
  addError: string;  setAddError: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onAddTicker: () => void;
  onRemoveTicker: (t: string) => void;
  onSelectTicker: (t: string) => void;
  onRefresh: (t: string) => void;
  onRefreshAll: () => void;
  refreshAllActive: boolean;
  refreshAllCurrent: string;
  isStale: (ticker: string) => boolean;
  onSendMonthlyReport: () => void;
  monthlyReportStatus: EmailStatus;
  alertEmailStatus: EmailStatus;
  monthlyReportMessage: string;
  alertEmailMessage: string;
  reportPeriodMode: ReportPeriodMode;
  setReportPeriodMode: (mode: ReportPeriodMode) => void;
  reportMonth: string;
  setReportMonth: (month: string) => void;
  hasAlertRecipients: boolean;
  onOpenSettings: () => void;
}

function PortfolioView({
  watchlist, quotes, signals, liveData, loadingTickers, refreshStatus,
  signalCounts, totalHoldings, activeAlerts,
  addInput, setAddInput, addOpen, setAddOpen, addError, setAddError,
  inputRef, onAddTicker, onRemoveTicker, onSelectTicker, onRefresh,
  onRefreshAll, refreshAllActive, refreshAllCurrent, isStale,
  onSendMonthlyReport, monthlyReportStatus, alertEmailStatus, monthlyReportMessage, alertEmailMessage,
  reportPeriodMode, setReportPeriodMode, reportMonth, setReportMonth,
  hasAlertRecipients, onOpenSettings,
}: PortfolioViewProps) {
  const [showAllPortfolioNews, setShowAllPortfolioNews] = useState(false);
  const [showAllPortfolioAlerts, setShowAllPortfolioAlerts] = useState(false);

  const portfolioNews = watchlist
    .flatMap(item => {
      const entry = liveData[item.ticker];
      const company = quotes[item.ticker]?.longName || item.ticker;
      return (entry?.webIntel?.news_signals ?? []).map(signal => ({
        ...signal,
        ticker: item.ticker,
        company,
        refreshedAt: entry?.refreshedAt,
      }));
    })
    .sort((a, b) => eventTime(b.date, b.refreshedAt) - eventTime(a.date, a.refreshedAt));

  const portfolioAlerts = watchlist
    .flatMap(item => {
      const entry = liveData[item.ticker];
      const company = quotes[item.ticker]?.longName || item.ticker;
      return (entry?.compliance?.alerts ?? []).map(alert => ({
        ...alert,
        ticker: item.ticker,
        company,
        refreshedAt: entry?.refreshedAt,
      }));
    })
    .sort((a, b) => {
      const urgencyDelta = urgencyRank(a.urgency) - urgencyRank(b.urgency);
      return urgencyDelta || eventTime(b.date, b.refreshedAt) - eventTime(a.date, a.refreshedAt);
    });

  const portfolioNewsToShow = showAllPortfolioNews ? portfolioNews : portfolioNews.slice(0, 6);
  const portfolioAlertsToShow = showAllPortfolioAlerts ? portfolioAlerts : portfolioAlerts.slice(0, 6);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total Holdings" value={String(totalHoldings)} sub="tracked tickers" accent="text-blue-400" />
        <SummaryCard
          label="Active Alerts" value={activeAlerts > 0 ? String(activeAlerts) : '—'}
          sub="high urgency compliance" accent={activeAlerts > 0 ? 'text-rose-400' : 'text-slate-500'}
          valueClass={activeAlerts > 0 ? 'text-rose-400' : undefined}
        />
        <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Signals</div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-black text-emerald-400">BUY {signalCounts.BUY}</span>
            <span className="text-slate-700">·</span>
            <span className="text-sm font-black text-amber-400">HOLD {signalCounts.HOLD}</span>
            <span className="text-slate-700">·</span>
            <span className="text-sm font-black text-rose-400">SELL {signalCounts.SELL}</span>
          </div>
          <div className="text-[10px] text-slate-600 mt-1">from latest signals</div>
        </div>
      </div>

      {/* Holdings table */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Holdings</span>
          <div className="flex items-center gap-2 ml-auto">
            {refreshAllActive && refreshAllCurrent && (
              <span className="text-[10px] text-blue-400 font-mono">Refreshing {refreshAllCurrent}…</span>
            )}
            {alertEmailStatus !== 'idle' && (
              <span className={`text-[10px] font-bold ${
                alertEmailStatus === 'error' ? 'text-rose-400' :
                alertEmailStatus === 'sent' ? 'text-emerald-400' : 'text-blue-400'
              }`} title={alertEmailMessage || undefined}>
                {alertEmailStatus === 'sending' ? 'Sending alerts…' : alertEmailMessage || (alertEmailStatus === 'sent' ? 'Alerts sent' : 'Alert email failed')}
              </span>
            )}
            {monthlyReportStatus === 'error' && monthlyReportMessage && (
              <button
                onClick={onOpenSettings}
                className="max-w-[240px] truncate text-[10px] font-bold text-rose-400 hover:text-rose-300"
                title={`${monthlyReportMessage} — open Settings`}
              >
                {monthlyReportMessage}
              </button>
            )}
            {monthlyReportStatus === 'sent' && monthlyReportMessage && (
              <span className="text-[10px] font-bold text-emerald-400" title={monthlyReportMessage}>
                {monthlyReportMessage}
              </span>
            )}
            {watchlist.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  value={reportPeriodMode}
                  onChange={e => setReportPeriodMode(e.target.value as ReportPeriodMode)}
                  className="h-7 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-bold text-slate-400 focus:outline-none focus:border-cyan-500/50"
                  title="Monthly report period"
                >
                  <option value="last30">Last 30 days</option>
                  <option value="month">Full month</option>
                </select>
                {reportPeriodMode === 'month' && (
                  <input
                    type="month"
                    value={reportMonth}
                    onChange={e => setReportMonth(e.target.value || defaultReportMonth())}
                    className="h-7 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-bold text-slate-400 focus:outline-none focus:border-cyan-500/50"
                    title="Choose full calendar month"
                  />
                )}
              </div>
            )}
            {watchlist.length > 0 && (
              <button
                onClick={hasAlertRecipients ? onSendMonthlyReport : onOpenSettings}
                disabled={monthlyReportStatus === 'sending'}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-700 bg-slate-900 text-[11px] font-bold text-slate-400 hover:text-white hover:border-cyan-500/40 transition-colors disabled:opacity-40"
                title={hasAlertRecipients ? (monthlyReportMessage || 'Send monthly portfolio monitor email') : 'Open Settings to add recipient email'}
              >
                <Mail className={`w-3 h-3 ${monthlyReportStatus === 'sending' ? 'animate-pulse text-cyan-400' : ''}`} />
                {monthlyReportStatus === 'sending' ? 'Sending…' : monthlyReportStatus === 'sent' ? 'Sent' : !hasAlertRecipients ? 'Set Recipients' : monthlyReportStatus === 'error' ? 'Failed' : 'Monthly Report'}
              </button>
            )}
            {watchlist.length > 0 && (
              <button
                onClick={onRefreshAll}
                disabled={refreshAllActive}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-700 bg-slate-900 text-[11px] font-bold text-slate-400 hover:text-white hover:border-blue-500/40 transition-colors disabled:opacity-40"
              >
                <RefreshCcw className={`w-3 h-3 ${refreshAllActive ? 'animate-spin text-blue-400' : ''}`} />
                Refresh All
              </button>
            )}
            {watchlist.length > 0 && <span className="text-[10px] text-slate-600">{watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''}</span>}
          </div>
        </div>
        {watchlist.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-500 text-sm">No tickers yet.</p>
            <p className="text-slate-600 text-xs mt-1">Add a ticker below to start monitoring.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a0d14] border-b border-slate-800/80">
                <tr className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  <th className="px-5 py-3 text-left">Ticker</th>
                  <th className="px-5 py-3 text-left">Company</th>
                  <th className="px-5 py-3 text-right">Price</th>
                  <th className="px-5 py-3 text-right">Change</th>
                  <th className="px-5 py-3 text-center">Signal</th>
                  <th className="px-5 py-3 text-center">Alerts</th>
                  <th className="px-5 py-3 text-right">Last Updated</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {watchlist.map(item => {
                  const q      = quotes[item.ticker];
                  const latest = signals[item.ticker]?.[0];
                  const comp   = liveData[item.ticker]?.compliance;
                  const high   = comp?.alerts?.filter(a => a.urgency === 'high').length ?? 0;
                  const isFetching = loadingTickers.has(item.ticker);
                  const isRefreshing = refreshStatus[item.ticker] === 'refreshing';
                  const isErr  = refreshStatus[item.ticker] === 'error';
                  const stale  = isStale(item.ticker);
                  const change = fmtChange(q?.regularMarketChangePercent);
                  const vc     = verdictStyle(latest?.verdict);
                  const refreshedAt = liveData[item.ticker]?.refreshedAt;

                  return (
                    <tr key={item.ticker} onClick={() => onSelectTicker(item.ticker)} className="hover:bg-slate-800/30 cursor-pointer transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            isFetching || isRefreshing ? 'bg-blue-400 animate-pulse' : (latest ? vc.dot : 'bg-slate-600')
                          }`} />
                          <span className="font-bold font-mono text-white">{item.ticker}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">{isFetching ? <Sk w="w-32" /> : <span className="text-slate-300 truncate max-w-[180px] block">{q?.longName || '—'}</span>}</td>
                      <td className="px-5 py-3.5 text-right font-mono">{isFetching ? <Sk w="w-16" /> : <span className="text-white">{fmtPrice(q?.regularMarketPrice, q?.currency)}</span>}</td>
                      <td className="px-5 py-3.5 text-right font-mono">
                        {isFetching ? <Sk w="w-14" /> : (
                          <span className={`flex items-center justify-end gap-1 font-bold ${change.cls}`}>
                            {q?.regularMarketChangePercent != null && (q.regularMarketChangePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
                            {change.text}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {isFetching ? <Sk w="w-12 mx-auto" /> : latest ? (
                          <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-widest ${vc.badge}`}>{latest.verdict}</span>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {high > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold text-xs"><AlertTriangle className="w-3 h-3" />{high}</span>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isErr ? (
                          <span className="text-[10px] text-rose-400">Refresh failed</span>
                        ) : (
                          <span className={`text-[11px] flex items-center justify-end gap-1 ${stale ? 'text-amber-500' : 'text-slate-500'}`}>
                            {stale && <AlertCircle className="w-3 h-3" />}
                            <Clock className="w-3 h-3" />
                            {relTime(refreshedAt || latest?.created_at || latest?.generated_at)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); onRefresh(item.ticker); }}
                            disabled={isRefreshing || isFetching}
                            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
                            title="Refresh"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); onRemoveTicker(item.ticker); }} className="p-1.5 rounded-lg hover:bg-rose-950/30 text-slate-500 hover:text-rose-400 transition-colors" title="Remove">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add ticker */}
        <div className="px-5 py-4 border-t border-slate-800/60">
          {addOpen ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={inputRef} value={addInput}
                onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') onAddTicker(); if (e.key === 'Escape') { setAddOpen(false); setAddInput(''); setAddError(''); } }}
                placeholder="Enter ticker (e.g. AAPL)"
                className="w-48 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              />
              <button onClick={onAddTicker} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors">Add</button>
              <button onClick={() => { setAddOpen(false); setAddInput(''); setAddError(''); }} className="px-3 py-1.5 border border-slate-700 text-slate-400 hover:text-white text-xs rounded-lg transition-colors">Cancel</button>
              {addError && <span className="text-[10px] text-rose-400">{addError}</span>}
            </div>
          ) : (
            <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors">
              <Plus className="w-4 h-4" /> Add Ticker
            </button>
          )}
        </div>
      </div>

      {/* Portfolio-wide latest intelligence */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Portfolio News Signals</span>
            {refreshAllActive && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
            {!refreshAllActive && portfolioNews.length > 0 && (
              <span className="ml-auto text-[10px] text-slate-600">{portfolioNews.length} signals</span>
            )}
          </div>
          {portfolioNews.length > 0 ? (
            <>
              <div className="space-y-2">
                {portfolioNewsToShow.map((item, i) => (
                  <a key={`${item.ticker}-${item.url || item.title}-${i}`} href={item.url || undefined} target="_blank" rel="noreferrer"
                    className="block rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-cyan-900/50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="rounded border border-cyan-500/30 bg-cyan-950/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-cyan-300 font-mono">
                            {item.ticker}
                          </span>
                          <span className="truncate text-[10px] text-slate-600">{item.company}</span>
                        </div>
                        <span className="text-xs font-bold text-white leading-snug line-clamp-2">{item.title}</span>
                      </div>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${sentimentStyle(item.sentiment)}`}>{item.sentiment}</span>
                    </div>
                    {item.snippet && <p className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{item.snippet}</p>}
                    <p className="text-[10px] text-slate-700 mt-1 font-mono">{item.date || relTime(item.refreshedAt)}</p>
                  </a>
                ))}
              </div>
              {portfolioNews.length > 6 && (
                <button
                  onClick={() => setShowAllPortfolioNews(v => !v)}
                  className="mt-3 w-full py-1.5 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-colors"
                >
                  {showAllPortfolioNews ? 'Show less' : `Show ${portfolioNews.length - 6} more`}
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-600 italic">{refreshAllActive ? 'Refreshing portfolio news…' : 'No portfolio news data yet — click Refresh All.'}</p>
          )}
        </div>

        <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Portfolio Compliance Alerts</span>
            {refreshAllActive && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
            {!refreshAllActive && portfolioAlerts.length > 0 && (
              <span className="ml-auto text-[10px] text-slate-600">{portfolioAlerts.length} alerts</span>
            )}
          </div>
          {portfolioAlerts.length > 0 ? (
            <>
              <div className="space-y-2">
                {portfolioAlertsToShow.map((alert, i) => (
                  <div key={`${alert.ticker}-${alert.summary}-${i}`} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest mt-0.5 ${urgencyStyle(alert.urgency)}`}>{alert.urgency}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="rounded border border-rose-500/30 bg-rose-950/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-300 font-mono">
                            {alert.ticker}
                          </span>
                          <span className="truncate text-[10px] text-slate-600">{alert.company}</span>
                          {alert.category && <span className="ml-auto shrink-0 text-[9px] uppercase tracking-widest text-slate-700">{alert.category.replace('_', ' ')}</span>}
                        </div>
                        <p className="text-xs text-slate-300 leading-snug">{alert.summary}</p>
                        <p className="text-[10px] text-slate-700 mt-1 font-mono">{alert.date || relTime(alert.refreshedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {portfolioAlerts.length > 6 && (
                <button
                  onClick={() => setShowAllPortfolioAlerts(v => !v)}
                  className="mt-3 w-full py-1.5 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-colors"
                >
                  {showAllPortfolioAlerts ? 'Show less' : `Show ${portfolioAlerts.length - 6} more`}
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-600 italic">{refreshAllActive ? 'Refreshing portfolio alerts…' : 'No portfolio compliance data yet — click Refresh All.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Individual stock view ─────────────────────────────────────────────────────

interface IndividualStockViewProps {
  ticker: string;
  quote?: StockQuote;
  signalHistory: SignalRecord[];
  liveEntry?: LiveEntry;
  loading: boolean;
  refreshStatus: RefreshStatus;
  analysisData?: Partial<AnalysisResult>;
  analysisLoading: boolean;
  analysisAgentStatus: string;
  onRefresh: () => void;
  onRunAnalysis: () => void;
  onOpenStakeholder: () => void;
}

function IndividualStockView({ ticker, quote, signalHistory, liveEntry, loading, refreshStatus, analysisData, analysisLoading, analysisAgentStatus, onRefresh, onRunAnalysis, onOpenStakeholder }: IndividualStockViewProps) {
  const latest      = signalHistory[0];
  const newsSignals = liveEntry?.webIntel?.news_signals ?? [];
  const alerts      = liveEntry?.compliance?.alerts ?? [];
  const vc          = verdictStyle(latest?.verdict);
  const change      = fmtChange(quote?.regularMarketChangePercent);
  const isRefreshing = refreshStatus === 'refreshing';
  const isError      = refreshStatus === 'error';
  const hasReport   = !!analysisData?.company;

  const [view,        setView]        = useState<'monitor' | 'report'>('monitor');
  const [showAllNews, setShowAllNews] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  useEffect(() => { if (hasReport && !analysisLoading) setView('report'); }, [hasReport, analysisLoading]);

  const newsToShow   = showAllNews   ? newsSignals : newsSignals.slice(0, 3);
  const alertsToShow = showAllAlerts ? alerts      : alerts.slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black font-mono text-white">{ticker}</span>
            {(loading || isRefreshing) && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
          </div>
          {quote?.longName && <p className="text-sm text-slate-400 mt-0.5">{quote.longName}</p>}
          {/* Company description */}
          {quote?.description && (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-2xl">{quote.description}</p>
          )}
          {!quote?.description && quote?.sector && (
            <p className="text-xs text-slate-500 mt-2">{[quote.sector, quote.industry].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {liveEntry?.refreshedAt && !isRefreshing && !isError && (
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Updated {relTime(liveEntry.refreshedAt)}
            </span>
          )}
          {isError && (
            <span className="text-[10px] text-rose-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Refresh failed, showing cached data
            </span>
          )}
          <button
            onClick={onRefresh} disabled={loading || isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700 rounded-lg text-xs font-bold text-slate-400 hover:text-white hover:border-blue-500/50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
            {isRefreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      </div>

      {/* ── Row 1: Investment Signal + Market Data ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Investment Signal */}
        <div className={`rounded-2xl border p-5 ${latest ? 'border-slate-700 bg-[#080a0f]/90' : 'border-slate-800 bg-[#080a0f]/90'}`}>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Investment Signal</div>
          {loading && !latest ? (
            <div className="space-y-2"><Sk h="h-8" w="w-24" /><Sk /><Sk w="w-3/4" /></div>
          ) : latest ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full ${vc.dot}`} />
                <span className={`text-3xl font-black font-mono tracking-widest ${vc.text}`}>{latest.verdict}</span>
                <span className={`ml-auto text-[11px] font-bold uppercase tracking-widest ${confidenceStyle(latest.confidence)}`}>{latest.confidence} confidence</span>
              </div>
              {latest.key_reasons.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Key Reasons
                  </div>
                  <ul className="space-y-1.5">
                    {latest.key_reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-300 leading-snug">
                        <span className="mt-1 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {latest.risk_warnings.length > 0 && (
                <div className="border-t border-slate-800/60 pt-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500" /> Risk Warnings
                  </div>
                  <ul className="space-y-1.5">
                    {latest.risk_warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-400 leading-snug">
                        <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />{w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 text-[10px] text-slate-600">Generated: {relTime(latest.created_at || latest.generated_at)}</div>
            </>
          ) : (
            <p className="text-sm text-slate-500 italic">No signal yet — run a full analysis to generate one.</p>
          )}
        </div>

        {/* Market Data */}
        <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Market Data</div>
          {loading && !quote ? (
            <div className="space-y-2"><Sk h="h-8" w="w-28" /><Sk w="w-1/2" /></div>
          ) : quote ? (
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <span className="text-2xl font-black text-white font-mono">{fmtPrice(quote.regularMarketPrice, quote.currency)}</span>
                <span className={`flex items-center gap-1 font-bold text-sm mb-0.5 ${change.cls}`}>
                  {quote.regularMarketChangePercent != null && (quote.regularMarketChangePercent >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />)}
                  {change.text}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900/50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-600 uppercase tracking-widest">Market Cap</div>
                  <div className="text-sm font-bold text-slate-300 mt-0.5">{fmtMktCap(quote.marketCap, quote.currency)}</div>
                </div>
                <div className="bg-slate-900/50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-600 uppercase tracking-widest">Trailing P/E</div>
                  <div className="text-sm font-bold text-slate-300 mt-0.5">{quote.trailingPE ? `${quote.trailingPE.toFixed(1)}x` : '—'}</div>
                </div>
              </div>
              {quote.currency && quote.currency !== 'USD' && (
                <p className="text-[10px] text-amber-500/70">Local currency · not converted</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No market data — click Refresh data.</p>
          )}
        </div>
      </div>

      {/* ── News Signals (expandable) ───────────────────────────────────────── */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-cyan-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">News Signals</span>
          {isRefreshing && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
          {liveEntry?.refreshedAt && !isRefreshing && (
            <span className="ml-auto text-[10px] text-slate-600">{relTime(liveEntry.refreshedAt)}</span>
          )}
        </div>
        {newsSignals.length > 0 ? (
          <>
            <div className="space-y-2">
              {newsToShow.map((item, i) => (
                <a key={i} href={item.url || undefined} target="_blank" rel="noreferrer"
                  className="block rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-cyan-900/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-white leading-snug line-clamp-2">{item.title}</span>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${sentimentStyle(item.sentiment)}`}>{item.sentiment}</span>
                  </div>
                  {item.snippet && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{item.snippet}</p>}
                  {item.date && <p className="text-[10px] text-slate-700 mt-1 font-mono">{item.date}</p>}
                </a>
              ))}
            </div>
            {newsSignals.length > 3 && (
              <button
                onClick={() => setShowAllNews(v => !v)}
                className="mt-3 w-full py-1.5 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-colors"
              >
                {showAllNews ? `Show less` : `Show ${newsSignals.length - 3} more`}
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-600 italic">{isRefreshing ? 'Fetching news…' : 'No news data — click Refresh data.'}</p>
        )}
      </div>

      {/* ── Compliance Alerts (expandable) ─────────────────────────────────── */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compliance Alerts</span>
          {isRefreshing && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
          {alerts.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-600">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {alerts.length > 0 ? (
          <>
            <div className="space-y-2">
              {alertsToShow.map((alert, i) => (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest mt-0.5 ${urgencyStyle(alert.urgency)}`}>{alert.urgency}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 leading-snug">{alert.summary}</p>
                      {alert.date && <p className="text-[10px] text-slate-700 mt-1 font-mono">{alert.date}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {alerts.length > 3 && (
              <button
                onClick={() => setShowAllAlerts(v => !v)}
                className="mt-3 w-full py-1.5 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-colors"
              >
                {showAllAlerts ? `Show less` : `Show ${alerts.length - 3} more`}
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-600 italic">{isRefreshing ? 'Fetching alerts…' : 'No compliance data — click Refresh data.'}</p>
        )}
      </div>

      {/* Signal history */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-indigo-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Signal History</span>
          <span className="ml-auto text-[10px] text-slate-600">last 5</span>
        </div>
        {signalHistory.length === 0 ? (
          <p className="text-xs text-slate-600 italic text-center py-4">No signal history yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-800" />
            <div className="space-y-4">
              {signalHistory.slice(0, 5).map((rec, i) => {
                const rvc = verdictStyle(rec.verdict);
                return (
                  <div key={i} className="flex items-start gap-4">
                    <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 ring-2 ring-[#080a0f] ${rvc.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-widest font-mono ${rvc.text}`}>{rec.verdict}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${confidenceStyle(rec.confidence)}`}>{rec.confidence}</span>
                        <span className="ml-auto text-[10px] text-slate-600">
                          {new Date(rec.created_at || rec.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      {rec.key_reasons[0] && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{rec.key_reasons[0]}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons + view toggle */}
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <button
          onClick={onRunAnalysis}
          disabled={analysisLoading}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(37,99,235,0.25)]"
        >
          {analysisLoading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</>
            : <><Zap className="w-4 h-4" /> {hasReport ? 'Re-run Analysis' : 'Run Full Analysis'}</>
          }
        </button>
        <button
          onClick={onOpenStakeholder}
          className="flex items-center gap-2 px-5 py-2.5 border border-slate-700 bg-[#0a0d14] text-slate-300 hover:text-white hover:border-slate-600 rounded-xl text-sm font-bold transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Stakeholder & ESG
        </button>
        {hasReport && (
          <div className="ml-auto flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('monitor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${view === 'monitor' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <BarChart3 className="w-3 h-3" /> Monitor
            </button>
            <button
              onClick={() => setView('report')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${view === 'report' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <ExternalLink className="w-3 h-3" /> Full Report
            </button>
          </div>
        )}
      </div>

      {/* Agent status while analysing */}
      {analysisLoading && analysisAgentStatus && (
        <div className="flex items-center gap-3 bg-slate-900/80 border border-blue-500/20 rounded-xl px-4 py-3">
          <Bot className="w-4 h-4 text-blue-400 animate-pulse shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Multi-Agent Analysis Running</div>
            <div className="text-xs text-slate-300 mt-0.5 truncate">{analysisAgentStatus}</div>
          </div>
        </div>
      )}

      {/* Full report inline */}
      {(hasReport || analysisLoading) && view === 'report' && (
        <div className="border border-slate-800 rounded-2xl overflow-hidden">
          <AnalysisDashboard
            data={analysisData ?? {}}
            isLoading={analysisLoading}
            onReset={onRunAnalysis}
            hideToolbar={false}
          />
        </div>
      )}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent, valueClass }: { label: string; value: string; sub: string; accent: string; valueClass?: string }) {
  return (
    <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-3xl font-black font-mono ${valueClass ?? 'text-white'}`}>{value}</div>
      <div className={`text-[10px] mt-1 font-bold ${accent}`}>{sub}</div>
    </div>
  );
}
