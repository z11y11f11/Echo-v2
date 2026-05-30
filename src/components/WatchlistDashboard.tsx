import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Plus, X, RefreshCw, LayoutDashboard, TrendingUp, TrendingDown,
  Minus, Loader2, Check, ChevronRight, Clock, Bot,
  BarChart3, Globe, ShieldAlert, Sprout, Users, History, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { runMasterAnalysis } from '../services/ai';
import type { AgentEvent } from '../services/ai';
import AnalysisDashboard from './AnalysisDashboard';
import StakeholderModal from './StakeholderModal';
import type { AnalysisResult, InvestmentSignal } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchlistItem {
  ticker: string;
  addedAt: string;
}

interface CachedAnalysis {
  data: Partial<AnalysisResult>;
  analyzedAt: string; // ISO
}

type ModuleKey = 'metrics' | 'webIntel' | 'compliance' | 'esg' | 'competitors' | 'signalHistory' | 'stakeholder';

const MODULE_META: Record<ModuleKey, { label: string; icon: React.ReactNode; description: string }> = {
  metrics:       { label: 'Financial Analysis',     icon: <BarChart3 className="w-3.5 h-3.5" />,   description: 'KPIs, valuation models, summary' },
  webIntel:      { label: 'Live Web Intelligence',  icon: <Globe className="w-3.5 h-3.5" />,        description: 'News, hiring, competitive signals' },
  compliance:    { label: 'Compliance Alerts',      icon: <ShieldAlert className="w-3.5 h-3.5" />,  description: 'Regulatory, legal, ESG compliance' },
  esg:           { label: 'ESG Profile',            icon: <Sprout className="w-3.5 h-3.5" />,       description: 'Environmental, Social, Governance' },
  competitors:   { label: 'Peer Comparison',        icon: <Users className="w-3.5 h-3.5" />,        description: 'Sector peers KPI comparison' },
  signalHistory: { label: 'Signal History',         icon: <History className="w-3.5 h-3.5" />,      description: 'Past BUY/HOLD/SELL signals' },
  stakeholder:   { label: 'Stakeholder Analysis',   icon: <Activity className="w-3.5 h-3.5" />,     description: 'Supply chain & management (on demand)' },
};

const ALL_MODULE_KEYS: ModuleKey[] = ['metrics', 'webIntel', 'compliance', 'esg', 'competitors', 'signalHistory', 'stakeholder'];

const STORAGE_KEY_WATCHLIST = 'echo_watchlist_v1';
const STORAGE_KEY_MODULES   = 'echo_modules_v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadWatchlist(): WatchlistItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_WATCHLIST) || '[]'); } catch { return []; }
}
function saveWatchlist(items: WatchlistItem[]) {
  localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(items));
}
function loadEnabledModules(): Set<ModuleKey> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_MODULES) || 'null');
    if (Array.isArray(raw)) return new Set(raw as ModuleKey[]);
  } catch {}
  // default: all except stakeholder enabled
  return new Set<ModuleKey>(['metrics', 'webIntel', 'compliance', 'esg', 'competitors', 'signalHistory']);
}
function saveEnabledModules(mods: Set<ModuleKey>) {
  localStorage.setItem(STORAGE_KEY_MODULES, JSON.stringify([...mods]));
}

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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function verdictColor(v?: string) {
  if (v === 'BUY')  return { badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' };
  if (v === 'SELL') return { badge: 'bg-rose-950/60 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400' };
  return             { badge: 'bg-amber-950/60 text-amber-300 border-amber-500/40',              dot: 'bg-amber-400' };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WatchlistDashboard() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(loadWatchlist);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, CachedAnalysis>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey>>(loadEnabledModules);
  const [addInput, setAddInput] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [addError, setAddError] = useState('');
  const [stakeholderTicker, setStakeholderTicker] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Persist watchlist + modules
  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);
  useEffect(() => { saveEnabledModules(enabledModules); }, [enabledModules]);

  // Auto-focus add input
  useEffect(() => { if (showAddInput) setTimeout(() => inputRef.current?.focus(), 60); }, [showAddInput]);

  // ── Analysis ────────────────────────────────────────────────────────────────

  const analyze = useCallback(async (ticker: string) => {
    if (analyzing[ticker]) return;
    setAnalyzing(prev => ({ ...prev, [ticker]: true }));
    setAgentStatus('Initializing...');

    // Clear stale cache for this ticker so sections update
    setCache(prev => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });

    let partial: Partial<AnalysisResult> = {};
    try {
      const final = await runMasterAnalysis(
        { ticker, options: ['highlights', 'risks', 'esg', 'competitors'] },
        (evt: AgentEvent) => {
          setAgentStatus(`${evt.agent}: ${evt.status}`);
          if (evt.partial) {
            partial = mergePartial(partial, evt.partial);
            setCache(prev => ({
              ...prev,
              [ticker]: { data: partial, analyzedAt: new Date().toISOString() }
            }));
          }
        }
      );
      setCache(prev => ({
        ...prev,
        [ticker]: { data: final, analyzedAt: new Date().toISOString() }
      }));
    } catch (e: any) {
      setAgentStatus(`Failed: ${e.message}`);
    } finally {
      setAnalyzing(prev => ({ ...prev, [ticker]: false }));
      setAgentStatus('');
    }
  }, [analyzing]);

  // Auto-analyze when ticker selected and not yet in cache
  useEffect(() => {
    if (activeTicker && !cache[activeTicker] && !analyzing[activeTicker]) {
      analyze(activeTicker);
    }
  }, [activeTicker]);

  // ── Watchlist management ─────────────────────────────────────────────────────

  const addTicker = () => {
    const t = addInput.trim().toUpperCase();
    if (!t) return;
    if (/\s/.test(t) || t.length > 20) { setAddError('Invalid ticker format'); return; }
    if (watchlist.some(w => w.ticker === t)) { setAddError('Already in watchlist'); return; }
    const next = [...watchlist, { ticker: t, addedAt: new Date().toISOString() }];
    setWatchlist(next);
    setActiveTicker(t);
    setAddInput('');
    setAddError('');
    setShowAddInput(false);
  };

  const removeTicker = (ticker: string) => {
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker));
    if (activeTicker === ticker) setActiveTicker(watchlist.find(w => w.ticker !== ticker)?.ticker ?? null);
    setCache(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  // ── Module toggles ───────────────────────────────────────────────────────────

  const toggleModule = (key: ModuleKey) => {
    setEnabledModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Build sectionOverrides for AnalysisDashboard from enabled modules
  const sectionOverrides: Record<string, boolean> = {
    metrics:      enabledModules.has('metrics'),
    valuation:    enabledModules.has('metrics'),
    summary:      enabledModules.has('metrics'),
    insights:     enabledModules.has('metrics'),
    history:      enabledModules.has('metrics'),
    webIntel:     enabledModules.has('webIntel'),
    compliance:   enabledModules.has('compliance'),
    esg:          enabledModules.has('esg'),
    competitors:  enabledModules.has('competitors'),
    signalHistory:enabledModules.has('signalHistory'),
    stakeholder:  enabledModules.has('stakeholder'),
  };

  const activeCache = activeTicker ? cache[activeTicker] : null;
  const isActive    = activeTicker ? !!analyzing[activeTicker] : false;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r border-slate-800/60 bg-[#080a0f] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800/60">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            <LayoutDashboard className="w-3.5 h-3.5 text-blue-400" />
            Watchlist
          </div>

          {/* Watchlist items */}
          <div className="space-y-1">
            {watchlist.length === 0 && (
              <p className="text-xs text-slate-600 italic px-1">No tickers yet</p>
            )}
            {watchlist.map(item => {
              const signal = cache[item.ticker]?.data?.investmentSignal;
              const isRunning = !!analyzing[item.ticker];
              const isSelected = activeTicker === item.ticker;
              const vc = verdictColor(signal?.verdict);

              return (
                <div
                  key={item.ticker}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-500/10 border border-blue-500/20 text-white'
                      : 'hover:bg-slate-800/50 text-slate-300 border border-transparent'
                  }`}
                  onClick={() => setActiveTicker(item.ticker)}
                >
                  {/* Verdict dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    isRunning ? 'bg-blue-400 animate-pulse' : (signal ? vc.dot : 'bg-slate-600')
                  }`} />

                  <span className="flex-1 text-sm font-bold font-mono truncate">{item.ticker}</span>

                  {/* Verdict badge */}
                  {signal && !isRunning && (
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${vc.badge}`}>
                      {signal.verdict}
                    </span>
                  )}
                  {isRunning && <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}

                  {/* Remove button */}
                  <button
                    onClick={e => { e.stopPropagation(); removeTicker(item.ticker); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-rose-400 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add ticker */}
          {showAddInput ? (
            <div className="mt-3">
              <input
                ref={inputRef}
                value={addInput}
                onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') addTicker(); if (e.key === 'Escape') { setShowAddInput(false); setAddInput(''); setAddError(''); } }}
                placeholder="e.g. AAPL"
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              />
              {addError && <p className="text-[10px] text-rose-400 mt-1 px-1">{addError}</p>}
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={addTicker}
                  className="flex-1 flex items-center justify-center gap-1 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                >
                  <Check className="w-3 h-3" /> Add
                </button>
                <button
                  onClick={() => { setShowAddInput(false); setAddInput(''); setAddError(''); }}
                  className="px-2 py-1 border border-slate-700 text-slate-400 hover:text-white text-[10px] rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddInput(true)}
              className="mt-3 w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> Add ticker
            </button>
          )}
        </div>

        {/* Module toggles */}
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Modules</div>
          <div className="space-y-1">
            {ALL_MODULE_KEYS.map(key => {
              const meta = MODULE_META[key];
              const enabled = enabledModules.has(key);
              const isSpecial = key === 'stakeholder';
              return (
                <button
                  key={key}
                  onClick={() => toggleModule(key)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors group ${
                    enabled
                      ? 'text-slate-300 hover:bg-slate-800/40'
                      : 'text-slate-600 hover:text-slate-400'
                  }`}
                  title={meta.description}
                >
                  <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${
                    enabled ? 'bg-blue-600 border-blue-500' : 'border-slate-700'
                  }`}>
                    {enabled && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] font-medium truncate">
                    {meta.icon}
                    {meta.label}
                    {isSpecial && <span className="text-[9px] text-slate-600 font-normal shrink-0">on demand</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="shrink-0 h-12 border-b border-slate-800/60 bg-[#080a0f]/60 backdrop-blur-sm flex items-center px-4 gap-3">
          {activeTicker ? (
            <>
              <span className="text-sm font-bold font-mono text-white">{activeTicker}</span>
              {activeCache?.data?.company?.name && (
                <span className="text-xs text-slate-500 truncate max-w-[200px]">{activeCache.data.company.name}</span>
              )}
              {isActive && (
                <span className="flex items-center gap-1.5 text-[10px] text-blue-400 font-bold ml-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {agentStatus || 'Running agents…'}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {activeCache && (
                  <span className="text-[10px] text-slate-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Updated {relativeTime(activeCache.analyzedAt)}
                  </span>
                )}
                <button
                  onClick={() => activeTicker && analyze(activeTicker)}
                  disabled={isActive}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-bold text-slate-300 hover:text-white hover:border-blue-500/50 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${isActive ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                {enabledModules.has('stakeholder') && activeCache?.data?.company?.ticker && (
                  <button
                    onClick={() => setStakeholderTicker(activeCache.data.company!.ticker)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-700/50 bg-cyan-950/20 text-xs font-bold text-cyan-300 hover:bg-cyan-900/30 transition-colors"
                  >
                    <Activity className="w-3 h-3" /> Stakeholder
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-slate-600 italic">Select a ticker from the watchlist</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {!activeTicker ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-center gap-4"
              >
                <LayoutDashboard className="w-12 h-12 text-slate-800" />
                <div>
                  <p className="text-slate-500 font-medium">Your watchlist is empty</p>
                  <p className="text-slate-600 text-sm mt-1">Add a ticker to start monitoring</p>
                </div>
                <button
                  onClick={() => setShowAddInput(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add your first ticker
                </button>
              </motion.div>
            ) : isActive && !activeCache ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center gap-4 pt-20"
              >
                <div className="flex items-center gap-3 bg-slate-900/80 border border-blue-500/20 rounded-xl px-6 py-4">
                  <Bot className="w-5 h-5 text-blue-400 animate-pulse" />
                  <div>
                    <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Multi-Agent Analysis</div>
                    <div className="text-sm text-slate-200 mt-0.5">{agentStatus || 'Starting agents…'}</div>
                  </div>
                </div>
              </motion.div>
            ) : activeCache ? (
              <motion.div
                key={activeTicker}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <AnalysisDashboard
                  data={activeCache.data}
                  isLoading={isActive}
                  onReset={() => analyze(activeTicker)}
                  sectionOverrides={sectionOverrides}
                  hideToolbar={false}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Stakeholder modal (on-demand) */}
      {stakeholderTicker && (
        <StakeholderModal
          ticker={stakeholderTicker}
          onClose={() => setStakeholderTicker(null)}
          onComplete={(output) => {
            if (activeTicker) {
              setCache(prev => ({
                ...prev,
                [activeTicker]: {
                  ...prev[activeTicker],
                  data: { ...(prev[activeTicker]?.data ?? {}), stakeholder: output },
                  analyzedAt: prev[activeTicker]?.analyzedAt ?? new Date().toISOString()
                }
              }));
            }
            setStakeholderTicker(null);
          }}
        />
      )}
    </div>
  );
}
