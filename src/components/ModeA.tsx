import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Zap, Bot, X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { runMasterAnalysis, AgentEvent } from '../services/ai';
import AnalysisDashboard from './AnalysisDashboard';
import { AnalysisResult } from '../types';

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_TABS   = 'echo_modea_tabs_v1';
const LS_ACTIVE = 'echo_modea_active_v1';
const dataKey   = (t: string) => `echo_modea_data_${t}`;

function loadTabs(): string[]  { try { return JSON.parse(localStorage.getItem(LS_TABS) || '[]'); } catch { return []; } }
function loadActive(): string  { return localStorage.getItem(LS_ACTIVE) || 'new'; }
function loadData(t: string): Partial<AnalysisResult> | null {
  try { return JSON.parse(localStorage.getItem(dataKey(t)) || 'null'); } catch { return null; }
}
function saveData(t: string, d: Partial<AnalysisResult>) {
  try { localStorage.setItem(dataKey(t), JSON.stringify(d)); } catch {}
}
function deleteData(t: string) {
  localStorage.removeItem(dataKey(t));
}

// ── mergePartial ─────────────────────────────────────────────────────────────

function mergePartial(acc: Partial<AnalysisResult>, incoming: Partial<AnalysisResult>): Partial<AnalysisResult> {
  const merged = { ...acc, ...incoming };
  if (acc.metrics && incoming.metrics) {
    const seen = new Set(acc.metrics.map(m => m.label));
    merged.metrics = [...acc.metrics, ...incoming.metrics.filter(m => !seen.has(m.label))];
  }
  if (acc.highlights && incoming.highlights) {
    const seen = new Set(acc.highlights.map(h => h.trim()));
    merged.highlights = [...acc.highlights, ...incoming.highlights.filter(h => !seen.has(h.trim()))];
  }
  if (acc.risks && incoming.risks) {
    const seen = new Set(acc.risks.map(r => r.trim()));
    merged.risks = [...acc.risks, ...incoming.risks.filter(r => !seen.has(r.trim()))];
  }
  return merged;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ModeA() {
  // Tab state — persisted across mode switches
  const [openTabs,    setOpenTabs]    = useState<string[]>(loadTabs);
  const [activeTab,   setActiveTab]   = useState<string>(loadActive); // ticker or 'new'

  // Per-tab analysis data (loaded from localStorage on first access)
  const [tabData,      setTabData]      = useState<Record<string, Partial<AnalysisResult>>>(() => {
    const initial: Record<string, Partial<AnalysisResult>> = {};
    for (const t of loadTabs()) {
      const d = loadData(t);
      if (d) initial[t] = d;
    }
    return initial;
  });
  const [analyzing,   setAnalyzing]   = useState<Record<string, boolean>>({});
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentEvent | null>>({});

  // New-search form
  const [inputValue,  setInputValue]  = useState('');
  const [error,       setError]       = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist tab metadata
  useEffect(() => { localStorage.setItem(LS_TABS,   JSON.stringify(openTabs)); }, [openTabs]);
  useEffect(() => { localStorage.setItem(LS_ACTIVE, activeTab); }, [activeTab]);

  // Auto-focus input when 'new' tab is active
  useEffect(() => {
    if (activeTab === 'new') setTimeout(() => inputRef.current?.focus(), 60);
  }, [activeTab]);

  // ── Analysis ────────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async (ticker: string) => {
    // Ensure tab exists
    setOpenTabs(prev => prev.includes(ticker) ? prev : [...prev, ticker]);
    setActiveTab(ticker);
    setAnalyzing(prev => ({ ...prev, [ticker]: true }));
    setTabData(prev => { const n = { ...prev }; delete n[ticker]; return n; }); // clear stale

    let partial: Partial<AnalysisResult> = {};
    try {
      const final = await runMasterAnalysis(
        { ticker, options: ['highlights', 'risks', 'esg', 'competitors'] },
        (evt: AgentEvent) => {
          setAgentStatus(prev => ({ ...prev, [ticker]: evt }));
          if (evt.partial) {
            partial = mergePartial(partial, evt.partial);
            setTabData(prev => ({ ...prev, [ticker]: partial }));
          }
        }
      );
      setTabData(prev => ({ ...prev, [ticker]: final }));
      saveData(ticker, final);
    } catch (err: any) {
      setError(err.message || 'Analysis failed.');
    } finally {
      setAnalyzing(prev => ({ ...prev, [ticker]: false }));
      setAgentStatus(prev => ({ ...prev, [ticker]: null }));
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = inputValue.trim().toUpperCase();
    if (!t) return;
    if (/\s/.test(t) || t.length > 20) {
      setError('Please enter a valid ticker symbol (e.g. AAPL, 1810.HK, TSLA)');
      return;
    }
    setError(null);
    setInputValue('');
    runAnalysis(t);
  };

  const closeTab = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== ticker);
      // If closing the active tab, switch to the previous one or 'new'
      if (activeTab === ticker) {
        const idx = prev.indexOf(ticker);
        const fallback = next[idx - 1] ?? next[0] ?? 'new';
        setActiveTab(fallback);
      }
      return next;
    });
    deleteData(ticker);
    setTabData(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const isActiveAnalyzing = activeTab !== 'new' && !!analyzing[activeTab];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-10 border-b border-slate-800/60 bg-[#080a0f]/80 overflow-x-auto">

        {/* Open ticker tabs */}
        {openTabs.map(ticker => {
          const isActive = activeTab === ticker;
          const isRunning = !!analyzing[ticker];
          return (
            <div key={ticker} className="shrink-0 flex items-center">
              <button
                onClick={() => { setActiveTab(ticker); setError(null); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold font-mono transition-colors ${
                  isActive ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                {ticker}
              </button>
              <button
                onClick={e => closeTab(ticker, e)}
                className={`ml-0.5 p-0.5 rounded transition-colors ${
                  isActive ? 'text-blue-400/60 hover:text-rose-400' : 'text-transparent pointer-events-none'
                }`}
                tabIndex={isActive ? 0 : -1}
                aria-label={`Close ${ticker}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* New analysis button */}
        <button
          onClick={() => { setActiveTab('new'); setError(null); }}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
            activeTab === 'new' ? 'bg-slate-700/50 text-slate-300' : 'text-slate-600 hover:text-slate-400'
          }`}
          title="New analysis"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <AnimatePresence mode="sync">
        {activeTab === 'new' ? (
          /* Search form */
          <motion.div
            key="new"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto"
          >
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold mb-4 uppercase tracking-widest">
                <Zap className="w-3 h-3" /> Market Analysis
              </div>
              <h2 className="text-3xl font-bold text-white mb-3">Ticker Analysis</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                Enter a stock ticker. QuantAgent fetches live market data and full valuation models.
                PeerAgent identifies direct competitors. CIOAgent synthesises the final verdict.
                <br /><span className="text-blue-400/70">Results stream in as each agent finishes. Each analysis is bookmarked.</span>
              </p>
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              onSubmit={handleSubmit}
              className="w-full max-w-md"
            >
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => { setInputValue(e.target.value); setError(null); }}
                    placeholder="e.g. AAPL, 1810.HK, TSLA, BABA"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputValue.trim()}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] text-sm"
                >
                  Analyze
                </button>
              </div>
              {error && <p className="mt-3 text-rose-400 text-sm">{error}</p>}
            </motion.form>

            {/* Recent tabs as quick-access chips */}
            {openTabs.length > 0 && (
              <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Recent:</span>
                {openTabs.map(t => (
                  <button key={t} onClick={() => setActiveTab(t)}
                    className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono font-bold text-slate-400 hover:text-white hover:border-blue-500/30 transition-colors">
                    {t}
                  </button>
                ))}
              </div>
            )}

            {!openTabs.length && (
              <div className="mt-16 flex items-center gap-2 text-[11px] text-slate-700">
                {['QuantAgent', '∥', 'PeerAgent', '→', 'CIOAgent'].map((item, i) => (
                  <span key={i} className={item === '∥' || item === '→'
                    ? 'text-slate-700 font-bold'
                    : 'px-2.5 py-1 bg-slate-900/80 border border-slate-800 rounded-lg text-slate-500'}>
                    {item}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          /* Analysis dashboard for active ticker */
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Agent status bar while running */}
            {isActiveAnalyzing && agentStatus[activeTab] && (
              <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 bg-blue-950/30 border-b border-blue-500/20">
                <Bot className="w-4 h-4 text-blue-400 shrink-0 animate-pulse" />
                <div className="min-w-0">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mr-2">
                    {agentStatus[activeTab]?.agent}
                  </span>
                  <span className="text-xs text-slate-300 truncate">{agentStatus[activeTab]?.status}</span>
                </div>
                <button
                  onClick={() => { setActiveTab('new'); setError(null); }}
                  className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                >
                  New search
                </button>
              </div>
            )}

            {/* Quick re-search bar when analysis is done */}
            {!isActiveAnalyzing && (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-800/40 bg-[#080a0f]/60">
                <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                    <input
                      value={inputValue}
                      onChange={e => { setInputValue(e.target.value); setError(null); }}
                      placeholder="Analyze another ticker…"
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:border-blue-500/40 focus:outline-none transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!inputValue.trim()}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Analyze
                  </button>
                </form>
                <button
                  onClick={() => runAnalysis(activeTab)}
                  className="text-[11px] text-slate-500 hover:text-blue-400 transition-colors ml-2 shrink-0"
                >
                  Re-run {activeTab}
                </button>
                {error && <span className="text-[10px] text-rose-400 ml-2">{error}</span>}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {tabData[activeTab]?.company ? (
                <AnalysisDashboard
                  data={tabData[activeTab]}
                  isLoading={isActiveAnalyzing}
                  onReset={() => runAnalysis(activeTab)}
                  onError={msg => setError(msg)}
                />
              ) : isActiveAnalyzing ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-slate-400">Initialising agents for <span className="font-mono text-white">{activeTab}</span>…</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <button onClick={() => runAnalysis(activeTab)} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors">
                    <Zap className="w-4 h-4" /> Run Analysis for {activeTab}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
