import React, { useState } from 'react';
import { Shield, BarChart3, FileSearch, MessageSquare, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ModeA from './components/ModeA';
import ModeB from './components/ModeB';
import ModeC from './components/ModeC';
import WatchlistDashboard from './components/WatchlistDashboard';

type Mode = 'D' | 'A' | 'B' | 'C';

const TABS = [
  {
    id: 'D' as Mode,
    label: 'Dashboard',
    sublabel: 'Watchlist & Monitor',
    icon: LayoutDashboard,
    activeClass: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20',
    borderClass: 'border-violet-500 text-violet-400',
  },
  {
    id: 'A' as Mode,
    label: 'Market Analysis',
    sublabel: 'Ticker only',
    icon: BarChart3,
    activeClass: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
    borderClass: 'border-blue-500 text-blue-400',
  },
  {
    id: 'B' as Mode,
    label: 'Report Analysis',
    sublabel: 'PDF + Ticker',
    icon: FileSearch,
    activeClass: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
    borderClass: 'border-emerald-500 text-emerald-400',
  },
  {
    id: 'C' as Mode,
    label: 'AI Dialogue',
    sublabel: 'Chat with Orchestrator',
    icon: MessageSquare,
    activeClass: 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20',
    borderClass: 'border-indigo-500 text-indigo-400',
  },
] as const;

export default function App() {
  const [mode, setMode] = useState<Mode>('D');

  return (
    <div className="flex h-screen w-full bg-[#02040a] text-slate-300 font-sans overflow-hidden">

      {/* ── Sidebar (desktop) ──────────────────────────────────────────── */}
      <aside className="w-64 border-r border-slate-800/50 bg-[#080a0f] hidden lg:flex flex-col shrink-0">
        <div className="p-6">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 flex items-center justify-center p-1.5 bg-blue-600 rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.4)] text-white">
              <Shield className="w-full h-full" />
            </div>
            <div>
              <div className="text-xl font-bold font-display tracking-tight text-white leading-none">Echo</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Financial Intelligence</div>
            </div>
          </div>

          {/* Mode nav */}
          <div className="mb-2 px-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Navigation</div>
          <nav className="space-y-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setMode(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                    isActive ? tab.activeClass : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div>
                    <div className="leading-tight">{tab.label}</div>
                    <div className="text-[10px] opacity-60 font-normal mt-0.5">{tab.sublabel}</div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Orchestrator status */}
        <div className="mt-auto p-4 bg-[#0a0d14] border-t border-slate-800">
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Orchestrator Active</span>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col bg-gradient-to-br from-[#050810] to-[#02040a] overflow-hidden">

        {/* Tab bar */}
        <header className="h-14 border-b border-slate-800/50 bg-black/20 backdrop-blur-md flex items-center px-4 gap-0.5 shrink-0 z-10">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = mode === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold border-b-2 transition-all -mb-px ${
                  isActive ? tab.borderClass : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1"
              title="Reload page"
            >
              🔄 Reset
            </button>
            <div className="w-7 h-7 rounded-full border border-slate-700 bg-slate-800/50 flex items-center justify-center text-[10px] font-bold text-slate-400">
              FA
            </div>
          </div>
        </header>

        {/* Mode content — each tab fully independent, no shared state */}
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {mode === 'D' && <WatchlistDashboard onNavigateToAnalysis={() => setMode('A')} />}
            {mode === 'A' && <ModeA />}
            {mode === 'B' && <ModeB />}
            {mode === 'C' && <ModeC />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
