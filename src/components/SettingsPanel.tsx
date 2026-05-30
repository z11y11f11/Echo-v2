/**
 * SettingsPanel — slide-in panel for configuring Echo Dashboard refresh settings.
 *
 * Settings persisted to localStorage under key echo_settings_v1.
 */

import React from 'react';
import { X, RefreshCw, Clock, Globe, ShieldAlert, BarChart3, Zap, BellRing } from 'lucide-react';
import { motion } from 'motion/react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EchoSettings {
  autoRefresh: {
    enabled: boolean;
    delayHours: 1 | 2 | 4 | 8;       // hours after US market close (4 PM ET)
    days: 'weekdays' | 'friday';      // every trading day vs Friday only
    includeNewsCompliance: boolean;   // also run SERP refresh
    includeSignal: boolean;           // also regenerate CIO signal
  };
  intervals: {
    price:      'off' | '15min' | '1h' | '4h' | 'daily';
    news:       'off' | 'daily' | 'weekly';
    compliance: 'off' | 'daily' | 'weekly' | 'monthly';
    signal:     'off' | 'after_refresh' | 'weekly';
  };
}

export const DEFAULT_SETTINGS: EchoSettings = {
  autoRefresh: {
    enabled: true,
    delayHours: 4,
    days: 'weekdays',
    includeNewsCompliance: true,
    includeSignal: true,
  },
  intervals: {
    price:      '4h',
    news:       'daily',
    compliance: 'weekly',
    signal:     'after_refresh',
  },
};

const LS_KEY = 'echo_settings_v1';

export function loadSettings(): EchoSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw) return { ...DEFAULT_SETTINGS, ...raw, autoRefresh: { ...DEFAULT_SETTINGS.autoRefresh, ...raw.autoRefresh }, intervals: { ...DEFAULT_SETTINGS.intervals, ...raw.intervals } };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: EchoSettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

// ── UI helpers ────────────────────────────────────────────────────────────────

type SelectOption = { label: string; value: string };

function SettingRow({ icon, label, sub, children }: {
  icon: React.ReactNode; label: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 border-b border-slate-800/60 last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 text-slate-500 shrink-0">{icon}</div>
        <div>
          <div className="text-sm font-bold text-slate-200">{label}</div>
          {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5.5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}
      style={{ height: '22px', width: '40px' }}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Select({ value, options, onChange }: {
  value: string; options: SelectOption[]; onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500/50"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowInET(): Date {
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etStr);
}

export function getNextAutoRefreshLabel(settings: EchoSettings): string {
  if (!settings.autoRefresh.enabled) return 'Auto-refresh disabled';
  const et = nowInET();
  const hour = et.getHours();
  const day  = et.getDay(); // 0=Sun…6=Sat
  const triggerHour = 16 + settings.autoRefresh.delayHours;

  const isValidDay = (d: number) =>
    settings.autoRefresh.days === 'weekdays' ? (d >= 1 && d <= 5) : (d === 5);

  // Already past trigger today?
  if (isValidDay(day) && hour >= triggerHour) {
    // Check next valid day
    for (let i = 1; i <= 7; i++) {
      const nextDay = (day + i) % 7;
      if (isValidDay(nextDay)) {
        const label = nextDay === 5 ? 'Friday' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][nextDay];
        return `Next: ${label} ${String(triggerHour).padStart(2,'0')}:00 ET`;
      }
    }
  }

  // Still before trigger today
  if (isValidDay(day) && hour < triggerHour) {
    return `Today ${String(triggerHour).padStart(2,'0')}:00 ET`;
  }

  // Weekend — find next valid day
  for (let i = 1; i <= 7; i++) {
    const nextDay = (day + i) % 7;
    if (isValidDay(nextDay)) {
      const label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][nextDay];
      return `Next: ${label} ${String(triggerHour).padStart(2,'0')}:00 ET`;
    }
  }
  return '—';
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  settings: EchoSettings;
  onChange: (s: EchoSettings) => void;
  onClose: () => void;
  lastAutoRefresh?: string; // YYYY-MM-DD
}

export default function SettingsPanel({ settings, onChange, onClose, lastAutoRefresh }: Props) {
  const set = (patch: Partial<EchoSettings>) => onChange({ ...settings, ...patch });
  const setAR = (patch: Partial<EchoSettings['autoRefresh']>) =>
    set({ autoRefresh: { ...settings.autoRefresh, ...patch } });
  const setIv = (patch: Partial<EchoSettings['intervals']>) =>
    set({ intervals: { ...settings.intervals, ...patch } });

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-[#080a0f] border-l border-slate-800 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-white">Dashboard Settings</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Refresh schedules & automation</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2">

          {/* ── Auto Refresh section ─────────────────────────────────────────── */}
          <div className="mb-1 mt-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            Auto-Refresh After Market Close
          </div>

          <div className="bg-[#0a0d14] border border-slate-800 rounded-xl px-4 py-1 mb-4">
            <SettingRow
              icon={<BellRing className="w-4 h-4" />}
              label="Enable auto-refresh"
              sub={settings.autoRefresh.enabled ? getNextAutoRefreshLabel(settings) : 'Disabled'}
            >
              <Toggle checked={settings.autoRefresh.enabled} onChange={v => setAR({ enabled: v })} />
            </SettingRow>

            <SettingRow
              icon={<Clock className="w-4 h-4" />}
              label="Delay after close"
              sub="US market closes at 4:00 PM ET"
            >
              <Select
                value={String(settings.autoRefresh.delayHours)}
                options={[
                  { value: '1', label: '+1 hour  (5 PM ET)' },
                  { value: '2', label: '+2 hours (6 PM ET)' },
                  { value: '4', label: '+4 hours (8 PM ET)' },
                  { value: '8', label: '+8 hours (12 AM ET)' },
                ]}
                onChange={v => setAR({ delayHours: parseInt(v) as any })}
              />
            </SettingRow>

            <SettingRow
              icon={<RefreshCw className="w-4 h-4" />}
              label="Refresh schedule"
              sub="When to auto-refresh"
            >
              <Select
                value={settings.autoRefresh.days}
                options={[
                  { value: 'weekdays', label: 'Every trading day' },
                  { value: 'friday',   label: 'Fridays only' },
                ]}
                onChange={v => setAR({ days: v as any })}
              />
            </SettingRow>

            <SettingRow
              icon={<Globe className="w-4 h-4" />}
              label="Include news & compliance"
              sub="Run Bright Data SERP on auto-refresh"
            >
              <Toggle checked={settings.autoRefresh.includeNewsCompliance} onChange={v => setAR({ includeNewsCompliance: v })} />
            </SettingRow>

            <SettingRow
              icon={<Zap className="w-4 h-4" />}
              label="Regenerate signal"
              sub="Run CIOAgent after auto-refresh"
            >
              <Toggle checked={settings.autoRefresh.includeSignal} onChange={v => setAR({ includeSignal: v })} />
            </SettingRow>
          </div>

          {/* ── Manual refresh intervals ─────────────────────────────────────── */}
          <div className="mb-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            Data Freshness Intervals
          </div>
          <div className="text-[10px] text-slate-600 mb-2">
            How stale data can be before the Refresh button shows a warning badge.
          </div>

          <div className="bg-[#0a0d14] border border-slate-800 rounded-xl px-4 py-1 mb-4">
            <SettingRow
              icon={<BarChart3 className="w-4 h-4" />}
              label="Price data"
              sub="Yahoo Finance quote"
            >
              <Select
                value={settings.intervals.price}
                options={[
                  { value: '15min', label: '15 min' },
                  { value: '1h',    label: '1 hour' },
                  { value: '4h',    label: '4 hours' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'off',   label: 'Off' },
                ]}
                onChange={v => setIv({ price: v as any })}
              />
            </SettingRow>

            <SettingRow
              icon={<Globe className="w-4 h-4" />}
              label="News & Web Intelligence"
              sub="Bright Data SERP"
            >
              <Select
                value={settings.intervals.news}
                options={[
                  { value: 'daily',  label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'off',    label: 'Off' },
                ]}
                onChange={v => setIv({ news: v as any })}
              />
            </SettingRow>

            <SettingRow
              icon={<ShieldAlert className="w-4 h-4" />}
              label="Compliance Alerts"
              sub="Regulatory / legal SERP"
            >
              <Select
                value={settings.intervals.compliance}
                options={[
                  { value: 'daily',   label: 'Daily' },
                  { value: 'weekly',  label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'off',     label: 'Off' },
                ]}
                onChange={v => setIv({ compliance: v as any })}
              />
            </SettingRow>

            <SettingRow
              icon={<Zap className="w-4 h-4" />}
              label="Investment Signal"
              sub="CIOAgent BUY/HOLD/SELL"
            >
              <Select
                value={settings.intervals.signal}
                options={[
                  { value: 'after_refresh', label: 'After each refresh' },
                  { value: 'weekly',        label: 'Weekly' },
                  { value: 'off',           label: 'Manual only' },
                ]}
                onChange={v => setIv({ signal: v as any })}
              />
            </SettingRow>
          </div>

          {/* Last auto-refresh */}
          {lastAutoRefresh && (
            <p className="text-[10px] text-slate-600 text-center pb-4">
              Last auto-refresh: {lastAutoRefresh}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors"
          >
            Save & Close
          </button>
        </div>
      </motion.div>
    </>
  );
}
