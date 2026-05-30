/**
 * Entity normalization: resolves company names to their canonical Yahoo Finance
 * symbol and longName so that the same listed entity is not counted twice under
 * different aliases (e.g. "Samsung Electronics" vs "Samsung Electronics Co Ltd").
 *
 * Results are cached in-memory for the page lifetime.
 */

export interface NormalizedEntity {
  displayName: string   // longName from Yahoo Finance, or original name if lookup fails
  symbol: string        // resolved Yahoo Finance symbol, or original ticker if lookup fails
}

const cache = new Map<string, NormalizedEntity>();

/**
 * Resolves a company name (and optional hint ticker) to its canonical entity.
 * Falls back gracefully when the search API is unavailable.
 */
export async function normalizeEntity(
  name: string,
  ticker?: string
): Promise<NormalizedEntity> {
  const key = (ticker || name).trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  // Try by ticker first (more precise), then by name
  const queries = [ticker, name].filter((q): q is string => Boolean(q?.trim()));

  for (const q of queries) {
    try {
      const res = await fetch(`/api/search/${encodeURIComponent(q)}`);
      if (!res.ok) continue;
      const data = await res.json();
      const quotes: any[] = data.quotes || [];
      const match = quotes.find(
        (qt) => qt.typeDisp === "Equity" || qt.quoteType === "EQUITY"
      ) || quotes[0];

      if (match?.symbol) {
        const normalized: NormalizedEntity = {
          displayName: match.longname || match.shortname || name,
          symbol: match.symbol,
        };
        cache.set(key, normalized);
        return normalized;
      }
    } catch {
      // ignore per-query errors; try next query or fall through
    }
  }

  // Fallback — return original values unchanged
  const fallback: NormalizedEntity = { displayName: name, symbol: ticker || name };
  cache.set(key, fallback);
  return fallback;
}

/**
 * Deduplicates an array of entity-like objects by resolved Yahoo Finance symbol.
 * When two entries resolve to the same symbol, the one with the higher sort_value
 * (treated as a numeric string, e.g. "12.4B USD") is kept.
 *
 * Items that fail normalization are kept as-is.
 */
export async function deduplicateBySymbol<
  T extends { name: string; ticker?: string; sort_value?: string }
>(entities: T[]): Promise<T[]> {
  const resolved = await Promise.all(
    entities.map(async (e) => ({
      entity: e,
      normalized: await normalizeEntity(e.name, e.ticker),
    }))
  );

  const bySymbol = new Map<string, { entity: T; score: number }>();
  for (const { entity, normalized } of resolved) {
    const sym = normalized.symbol.toUpperCase();
    const score = parseFloat((entity.sort_value || "0").replace(/[^0-9.]/g, "")) || 0;
    const existing = bySymbol.get(sym);
    if (!existing || score > existing.score) {
      bySymbol.set(sym, { entity, score });
    }
  }

  // Preserve original order among winners
  const winners = new Set([...bySymbol.values()].map((v) => v.entity));
  return entities.filter((e) => winners.has(e));
}
