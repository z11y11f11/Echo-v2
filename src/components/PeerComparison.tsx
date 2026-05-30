import React, { useEffect, useState } from 'react';
import { Target, AlertCircle } from 'lucide-react';
import { ValuationSummary } from '../types';
import { resolveYahooTickersWithAI } from '../services/ai';
import { normalizeYahooTicker } from '../utils/ticker';
import { convertToUSD, formatWithCurrency, formatLargeWithCurrency, getRateDateLabel } from '../utils/currencyConverter';

interface PeerComparisonProps {
  competitors: { name: string; ticker: string; rationale: string }[];
  currentTicker: string;
}

export function PeerComparison({ competitors, currentTicker }: PeerComparisonProps) {
  const [peerData, setPeerData] = useState<Record<string, ValuationSummary & { price?: number; name?: string; role?: string }>>({});
  const [usdRates, setUsdRates] = useState<Record<string, number>>({});
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const fetchPeers = async () => {
      setLoading(true);
      setError('');
      try {
        // Prepare list with current company first
        const allToFetch = [{ name: "Target Company", ticker: currentTicker, rationale: "Analyzed Company", isCurrent: true }];
        competitors.forEach(c => {
           if (c.ticker) allToFetch.push({ ...c, isCurrent: false });
        });

        const newPeerData: Record<string, any> = {};
        const newDisplayOrder: string[] = [];

        await Promise.all(allToFetch.map(async (c) => {
          let tickerToTry = normalizeYahooTicker(c.ticker);
          let success = false;
          let fetchedData = null;

          // Try 1: Direct or normalized ticker
          try {
            const res = await fetch(`/api/stock/${encodeURIComponent(tickerToTry)}/summary`);
            if (res.ok) {
              fetchedData = await res.json();
              success = true;
            }
          } catch (e) {
             console.warn(`Initial fetch failed for ${tickerToTry}`);
          }

          // Try 2: LLM Resolution
          if (!success && !c.isCurrent) {
            try {
              const aiTicker = await resolveYahooTickersWithAI(c.name);
              if (aiTicker && aiTicker !== tickerToTry) {
                 tickerToTry = normalizeYahooTicker(aiTicker);
                 const res2 = await fetch(`/api/stock/${encodeURIComponent(tickerToTry)}/summary`);
                 if (res2.ok) {
                    fetchedData = await res2.json();
                    success = true;
                 }
              }
            } catch (e) {
               console.warn(`AI resolution failed for ${c.name}`);
            }
          }

          if (success && fetchedData) {
              const stats = fetchedData.defaultKeyStatistics || {};
              const financial = fetchedData.financialData || {};
              const detail = fetchedData.summaryDetail || {};
              const price = fetchedData.price?.regularMarketPrice;
              const currency = fetchedData.price?.currency || fetchedData.price?.financialCurrency || '';
              const name = fetchedData.price?.longName || fetchedData.price?.shortName || c.name;
              
              const parsedData = {
                  name,
                  role: c.isCurrent ? 'Analyzed Company' : 'Peer',
                  price,
                  currency,
                  marketCap: fetchedData.price?.marketCap || detail.marketCap,
                  revenueGrowth: financial.revenueGrowth,
                  ebitdaMargins: financial.ebitdaMargins,
                  returnOnEquity: financial.returnOnEquity,
                  debtToEquity: financial.debtToEquity,
                  totalCash: financial.totalCash,
                  totalDebt: financial.totalDebt,
              };

              // Store under original AND resolved ticker to ensure rendering connects
              newPeerData[c.ticker] = parsedData;
              if (tickerToTry !== c.ticker) {
                  newPeerData[tickerToTry] = parsedData;
              }
              newDisplayOrder.push(c.ticker);
          } else {
              // mark as failed
              newDisplayOrder.push(c.ticker);
          }
        }));

        if (!active) return;

        // Fetch USD rates for all unique currencies found
        const currencies = [...new Set(Object.values(newPeerData).map((d: any) => d.currency).filter(Boolean))];
        const rateEntries = await Promise.all(
          currencies.map(async (cur: string) => {
            const usd = await convertToUSD(1, cur).catch(() => NaN);
            return [cur, isNaN(usd) ? NaN : 1 / usd] as [string, number]; // usd per 1 local unit
          })
        );
        const rates: Record<string, number> = {};
        for (const [cur, rate] of rateEntries) if (!isNaN(rate)) rates[cur] = rate;
        if (active) setUsdRates(rates);

        // Ensure current ticker is first in display order
        const reordered = [currentTicker, ...newDisplayOrder.filter(t => t !== currentTicker)];
        setDisplayOrder(reordered);
        setPeerData(newPeerData);
      } catch (err: any) {
         setError('Failed to load peer data');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchPeers();
    return () => { active = false; };
  }, [competitors, currentTicker]);

  // Calculate peer averages for market overview and profitability/balance metrics.
  const peersOnly = displayOrder.filter(t => t !== currentTicker).map(t => peerData[t]).filter(Boolean);
  const avg = {
     revG: peersOnly.reduce((acc, p) => acc + (p.revenueGrowth || 0), 0) / (peersOnly.filter(p => p.revenueGrowth).length || 1),
     ebitda: peersOnly.reduce((acc, p) => acc + (p.ebitdaMargins || 0), 0) / (peersOnly.filter(p => p.ebitdaMargins).length || 1),
     roe: peersOnly.reduce((acc, p) => acc + (p.returnOnEquity || 0), 0) / (peersOnly.filter(p => p.returnOnEquity).length || 1),
     debt: peersOnly.reduce((acc, p) => acc + (p.debtToEquity || 0), 0) / (peersOnly.filter(p => p.debtToEquity).length || 1),
  };

  return (
    <div className="w-full">
      <div className="bg-[#080a0f]/80 rounded-xl border border-slate-800/80 overflow-hidden shadow-[0_0_20px_rgba(37,99,235,0.05)] backdrop-blur-md">
        <div className="px-6 py-3 border-b border-slate-800/80 bg-[#0a0d14] text-[11px] text-amber-400 font-bold tracking-wider">
          Local currency · USD reference in parentheses · Rate date: {getRateDateLabel()}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#0a0d14] border-b border-slate-800/80 text-slate-400 font-bold uppercase tracking-widest text-[10px]">
              <tr>
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Price (Local / USD)</th>
                <th className="px-6 py-4">Market Cap (Local / USD)</th>
                <th className="px-6 py-4">Revenue Growth</th>
                <th className="px-6 py-4">EBITDA Margin</th>
                <th className="px-6 py-4">ROE</th>
                <th className="px-6 py-4">Debt / Equity</th>
              </tr>
            </thead>
          <tbody className="divide-y divide-slate-800/50">
            {loading ? (
               <tr>
                 <td colSpan={8} className="px-6 py-8 text-center text-blue-400 animate-pulse font-mono text-xs">
                   Peer Agent is fetching and validating real-time peer data...
                 </td>
               </tr>
            ) : (
               <>
                 {displayOrder.map(ticker => {
                   const d = peerData[ticker];
                   const isCurrent = ticker === currentTicker;
                   
                   if (!d) return (
                      <tr key={ticker} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 font-bold text-white">
                           {ticker} <span className="text-xs text-slate-500 font-mono ml-1">{ticker}</span>
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-xs">{isCurrent ? 'Analyzed' : 'Peer'}</td>
                        <td colSpan={6} className="px-6 py-4 text-slate-600 text-xs italic font-mono">Data unavailable</td>
                      </tr>
                   );

                   return (
                     <tr key={ticker} className={`hover:bg-slate-800/40 transition-colors ${isCurrent ? 'bg-indigo-900/10' : ''}`}>
                       <td className="px-6 py-4">
                         <div className={`font-bold truncate max-w-[200px] ${isCurrent ? 'text-indigo-400' : 'text-slate-200'}`}>{d.name}</div>
                         <div className="text-[11px] text-slate-500 mt-0.5 font-mono">{ticker}</div>
                       </td>
                       <td className="px-6 py-4">
                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${isCurrent ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 ring-1 ring-indigo-500/20' : 'bg-slate-800/50 text-slate-400 border-slate-700'}`}>
                           {d.role}
                         </span>
                       </td>
                       <td className="px-6 py-4 font-mono text-slate-300 text-xs">
                         {(() => {
                           const cur = (d as any).currency || '';
                           const rate = usdRates[cur];
                           const usd = rate && d.price ? d.price * rate : undefined;
                           return formatWithCurrency(d.price!, cur, usd);
                         })()}
                       </td>
                       <td className="px-6 py-4 font-mono text-slate-300 text-xs">
                         {(() => {
                           const cur = (d as any).currency || '';
                           const mc = (d as any).marketCap;
                           const rate = usdRates[cur];
                           const usd = rate && mc ? mc * rate : undefined;
                           return formatLargeWithCurrency(mc, cur, usd);
                         })()}
                       </td>
                       <td className="px-6 py-4 font-mono">
                         {d.revenueGrowth ? (
                           <span className={d.revenueGrowth > 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                             {(d.revenueGrowth * 100).toFixed(1)}%
                           </span>
                         ) : <span className="text-slate-500">-</span>}
                       </td>
                       <td className="px-6 py-4 font-mono text-slate-300">{formatPercent((d as any).ebitdaMargins)}</td>
                       <td className="px-6 py-4 font-mono text-slate-300">{formatPercent((d as any).returnOnEquity)}</td>
                       <td className="px-6 py-4 font-mono text-slate-300">{(d as any).debtToEquity ? (d as any).debtToEquity.toFixed(1) : '-'}</td>
                     </tr>
                   );
                 })}
                 
                 {/* Industry Average Row */}
                 {peersOnly.length > 0 && (
                   <tr className="bg-[#0a0d14] font-medium border-t-2 border-slate-700/50">
                     <td className="px-6 py-4 text-slate-400 uppercase tracking-wider text-[11px] font-bold">Industry Avg</td>
                     <td className="px-6 py-4"></td>
                     <td className="px-6 py-4"></td>
                     <td className="px-6 py-4"></td>
                     <td className="px-6 py-4 font-mono">
                       {avg.revG ? (
                         <span className={avg.revG > 0 ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                           {(avg.revG * 100).toFixed(1)}%
                         </span>
                       ) : <span className="text-slate-600">-</span>}
                     </td>
                     <td className="px-6 py-4 font-mono text-blue-400 font-bold">{formatPercent(avg.ebitda)}</td>
                     <td className="px-6 py-4 font-mono text-blue-400 font-bold">{formatPercent(avg.roe)}</td>
                     <td className="px-6 py-4 font-mono text-blue-400 font-bold">{avg.debt ? avg.debt.toFixed(1) : '-'}</td>
                   </tr>
                 )}
               </>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

function formatPercent(value?: number) {
  if (!value) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value?: number, currency?: string) {
  if (!value) return '-';
  const code = currency || '';
  if (code === 'USD') return `$${value.toFixed(2)}`;
  if (code === 'HKD') return `HK$${value.toFixed(2)}`;
  if (code === 'CNY' || code === 'RMB') return `¥${value.toFixed(2)} CNY`;
  if (code === 'JPY') return `¥${value.toFixed(0)} JPY`;
  if (code === 'KRW') return `₩${value.toLocaleString()} KRW`;
  return `${value.toLocaleString()}${code ? ` ${code}` : ''}`;
}

function formatLargeNumber(value?: number, currency?: string) {
  if (!value) return '-';
  const suffix = currency ? ` ${currency}` : '';
  if (Math.abs(value) >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}T${suffix}`;
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B${suffix}`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M${suffix}`;
  return `${value.toLocaleString()}${suffix}`;
}
