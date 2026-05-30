/**
 * Client-side wrapper for the SQLite persistence endpoints.
 * The actual better-sqlite3 database lives in server.ts (Node.js only).
 * This module calls /api/log/* so it is safe to import from browser code.
 */

import type { InvestmentSignal } from "../types";

export async function saveAnalysisLog(
  ticker: string,
  signal: InvestmentSignal,
  companyName: string
): Promise<void> {
  try {
    await fetch("/api/log/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, signal, companyName }),
    });
  } catch (e) {
    console.warn("[db] saveAnalysisLog failed (non-blocking):", e);
  }
}

export async function getAnalysisHistory(ticker: string): Promise<InvestmentSignal[]> {
  try {
    const res = await fetch(`/api/log/analysis/${encodeURIComponent(ticker)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function getLatestSignal(ticker: string): Promise<InvestmentSignal | null> {
  const history = await getAnalysisHistory(ticker);
  return history[0] ?? null;
}

export async function logValidationWarningRemote(
  agent: string,
  warnings: string[]
): Promise<void> {
  try {
    await fetch("/api/log/validation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, warnings, timestamp: new Date().toISOString() }),
    });
  } catch {
    // silent — validation logging must never break analysis flow
  }
}
