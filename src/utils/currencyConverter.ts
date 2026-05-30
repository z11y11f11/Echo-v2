/**
 * Currency conversion utilities.
 * Rates are fetched from Yahoo Finance via the project's /api/stock/:symbol endpoint
 * (e.g. USDKRW=X, USDHKD=X, USDCNY=X).
 * Results are cached in-memory for the lifetime of the page to avoid redundant calls.
 */

const rateCache = new Map<string, { rate: number; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Returns how many units of `fromCurrency` equal 1 USD.
 * e.g. fromCurrency = 'KRW' → ~1350
 */
async function getUsdRate(fromCurrency: string): Promise<number> {
  const upper = fromCurrency.toUpperCase();
  if (upper === "USD") return 1;

  const cached = rateCache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;

  try {
    const symbol = `USD${upper}=X`;
    const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate: number =
      data.regularMarketPrice ??
      data.price?.regularMarketPrice ??
      null;
    if (!rate || rate <= 0) throw new Error("No rate in response");
    rateCache.set(upper, { rate, fetchedAt: Date.now() });
    return rate;
  } catch (e) {
    console.warn(`[currencyConverter] getUsdRate(${upper}) failed:`, e);
    return NaN;
  }
}

/**
 * Converts an amount in `fromCurrency` to USD.
 * Returns NaN if the rate cannot be fetched.
 */
export async function convertToUSD(amount: number, fromCurrency: string): Promise<number> {
  if (!amount || !fromCurrency) return NaN;
  const rate = await getUsdRate(fromCurrency);
  if (isNaN(rate)) return NaN;
  return amount / rate;
}

/**
 * Returns today's date in YYYY-MM-DD format for rate attribution.
 */
export function getRateDateLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Formats a number in its local currency symbol.
 */
function localSymbol(currency: string): string {
  const map: Record<string, string> = {
    USD: "$", HKD: "HK$", CNY: "¥", JPY: "¥", KRW: "₩",
    EUR: "€", GBP: "£", TWD: "NT$", SGD: "S$", AUD: "A$",
  };
  return map[currency.toUpperCase()] ?? currency + " ";
}

/**
 * Formats a number with its local currency symbol and appends a USD reference.
 * e.g. formatWithCurrency(1_350_000, 'KRW', 1000) → '₩1,350,000 KRW (~$1,000 USD)'
 */
export function formatWithCurrency(
  amount: number,
  currency: string,
  usdEquivalent?: number
): string {
  if (!amount) return "—";
  const cur = currency.toUpperCase();
  const sym = localSymbol(cur);
  const local = cur === "JPY" || cur === "KRW"
    ? `${sym}${Math.round(amount).toLocaleString()} ${cur}`
    : `${sym}${amount.toFixed(2)} ${cur}`;

  if (usdEquivalent !== undefined && !isNaN(usdEquivalent)) {
    return `${local} (~$${abbreviate(usdEquivalent)} USD)`;
  }
  return local;
}

/**
 * Formats a large number in local currency with B/M suffix, plus USD reference.
 * e.g. formatLargeWithCurrency(2_700_000_000_000, 'KRW', 2_000_000_000) → '₩2.7T KRW (~$2.0B USD)'
 */
export function formatLargeWithCurrency(
  amount: number,
  currency: string,
  usdEquivalent?: number
): string {
  if (!amount) return "—";
  const cur = currency.toUpperCase();
  const sym = localSymbol(cur);
  const local = `${sym}${abbreviate(amount)} ${cur}`;

  if (usdEquivalent !== undefined && !isNaN(usdEquivalent)) {
    return `${local} (~$${abbreviate(usdEquivalent)} USD)`;
  }
  return local;
}

function abbreviate(value: number): string {
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (Math.abs(value) >= 1e9)  return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6)  return `${(value / 1e6).toFixed(1)}M`;
  return value.toLocaleString();
}
