import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface SignalRecord {
  verdict: 'BUY' | 'HOLD' | 'SELL';
  confidence: 'high' | 'medium' | 'low';
  key_reasons: string[];
  risk_warnings: string[];
  generated_at: string;
  created_at: string;
}

interface SignalTimelineProps {
  ticker: string;
}

export default function SignalTimeline({ ticker }: SignalTimelineProps) {
  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!ticker) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`/api/log/history/${encodeURIComponent(ticker)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: SignalRecord[]) => { setRecords(data); setLoading(false); })
      .catch(() => { setError('Failed to load signal history'); setLoading(false); });
  }, [ticker]);

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-slate-800/60 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-rose-400 text-sm italic p-2">{error}</p>;
  }

  if (records.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500 text-sm italic">No signal history yet for {ticker}.</p>
        <p className="text-slate-600 text-xs mt-1">Signals are saved automatically after each analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {records.map((rec, i) => {
        const isOpen = expandedIdx === i;
        const date = rec.created_at
          ? new Date(rec.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : rec.generated_at?.slice(0, 10) ?? '—';

        const verdictStyle = {
          BUY:  { badge: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' },
          SELL: { badge: 'bg-rose-950/50 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400' },
          HOLD: { badge: 'bg-amber-950/50 text-amber-300 border-amber-500/40',        dot: 'bg-amber-400' },
        }[rec.verdict];

        const confStyle = {
          high:   'text-emerald-400',
          medium: 'text-amber-400',
          low:    'text-slate-400',
        }[rec.confidence];

        return (
          <div key={i} className="rounded-xl border border-slate-800 bg-[#0a0d14]/80 overflow-hidden">
            {/* Row header */}
            <button
              onClick={() => setExpandedIdx(isOpen ? null : i)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${verdictStyle.dot}`} />
              <span className="text-xs text-slate-500 font-mono w-36 shrink-0">{date}</span>
              <span className={`px-2 py-0.5 rounded border text-[11px] font-black uppercase tracking-widest ${verdictStyle.badge}`}>
                {rec.verdict}
              </span>
              <span className={`text-[11px] font-bold uppercase tracking-widest ml-1 ${confStyle}`}>
                {rec.confidence}
              </span>
              <span className="ml-auto text-slate-600">
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="px-5 pb-4 pt-1 border-t border-slate-800/60 space-y-3">
                {rec.key_reasons.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Key Reasons
                    </div>
                    <ul className="space-y-1">
                      {rec.key_reasons.map((r, j) => (
                        <li key={j} className="text-xs text-slate-300 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />{r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {rec.risk_warnings.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-500" /> Risk Warnings
                    </div>
                    <ul className="space-y-1">
                      {rec.risk_warnings.map((w, j) => (
                        <li key={j} className="text-xs text-slate-400 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />{w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
