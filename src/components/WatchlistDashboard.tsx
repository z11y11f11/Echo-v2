/**
 * WatchlistDashboard — two-view monitoring page.
 *
 * View 1 (Portfolio Overview):  summary cards + holdings table
 * View 2 (Individual Stock):    signal card + price card + news + compliance + history
 *
 * Data sources:
 *   - Signal / history : GET /api/log/history/:ticker
 *   - Market price     : GET /api/stock/:ticker
 *   - News / compliance: localStorage  echo_webintel_{ticker} / echo_compliance_{ticker}
 *     (written by Orchestrator after each full analysis)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, X, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Clock, ChevronRight,
  BarChart3, ExternalLink, Loader2, ShieldAlert, Globe,
  History, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
}

interface ComplianceAlert {
  summary: string;
  source: string;
  urgency: 'high' | 'medium' | 'low';
  date: string | null;
  category: string;
}

interface WebIntelCache {
  news_signals?: NewsSignal[];
  data_gaps?: string[];
}

interface ComplianceCache {
  alerts?: ComplianceAlert[];
  overall_risk?: string;
  data_gaps?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_WATCHLIST = 'echo_watchlist_v2';

function loadWatchlist(): WatchlistItem[] {
  try { return JSON.parse(localStorage.getItem(LS_WATCHLIST) || '[]'); } catch { return []; }
}
function saveWatchlist(items: WatchlistItem[]) {
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(items));
}
function readWebIntel(ticker: string): WebIntelCache | null {
  try { return JSON.parse(localStorage.getItem(`echo_webintel_${ticker}`) || 'null'); } catch { return null; }
}
function readCompliance(ticker: string): ComplianceCache | null {
  try { return JSON.parse(localStorage.getItem(`echo_compliance_${ticker}`) || 'null'); } catch { return null; }
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function verdictStyle(v?: string) {
  if (v === 'BUY')  return { badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', text: 'text-emerald-300' };
  if (v === 'SELL') return { badge: 'bg-rose-950/60 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400',    text: 'text-rose-300' };
  return              { badge: 'bg-amber-950/60 text-amber-300 border-amber-500/40',              dot: 'bg-amber-400',   text: 'text-amber-300' };
}

function confidenceStyle(c?: string) {
  if (c === 'high')   return 'text-emerald-400';
  if (c === 'medium') return 'text-amber-400';
  return 'text-slate-400';
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

function relTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtPrice(price?: number, currency?: string): string {
  if (!price) return '—';
  const sym = currency === 'USD' ? '$' : (currency || '');
  const val = currency === 'KRW' || currency === 'JPY'
    ? Math.round(price).toLocaleString()
    : price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${sym}${val}`;
}

function fmtChange(pct?: number): { text: string; cls: string } {
  if (pct === undefined || pct === null) return { text: '—', cls: 'text-slate-500' };
  const sign = pct >= 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(2)}%`, cls: pct >= 0 ? 'text-emerald-400' : 'text-rose-400' };
}

function fmtMktCap(v?: number, currency?: string): string {
  if (!v) return '—';
  const cur = currency ? ` ${currency}` : '';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T${cur}`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B${cur}`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M${cur}`;
  return `${v.toLocaleString()}${cur}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

const Skeleton = ({ h = 'h-4', w = 'w-full' }: { h?: string; w?: string }) => (
  <div className={`${h} ${w} bg-slate-800 rounded animate-pulse`} />
);

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onNavigateToAnalysis: () => void;
}

export default function WatchlistDashboard({ onNavigateToAnalysis }: Props) {
  // watchlist + tabs state
  const [watchlist, setWatchlist]     = useState<WatchlistItem[]>(loadWatchlist);
  const [openTabs, setOpenTabs]       = useState<string[]>([]);   // tickers with individual tabs open
  const [activeView, setActiveView]   = useState<'portfolio' | string>('portfolio');

  // per-ticker data
  const [quotes,   setQuotes]   = useState<Record<string, StockQuote>>({});
  const [signals,  setSignals]  = useState<Record<string, SignalRecord[]>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());

  // add-ticker UI
  const [addInput, setAddInput]   = useState('');
  const [addOpen,  setAddOpen]    = useState(false);
  const [addError, setAddError]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // persist watchlist
  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);

  // auto-focus add input
  useEffect(() => { if (addOpen) setTimeout(() => inputRef.current?.focus(), 50); }, [addOpen]);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchTickerData = useCallback(async (ticker: string) => {
    setLoadingTickers(prev => new Set(prev).add(ticker));
    try {
      const [quoteRes, histRes] = await Promise.allSettled([
        fetch(`/api/stock/${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/log/history/${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : []),
      ]);

      if (quoteRes.status === 'fulfilled' && quoteRes.value) {
        const q = quoteRes.value;
        setQuotes(prev => ({
          ...prev,
          [ticker]: {
            regularMarketPrice:         q.regularMarketPrice,
            regularMarketChangePercent: q.regularMarketChangePercent,
            currency:                   q.currency,
            longName:                   q.longName || q.shortName,
            marketCap:                  q.marketCap,
            trailingPE:                 q.trailingPE,
          }
        }));
      }
      if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) {
        setSignals(prev => ({ ...prev, [ticker]: histRes.value }));
      }
    } finally {
      setLoadingTickers(prev => { const n = new Set(prev); n.delete(ticker); return n; });
    }
  }, []);

  // fetch all tickers on mount, then individual on add
  useEffect(() => {
    watchlist.forEach(w => fetchTickerData(w.ticker));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watchlist management ────────────────────────────────────────────────────

  const addTicker = () => {
    const t = addInput.trim().toUpperCase();
    if (!t) return;
    if (/\s/.test(t) || t.length > 20) { setAddError('Invalid ticker'); return; }
    if (watchlist.some(w => w.ticker === t)) { setAddError('Already in watchlist'); return; }
    setWatchlist(prev => [...prev, { ticker: t, addedAt: new Date().toISOString() }]);
    fetchTickerData(t);
    setAddInput(''); setAddError(''); setAddOpen(false);
  };

  const removeTicker = (ticker: string) => {
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker));
    setOpenTabs(prev => prev.filter(t => t !== ticker));
    if (activeView === ticker) setActiveView('portfolio');
    setQuotes(prev => { const n = {...prev}; delete n[ticker]; return n; });
    setSignals(prev => { const n = {...prev}; delete n[ticker]; return n; });
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

  // ── Computed summaries for portfolio header ─────────────────────────────────

  const totalHoldings = watchlist.length;
  const signalCounts = { BUY: 0, HOLD: 0, SELL: 0 };
  let activeAlerts = 0;
  watchlist.forEach(w => {
    const latest = signals[w.ticker]?.[0];
    if (latest?.verdict) signalCounts[latest.verdict]++;
    const comp = readCompliance(w.ticker);
    activeAlerts += comp?.alerts?.filter(a => a.urgency === 'high').length ?? 0;
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#02040a]">

      {/* ── Inner tab bar ───────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-10 border-b border-slate-800/60 bg-[#080a0f]/80 overflow-x-auto">
        {/* Portfolio tab */}
        <button
          onClick={() => setActiveView('portfolio')}
          className={`shrink-0 px-3 py-1 rounded-md text-xs font-bold transition-colors ${
            activeView === 'portfolio'
              ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/20'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Portfolio
        </button>

        {/* Individual ticker tabs */}
        {openTabs.map(ticker => (
          <button
            key={ticker}
            onClick={() => setActiveView(ticker)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors group ${
              activeView === ticker
                ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className="font-mono">{ticker}</span>
            <X
              className="w-3 h-3 opacity-50 group-hover:opacity-100 hover:text-rose-400 transition-colors"
              onClick={e => closeStockTab(ticker, e)}
            />
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeView === 'portfolio' ? (
            <motion.div key="portfolio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <PortfolioView
                watchlist={watchlist}
                quotes={quotes}
                signals={signals}
                loadingTickers={loadingTickers}
                signalCounts={signalCounts}
                totalHoldings={totalHoldings}
                activeAlerts={activeAlerts}
                addInput={addInput}
                setAddInput={setAddInput}
                addOpen={addOpen}
                setAddOpen={setAddOpen}
                addError={addError}
                setAddError={setAddError}
                inputRef={inputRef}
                onAddTicker={addTicker}
                onRemoveTicker={removeTicker}
                onSelectTicker={openStockTab}
                onRefresh={fetchTickerData}
              />
            </motion.div>
          ) : (
            <motion.div key={activeView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <IndividualStockView
                ticker={activeView}
                quote={quotes[activeView]}
                signalHistory={signals[activeView] || []}
                loading={loadingTickers.has(activeView)}
                onNavigateToAnalysis={onNavigateToAnalysis}
                onRefresh={() => fetchTickerData(activeView)}
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
  loadingTickers: Set<string>;
  signalCounts: Record<string, number>;
  totalHoldings: number;
  activeAlerts: number;
  addInput: string;
  setAddInput: (v: string) => void;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  addError: string;
  setAddError: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onAddTicker: () => void;
  onRemoveTicker: (t: string) => void;
  onSelectTicker: (t: string) => void;
  onRefresh: (t: string) => void;
}

function PortfolioView({
  watchlist, quotes, signals, loadingTickers,
  signalCounts, totalHoldings, activeAlerts,
  addInput, setAddInput, addOpen, setAddOpen, addError, setAddError,
  inputRef, onAddTicker, onRemoveTicker, onSelectTicker, onRefresh,
}: PortfolioViewProps) {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">

      {/* ── Summary cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Total Holdings"
          value={String(totalHoldings)}
          sub="tracked tickers"
          accent="text-blue-400"
        />
        <SummaryCard
          label="Active Alerts"
          value={activeAlerts > 0 ? String(activeAlerts) : '—'}
          sub="high urgency compliance"
          accent={activeAlerts > 0 ? 'text-rose-400' : 'text-slate-500'}
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

      {/* ── Holdings table ─────────────────────────────────────────────── */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Holdings</span>
          {watchlist.length > 0 && (
            <span className="text-[10px] text-slate-600">{watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {watchlist.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-500 text-sm">No tickers in watchlist yet.</p>
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
                  const q = quotes[item.ticker];
                  const hist = signals[item.ticker];
                  const latest = hist?.[0];
                  const comp = readCompliance(item.ticker);
                  const highAlerts = comp?.alerts?.filter(a => a.urgency === 'high').length ?? 0;
                  const isLoading = loadingTickers.has(item.ticker);
                  const change = fmtChange(q?.regularMarketChangePercent);
                  const vc = verdictStyle(latest?.verdict);

                  return (
                    <tr
                      key={item.ticker}
                      onClick={() => onSelectTicker(item.ticker)}
                      className="hover:bg-slate-800/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isLoading ? 'bg-blue-400 animate-pulse' : (latest ? vc.dot : 'bg-slate-600')}`} />
                          <span className="font-bold font-mono text-white">{item.ticker}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {isLoading ? <Skeleton w="w-32" /> : (
                          <span className="text-slate-300 truncate max-w-[180px] block">{q?.longName || '—'}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono">
                        {isLoading ? <Skeleton w="w-16" /> : (
                          <span className="text-white">{fmtPrice(q?.regularMarketPrice, q?.currency)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono">
                        {isLoading ? <Skeleton w="w-14" /> : (
                          <span className={`flex items-center justify-end gap-1 font-bold ${change.cls}`}>
                            {q?.regularMarketChangePercent !== undefined && (
                              q.regularMarketChangePercent >= 0
                                ? <TrendingUp className="w-3 h-3" />
                                : <TrendingDown className="w-3 h-3" />
                            )}
                            {change.text}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {isLoading ? <Skeleton w="w-12 mx-auto" /> : latest ? (
                          <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-widest ${vc.badge}`}>
                            {latest.verdict}
                          </span>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {highAlerts > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold text-xs">
                            <AlertTriangle className="w-3 h-3" />{highAlerts}
                          </span>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          {relTime(latest?.created_at || latest?.generated_at)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); onRefresh(item.ticker); }}
                            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
                            title="Refresh"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); onRemoveTicker(item.ticker); }}
                            className="p-1.5 rounded-lg hover:bg-rose-950/30 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Remove"
                          >
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

        {/* ── Add ticker ─────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-slate-800/60">
          {addOpen ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={addInput}
                onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') onAddTicker(); if (e.key === 'Escape') { setAddOpen(false); setAddInput(''); setAddError(''); } }}
                placeholder="Enter ticker (e.g. AAPL)"
                className="w-48 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              />
              <button
                onClick={onAddTicker}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => { setAddOpen(false); setAddInput(''); setAddError(''); }}
                className="px-3 py-1.5 border border-slate-700 text-slate-400 hover:text-white text-xs rounded-lg transition-colors"
              >
                Cancel
              </button>
              {addError && <span className="text-[10px] text-rose-400">{addError}</span>}
            </div>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Ticker
            </button>
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
  loading: boolean;
  onNavigateToAnalysis: () => void;
  onRefresh: () => void;
}

function IndividualStockView({
  ticker, quote, signalHistory, loading, onNavigateToAnalysis, onRefresh
}: IndividualStockViewProps) {
  const latest = signalHistory[0];
  const webIntel = readWebIntel(ticker);
  const compliance = readCompliance(ticker);
  const vc = verdictStyle(latest?.verdict);
  const change = fmtChange(quote?.regularMarketChangePercent);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">

      {/* ── Ticker header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black font-mono text-white">{ticker}</span>
            {loading && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
          </div>
          {quote?.longName && <p className="text-sm text-slate-400 mt-0.5">{quote.longName}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh data
          </button>
        </div>
      </div>

      {/* ── 2-column grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left column */}
        <div className="space-y-5">
          {/* Signal card */}
          <div className={`rounded-2xl border p-5 ${latest ? vc.badge.replace('text-', 'border-').replace(/bg-[^ ]+/, 'bg-[#080a0f]/90') : 'border-slate-800 bg-[#080a0f]/90'}`}>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Investment Signal</div>
            {loading && !latest ? (
              <div className="space-y-2"><Skeleton h="h-8" w="w-24" /><Skeleton /><Skeleton w="w-3/4" /></div>
            ) : latest ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-3 h-3 rounded-full ${vc.dot}`} />
                  <span className={`text-3xl font-black font-mono tracking-widest ${vc.text}`}>{latest.verdict}</span>
                  <span className={`ml-auto text-[11px] font-bold uppercase tracking-widest ${confidenceStyle(latest.confidence)}`}>
                    {latest.confidence} confidence
                  </span>
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
                <div className="mt-3 text-[10px] text-slate-600">
                  Signal generated: {relTime(latest.created_at || latest.generated_at)}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500 italic">No signal yet — run a full analysis to generate one.</p>
            )}
          </div>

          {/* Price card */}
          <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Market Data</div>
            {loading && !quote ? (
              <div className="space-y-2"><Skeleton h="h-8" w="w-28" /><Skeleton w="w-1/2" /></div>
            ) : quote ? (
              <div className="space-y-3">
                <div className="flex items-end gap-3">
                  <span className="text-2xl font-black text-white font-mono">
                    {fmtPrice(quote.regularMarketPrice, quote.currency)}
                  </span>
                  <span className={`flex items-center gap-1 font-bold text-sm mb-0.5 ${change.cls}`}>
                    {quote.regularMarketChangePercent !== undefined && (
                      quote.regularMarketChangePercent >= 0
                        ? <TrendingUp className="w-4 h-4" />
                        : <TrendingDown className="w-4 h-4" />
                    )}
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
                    <div className="text-sm font-bold text-slate-300 mt-0.5">
                      {quote.trailingPE ? `${quote.trailingPE.toFixed(1)}x` : '—'}
                    </div>
                  </div>
                </div>
                {quote.currency && quote.currency !== 'USD' && (
                  <p className="text-[10px] text-amber-500/70">Local currency · not converted</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">No market data — refresh to fetch.</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* News signals */}
          <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">News Signals</span>
              <span className="ml-auto text-[10px] text-slate-600">from last analysis</span>
            </div>
            {webIntel?.news_signals && webIntel.news_signals.length > 0 ? (
              <div className="space-y-2">
                {webIntel.news_signals.slice(0, 3).map((item, i) => (
                  <a
                    key={i}
                    href={item.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-cyan-900/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-white leading-snug line-clamp-2">{item.title}</span>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${sentimentStyle(item.sentiment)}`}>
                        {item.sentiment}
                      </span>
                    </div>
                    {item.snippet && <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-snug">{item.snippet}</p>}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No news data — run a full analysis to populate.</p>
            )}
          </div>

          {/* Compliance alerts */}
          <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compliance Alerts</span>
              <span className="ml-auto text-[10px] text-slate-600">from last analysis</span>
            </div>
            {compliance?.alerts && compliance.alerts.length > 0 ? (
              <div className="space-y-2">
                {compliance.alerts.slice(0, 3).map((alert, i) => (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest mt-0.5 ${urgencyStyle(alert.urgency)}`}>
                        {alert.urgency}
                      </span>
                      <p className="text-xs text-slate-300 leading-snug line-clamp-3">{alert.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No compliance data — run a full analysis to populate.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Signal history (full width) ─────────────────────────────────── */}
      <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-indigo-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Signal History</span>
          <span className="ml-auto text-[10px] text-slate-600">last 5 signals</span>
        </div>
        {signalHistory.length === 0 ? (
          <p className="text-xs text-slate-600 italic text-center py-4">No signal history yet.</p>
        ) : (
          <div className="relative">
            {/* Timeline line */}
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
                      {rec.key_reasons[0] && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">{rec.key_reasons[0]}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Action buttons ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pb-4">
        <button
          onClick={onNavigateToAnalysis}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(37,99,235,0.25)]"
        >
          <Zap className="w-4 h-4" /> Run Full Analysis
        </button>
        <button
          onClick={onNavigateToAnalysis}
          className="flex items-center gap-2 px-5 py-2.5 border border-slate-700 bg-[#0a0d14] text-slate-300 hover:text-white hover:border-slate-600 rounded-xl text-sm font-bold transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> View Stakeholder & ESG
        </button>
        <span className="text-[10px] text-slate-600 ml-auto">
          Deep analysis available in Market Analysis tab
        </span>
      </div>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent, valueClass }: {
  label: string; value: string; sub: string; accent: string; valueClass?: string;
}) {
  return (
    <div className="bg-[#080a0f]/80 border border-slate-800 rounded-2xl p-5">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-3xl font-black font-mono ${valueClass ?? 'text-white'}`}>{value}</div>
      <div className={`text-[10px] mt-1 font-bold ${accent}`}>{sub}</div>
    </div>
  );
}
