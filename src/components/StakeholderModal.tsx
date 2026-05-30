/**
 * StakeholderModal — one-page browse view.
 *
 * Displays for the given ticker:
 *   · Company intro
 *   · Top revenue segments / industries (max 5)
 *   · Top 5 upstream suppliers
 *   · Top 5 downstream customers
 *   · Top 5 peer competitors
 *
 * Every entity row is clickable: clicking calls `onSelectEntity(ticker)` which
 * the parent uses to open that ticker as a monitor tab — no further analysis
 * step is required.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Loader2, ChevronRight, Factory, Truck, Users,
  Building2, AlertCircle, ExternalLink
} from 'lucide-react';
import { StakeholderAgent } from '../agents/StakeholderAgent';
import type { IndustryRevenue, StakeholderEntity } from '../types';

interface StakeholderModalProps {
  ticker: string;
  onClose: () => void;
  /** Called when user clicks any entity row — receives the entity's ticker. */
  onSelectEntity?: (ticker: string, name: string) => void;
}

export default function StakeholderModal({ ticker, onClose, onSelectEntity }: StakeholderModalProps) {
  const [companyIntro, setCompanyIntro]   = useState('');
  const [topIndustries, setTopIndustries] = useState<IndustryRevenue[]>([]);
  const [candidates, setCandidates]       = useState<StakeholderEntity[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusMsg, setStatusMsg] = useState('Initialising…');
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    StakeholderAgent.getBrowseData(ticker, (evt) => {
      if (!active) return;
      setStatusMsg(evt.status);
    })
      .then(data => {
        if (!active) return;
        setCompanyIntro(data.companyIntro);
        setTopIndustries(data.topIndustries);
        setCandidates(data.candidates);
      })
      .catch(err => active && setError(err.message || 'Failed to load stakeholder data.'))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [ticker]);

  const upstream   = candidates.filter(e => e.type === 'upstream').slice(0, 5);
  const downstream = candidates.filter(e => e.type === 'downstream').slice(0, 5);
  const peers      = candidates.filter(e => e.type === 'peer').slice(0, 5);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-800 bg-[#080a0f] shadow-2xl flex flex-col"
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 border-b border-slate-800 bg-[#080a0f] px-6 py-4 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Stakeholder Browse</div>
                <h2 className="mt-1 text-xl font-bold text-white font-mono">{ticker}</h2>
              </div>
              <button onClick={onClose} className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">

            {error && (
              <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-3 text-sm text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {loading && !companyIntro ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400 shrink-0" />
                <span className="truncate">{statusMsg}</span>
              </div>
            ) : (
              <>
                {/* Company intro */}
                {companyIntro && (
                  <section className="rounded-xl border border-slate-800 bg-cyan-950/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Company Overview</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{companyIntro}</p>
                  </section>
                )}

                {/* Top revenue segments */}
                {topIndustries.length > 0 && (
                  <section>
                    <SectionHeader
                      icon={<Factory className="w-3.5 h-3.5" />}
                      label="Top Revenue Segments"
                      hint="Largest product/business lines by revenue share"
                    />
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
                      {topIndustries.slice(0, 5).map((seg, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/70 last:border-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-[10px] font-bold text-slate-600 font-mono w-4">{i + 1}</span>
                            <span className="text-sm text-slate-200 truncate">{seg.industry}</span>
                          </div>
                          <div className="flex items-baseline gap-2 shrink-0">
                            <span className="text-sm font-bold text-cyan-300 font-mono">{seg.revenue_share_pct}%</span>
                            <span className="text-[10px] text-slate-500 font-mono">{seg.period}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Upstream suppliers */}
                <EntitySection
                  icon={<Truck className="w-3.5 h-3.5" />}
                  label="Top Upstream Suppliers"
                  hint="Key vendors supplying to the company"
                  entities={upstream}
                  onSelectEntity={onSelectEntity}
                  onClose={onClose}
                />

                {/* Downstream customers */}
                <EntitySection
                  icon={<Users className="w-3.5 h-3.5" />}
                  label="Top Downstream Customers"
                  hint="Major buyers / distribution channels"
                  entities={downstream}
                  onSelectEntity={onSelectEntity}
                  onClose={onClose}
                />

                {/* Peer competitors */}
                <EntitySection
                  icon={<Users className="w-3.5 h-3.5" />}
                  label="Top Peer Competitors"
                  hint="Sector peers — click to monitor"
                  entities={peers}
                  onSelectEntity={onSelectEntity}
                  onClose={onClose}
                />

                {/* Status banner while still loading additional data */}
                {loading && (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 italic">
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                    {statusMsg}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div className="border-t border-slate-800 px-6 py-3 shrink-0 bg-[#080a0f] flex items-center justify-between gap-3">
            <span className="text-[10px] text-slate-600">
              Click any entity to open its monitor tab
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 px-1">
      <span className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
        {icon}{label}
      </span>
      {hint && <span className="text-[10px] text-slate-600">· {hint}</span>}
    </div>
  );
}

function EntitySection({ icon, label, hint, entities, onSelectEntity, onClose }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  entities: StakeholderEntity[];
  onSelectEntity?: (ticker: string, name: string) => void;
  onClose: () => void;
}) {
  return (
    <section>
      <SectionHeader icon={icon} label={label} hint={hint} />
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
        {entities.length === 0 ? (
          <p className="text-xs text-slate-600 italic px-4 py-4 text-center">No data available</p>
        ) : (
          entities.map((entity, i) => (
            <EntityRow
              key={`${entity.type}-${entity.name}-${i}`}
              index={i + 1}
              entity={entity}
              onSelectEntity={onSelectEntity}
              onClose={onClose}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EntityRow({ index, entity, onSelectEntity, onClose }: {
  index: number;
  entity: StakeholderEntity;
  onSelectEntity?: (ticker: string, name: string) => void;
  onClose: () => void;
}) {
  const clickable = !!(entity.ticker && entity.ticker !== 'N/A' && onSelectEntity);
  const hasMcap   = entity.sort_value && entity.sort_value !== 'no_public_data';

  const handleClick = () => {
    if (!clickable || !entity.ticker) return;
    onSelectEntity?.(entity.ticker, entity.name);
    onClose();
  };

  const desc = entity.description && entity.description !== 'no_public_data'
    ? entity.description
    : null;

  return (
    <button
      onClick={handleClick}
      disabled={!clickable}
      className={`w-full flex items-start gap-3 px-4 py-3 border-b border-slate-800/70 last:border-0 text-left transition-colors ${
        clickable
          ? 'hover:bg-cyan-950/15 cursor-pointer group'
          : 'cursor-default opacity-70'
      }`}
    >
      <span className="text-[10px] font-bold text-slate-600 font-mono w-4 shrink-0 mt-0.5">{index}</span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-white truncate">{entity.name}</span>
          {entity.ticker && entity.ticker !== 'N/A' && (
            <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono font-bold text-cyan-300">
              {entity.ticker}
            </span>
          )}
          {entity.exchange && (
            <span className="text-[10px] text-slate-600 font-mono">{entity.exchange}</span>
          )}
        </div>
        {desc && (
          <p className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{desc}</p>
        )}
        {!desc && entity.industry && (
          <p className="text-[10px] text-slate-600 mt-0.5 uppercase tracking-widest">{entity.industry}</p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        {hasMcap && (
          <span className="text-[11px] font-bold text-cyan-300 font-mono whitespace-nowrap">{entity.sort_value}</span>
        )}
        {clickable && (
          <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
        )}
        {!clickable && !hasMcap && (
          <span className="text-[10px] text-slate-600 italic">No public ticker</span>
        )}
      </div>
    </button>
  );
}
