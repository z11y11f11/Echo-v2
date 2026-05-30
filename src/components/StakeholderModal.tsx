import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Loader2, X } from 'lucide-react';
import { StakeholderAgent } from '../agents/StakeholderAgent';
import type { IndustryRevenue, StakeholderEntity, StakeholderOutput } from '../types';

interface StakeholderModalProps {
  ticker: string;
  onClose: () => void;
  onComplete: (output: StakeholderOutput) => void;
}

type Step = 1 | 2 | 3;
type SelectionMode = 'specific' | 'comprehensive';

export default function StakeholderModal({ ticker, onClose, onComplete }: StakeholderModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [industries, setIndustries] = useState<IndustryRevenue[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('specific');
  const [candidates, setCandidates] = useState<StakeholderEntity[]>([]);
  const [candidateGroups, setCandidateGroups] = useState<Array<{ industry: string; entities: StakeholderEntity[] }>>([]);
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    StakeholderAgent.getTopIndustries(ticker)
      .then(result => {
        if (!active) return;
        setIndustries(result);
        setSelectedIndustries(result[0]?.industry ? [result[0].industry] : []);
      })
      .catch(err => active && setError(err.message || 'Failed to load industries.'))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [ticker]);

  const effectiveIndustries = selectionMode === 'comprehensive'
    ? industries.map(item => item.industry)
    : selectedIndustries;

  const dedupedCandidates = useMemo(() => dedupeCandidates(candidates), [candidates]);
  const visibleCandidateGroups = useMemo(() => (
    candidateGroups.map(group => ({
      industry: group.industry,
      entities: dedupeCandidates(group.entities)
    }))
  ), [candidateGroups]);

  const toggleIndustry = (industry: string) => {
    setSelectionMode('specific');
    setSelectedIndustries(prev => (
      prev.includes(industry)
        ? prev.filter(item => item !== industry)
        : [...prev, industry]
    ));
  };

  const toggleEntity = (key: string) => {
    setSelectedEntities(prev => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
  };

  const loadCandidates = async () => {
    if (effectiveIndustries.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const perIndustryGroups = await Promise.all(
        effectiveIndustries.map(async industry => ({
          industry,
          entities: await StakeholderAgent.getCandidates(ticker, [industry], 'specific' as SelectionMode)
        }))
      );
      const flattened = perIndustryGroups.flatMap(group => group.entities);
      setCandidateGroups(perIndustryGroups);
      setCandidates(dedupeCandidates(flattened));
      setSelectedEntities([]);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to load stakeholder candidates.');
    } finally {
      setLoading(false);
    }
  };

  const runFinalAnalysis = async () => {
    if (selectedEntities.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const output = await StakeholderAgent.runSelectedAnalysis({
        ticker,
        topIndustries: industries,
        selectedIndustries: effectiveIndustries,
        selectionMode,
        candidates,
        selectedEntityNames: selectedEntities.map(key => key.split('|').pop() || key),
        selectedEntityKeys: selectedEntities,
      });
      onComplete(output);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Stakeholder analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          className="w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-2xl border border-slate-800 bg-[#080a0f] shadow-2xl"
        >
          <div className="sticky top-0 z-10 border-b border-slate-800 bg-[#080a0f] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Stakeholder Analysis</div>
                <h2 className="mt-1 text-xl font-bold text-white">{ticker}</h2>
              </div>
              <button onClick={onClose} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 transition-colors hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[1, 2, 3].map(item => (
                <div key={item} className={`rounded-lg border px-3 py-2 text-center text-xs font-bold uppercase tracking-widest ${
                  step === item
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-slate-800 bg-slate-950/70 text-slate-500'
                }`}>
                  Step {item}
                </div>
              ))}
            </div>
          </div>

          <div className="max-h-[58vh] overflow-y-auto p-5">
            {error && (
              <div className="mb-4 rounded-xl border border-rose-900/50 bg-rose-950/20 p-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            {step === 1 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Step 1 — Industry Selection</h3>
                    <p className="mt-1 text-xs text-slate-500">Select one or more industries, or use comprehensive mode.</p>
                  </div>
                  <button
                    onClick={() => setSelectionMode('comprehensive')}
                    className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                      selectionMode === 'comprehensive'
                        ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    Comprehensive
                  </button>
                </div>

                {loading ? (
                  <LoadingState label="Loading top industries..." />
                ) : (
                  <div className="space-y-2">
                    {industries.map(industry => (
                      <label key={industry.industry} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition-colors hover:border-slate-700">
                        <input
                          type="checkbox"
                          checked={selectionMode === 'specific' && selectedIndustries.includes(industry.industry)}
                          onChange={() => toggleIndustry(industry.industry)}
                          className="h-4 w-4 accent-cyan-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-white">{industry.industry}</div>
                          <div className="mt-1 text-xs text-slate-500">{industry.period}</div>
                        </div>
                        <div className="font-mono text-sm font-bold text-cyan-300">{industry.revenue_share_pct}%</div>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}

            {step === 2 && (
              <section className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white">Step 2 — Candidate List</h3>
                  <p className="mt-1 text-xs text-slate-500">Grouped by selected industry. Upstream/Downstream for supply chain understanding, Peers for comparison.</p>
                </div>
                {visibleCandidateGroups.map(group => (
                  <IndustryCandidateGroup key={group.industry} industry={group.industry} entities={group.entities} />
                ))}
              </section>
            )}

            {step === 3 && (
              <section className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white">Step 3 — Final Selection</h3>
                  <p className="mt-1 text-xs text-slate-500">Select at least 1 entity. Peers will be compared by KPI; Upstream/Downstream for supply chain analysis.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {dedupedCandidates.map(entity => {
                    const key = entityKey(entity);
                    return (
                    <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition-colors hover:border-slate-700" title={entity.description}>
                      <input
                        type="checkbox"
                        checked={selectedEntities.includes(key)}
                        onChange={() => toggleEntity(key)}
                        className="mt-1 h-4 w-4 accent-cyan-500"
                      />
                      <EntitySummary entity={entity} />
                    </label>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-[#080a0f] p-5">
            <button
              onClick={() => setStep(prev => Math.max(1, prev - 1) as Step)}
              disabled={step === 1 || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="text-xs text-slate-500">
              {loading ? 'Running StakeholderAgent...' : `${selectedEntities.length} selected`}
            </div>
            {step === 1 && (
              <button
                onClick={loadCandidates}
                disabled={loading || effectiveIndustries.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Next
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={loading || dedupedCandidates.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowRight className="h-4 w-4" /> Next
              </button>
            )}
            {step === 3 && (
              <button
                onClick={runFinalAnalysis}
                disabled={loading || selectedEntities.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const IndustryCandidateGroup: React.FC<{ industry: string; entities: StakeholderEntity[] }> = ({ industry, entities }) => {
  const upstream = entities.filter(item => item.type === 'upstream').slice(0, 3);
  const downstream = entities.filter(item => item.type === 'downstream').slice(0, 3);
  const peers = entities.filter(item => item.type === 'peer').slice(0, 3);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-white">{industry}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{entities.length} candidates</div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CandidateColumn title="Upstream · understand" items={upstream} />
        <CandidateColumn title="Downstream · understand" items={downstream} />
        <CandidateColumn title="Peers · compare" items={peers} />
      </div>
    </div>
  );
};

function CandidateColumn({ title, items }: { title: string; items: StakeholderEntity[] }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400">{title}</div>
      <div className="space-y-2">
        {items.map(entity => (
          <div key={entityKey(entity)} title={entity.description} className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#080a0f] px-3 py-2">
            <span className="truncate text-xs font-bold text-slate-200">{entity.name}</span>
            {entity.sort_value === 'no_public_data' && (
              <span title="No public data available" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-700/50 bg-amber-950/30 text-amber-300">
                <CircleHelp className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-[#080a0f] px-3 py-2 text-xs italic text-slate-600">
            Empty
          </div>
        )}
      </div>
    </div>
  );
}

function entityKey(entity: StakeholderEntity): string {
  return `${entity.type}|${entity.industry}|${entity.name}`;
}

function dedupeCandidates(items: StakeholderEntity[]): StakeholderEntity[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = entityKey(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function EntitySummary({ entity }: { entity: StakeholderEntity }) {
  const noPublicData = entity.sort_value === 'no_public_data';
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <div className="truncate text-sm font-bold text-white">{entity.name}</div>
        {noPublicData && (
          <span title="No public data available" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-700/50 bg-amber-950/30 text-amber-300">
            <CircleHelp className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {entity.type} · {entity.industry}
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
      {label}
    </div>
  );
}
