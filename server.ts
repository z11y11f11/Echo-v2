import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfExtract = require("pdf-extraction");
const BetterSqlite3 = require("better-sqlite3");

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import YahooFinance from "yahoo-finance2";
import dotenv from "dotenv";

// ── SQLite setup ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "echo.db");
const db = new BetterSqlite3(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS analysis_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    company_name TEXT,
    verdict      TEXT,
    confidence   TEXT,
    key_reasons  TEXT,
    risk_warnings TEXT,
    as_of        TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS validation_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    agent     TEXT NOT NULL,
    warnings  TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sent_alert_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_key  TEXT NOT NULL UNIQUE,
    ticker     TEXT,
    alert_type TEXT,
    sent_at    TEXT NOT NULL
  );
`);

const insertAnalysis = db.prepare(`
  INSERT INTO analysis_log (ticker, company_name, verdict, confidence, key_reasons, risk_warnings, as_of, created_at)
  VALUES (@ticker, @company_name, @verdict, @confidence, @key_reasons, @risk_warnings, @as_of, @created_at)
`);

const selectAnalysisByTicker = db.prepare(`
  SELECT * FROM analysis_log WHERE ticker = ? ORDER BY created_at DESC
`);

const insertValidation = db.prepare(`
  INSERT INTO validation_log (agent, warnings, timestamp) VALUES (?, ?, ?)
`);

const insertSentAlert = db.prepare(`
  INSERT OR IGNORE INTO sent_alert_log (alert_key, ticker, alert_type, sent_at)
  VALUES (?, ?, ?, ?)
`);

const selectSentAlert = db.prepare(`
  SELECT alert_key FROM sent_alert_log WHERE alert_key = ?
`);

const yahooFinance = new YahooFinance();

dotenv.config();

const app = express();
const PORT = 3000;

type EmailPayload = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
};

async function sendEmail({ to, subject, html, text }: EmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL || "Echo Alerts <alerts@echo.local>";
  if (!apiKey) {
    const err: any = new Error("RESEND_API_KEY not configured");
    err.statusCode = 503;
    throw err;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status}): ${detail}`);
  }
  return response.json().catch(() => ({ ok: true }));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanRecipients(input: unknown): string[] {
  const list = Array.isArray(input) ? input : String(input || "").split(/[,\n;]/);
  return list
    .map(v => String(v).trim())
    .filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

// Setup Multer for PDF uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  app.use(cors());
  app.use(express.json());

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", version: "v2-multi-agent" });
  });

  // API Route: Stock Price
  app.get("/api/stock/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const quote = await yahooFinance.quote(symbol);
      if (!quote) {
        return res.status(404).json({ error: "Quote not found" });
      }
      res.json(quote);
    } catch (error) {
      console.error("Stock fetch error:", error);
      res.status(500).json({ error: "Failed to fetch stock data" });
    }
  });

  // API Route: Stock History (1 year)
  app.get("/api/stock/:symbol/history", async (req, res) => {
    try {
      const { symbol } = req.params;
      const to = new Date();
      const from = new Date();
      from.setFullYear(from.getFullYear() - 1); // Fetch 1 year for MA200 calculation

      const result = await yahooFinance.chart(symbol, {
        period1: from,
        period2: to,
        interval: '1d' as any,
      });
      res.json(result.quotes);
    } catch (error: any) {
      console.error("Historical fetch error:", error);
      if (error.message?.includes('No data found') || error.message?.includes('delisted')) {
        return res.status(404).json({ error: "No historical data found, symbol may be delisted" });
      }
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // ── Portfolio-mode refresh endpoint ──────────────────────────────────────────
  // POST /api/portfolio-refresh/:ticker
  // Risk-focused lightweight refresh: negative news + compliance only.
  // Intentionally narrow search queries to surface risks quickly.

  app.post("/api/portfolio-refresh/:ticker", async (req, res) => {
    const { ticker } = req.params;

    const callSerpLocal = async (query: string): Promise<any[]> => {
      const apiKey = process.env.BRIGHTDATA_API_KEY;
      const zone   = process.env.BRIGHTDATA_SERP_ZONE || "serp_api1";
      if (!apiKey) throw new Error("BRIGHTDATA_API_KEY missing");
      const r = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:   JSON.stringify({ zone, url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`, format: "json" }),
      });
      if (!r.ok) throw new Error(`Bright Data SERP ${r.status}`);
      const payload = await r.json();
      for (const key of ["organic", "organic_results"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
        if (Array.isArray(payload?.body?.[key])) return payload.body[key];
      }
      if (typeof payload?.body === "string") {
        try {
          const p = JSON.parse(payload.body);
          for (const key of ["organic", "organic_results"]) if (Array.isArray(p?.[key])) return p[key];
        } catch {}
      }
      return [];
    };
    const safeSerpLocal = async (q: string) => { try { return await callSerpLocal(q); } catch { return []; } };

    const HIGH_URGENCY_P = /fine|penalty|violation|lawsuit|banned|criminal/i;
    const MED_URGENCY_P  = /investigation|inquiry|review|warning|probe/i;
    const classifyP = (t: string): "high" | "medium" | "low" =>
      HIGH_URGENCY_P.test(t) ? "high" : MED_URGENCY_P.test(t) ? "medium" : "low";

    try {
      const now = new Date().toISOString();
      const [quoteResult, risk1, risk2, c1, c2, c3] = await Promise.allSettled([
        yahooFinance.quote(ticker).catch(() => null),
        // Risk-focused news queries
        safeSerpLocal(`${ticker} risk warning lawsuit regulation 2026`),
        safeSerpLocal(`${ticker} bad news negative outlook downgrade 2026`),
        // Compliance queries (same as full refresh)
        safeSerpLocal(`${ticker} SEC regulatory change compliance 2025 2026`),
        safeSerpLocal(`${ticker} lawsuit litigation fine penalty 2025 2026`),
        safeSerpLocal(`${ticker} ESG compliance disclosure requirement 2025 2026`),
      ]);

      const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
      const companyWord = (quote as any)?.longName?.split(" ")[0]?.toLowerCase() || ticker.toLowerCase();
      const tickerLower = ticker.toLowerCase();

      // Merge + deduplicate risk news
      const riskRaw = [
        ...(risk1.status === "fulfilled" ? risk1.value : []),
        ...(risk2.status === "fulfilled" ? risk2.value : []),
      ];
      const seenR = new Set<string>();
      const riskNews = riskRaw
        .filter(r => {
          const combined = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
          const t = (r.title || "").trim().toLowerCase();
          if (!t || seenR.has(t)) return false;
          seenR.add(t);
          return combined.includes(tickerLower) || combined.includes(companyWord);
        })
        .sort((a, b) => (!a.date && !b.date) ? 0 : !a.date ? 1 : !b.date ? -1 : new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 8)
        .map(r => ({
          title: r.title || "Untitled", url: r.link || r.url || "",
          snippet: r.snippet || r.description || "", date: r.date || null,
          sentiment: "negative" as const,  // risk-focused — assume negative
        }));

      const toAlerts = (res: any[], cat: string) =>
        (res || []).map(r => {
          const text = `${r.title || ""} ${r.snippet || r.description || ""}`.trim();
          if (!text) return null;
          return { summary: text, source: r.link || r.url || "", urgency: classifyP(text), date: r.date || null, category: cat };
        }).filter(Boolean).slice(0, 5) as any[];

      const allAlerts = [
        ...toAlerts(c1.status === "fulfilled" ? c1.value : [], "regulatory"),
        ...toAlerts(c2.status === "fulfilled" ? c2.value : [], "legal"),
        ...toAlerts(c3.status === "fulfilled" ? c3.value : [], "esg_compliance"),
      ];

      const overall_risk: "high" | "medium" | "low" = allAlerts.some(a => a.urgency === "high")
        ? "high" : allAlerts.some(a => a.urgency === "medium") ? "medium" : "low";

      const dataGaps: string[] = [];
      if (!process.env.BRIGHTDATA_API_KEY) dataGaps.push("BRIGHTDATA_API_KEY not configured");

      res.json({
        ticker,
        price: quote,
        webIntel:   { as_of: now, data_source: "brightdata_serp", confidence: dataGaps.length ? "low" : "high", refresh_interval: "Hourly", ticker, news_signals: riskNews, data_gaps: dataGaps },
        compliance: { as_of: now, data_source: "brightdata_serp", confidence: dataGaps.length ? "low" : "high", refresh_interval: "Every Monday 09:00", ticker, alerts: allAlerts, overall_risk, data_gaps: dataGaps },
        refreshed_at: now,
      });
    } catch (err: any) {
      console.error("Portfolio refresh error:", err);
      res.status(500).json({ error: err.message || "Portfolio refresh failed" });
    }
  });

  // ── ESG data endpoint ────────────────────────────────────────────────────────
  // GET /api/esg/:ticker
  // Runs 3 parallel Bright Data SERP searches focused on ESG / sustainability.
  // Returns raw signals grouped by E / S / G for ESGAgent to interpret.

  app.get("/api/esg/:ticker", async (req, res) => {
    const { ticker } = req.params;
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    const zone   = process.env.BRIGHTDATA_SERP_ZONE || "serp_api1";

    if (!apiKey) {
      return res.status(503).json({ error: "BRIGHTDATA_API_KEY not configured", signals: [] });
    }

    const serpCall = async (query: string): Promise<any[]> => {
      const r = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ zone, url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`, format: "json" }),
      });
      if (!r.ok) throw new Error(`SERP ${r.status}`);
      const payload = await r.json();
      for (const key of ["organic", "organic_results"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
        if (Array.isArray(payload?.body?.[key])) return payload.body[key];
      }
      if (typeof payload?.body === "string") {
        try {
          const p = JSON.parse(payload.body);
          for (const key of ["organic", "organic_results"]) if (Array.isArray(p?.[key])) return p[key];
        } catch {}
      }
      return [];
    };
    const safe = async (q: string) => { try { return await serpCall(q); } catch { return []; } };

    try {
      const [envResults, socialResults, govResults] = await Promise.all([
        safe(`${ticker} environmental carbon emissions climate sustainability report 2024 2025`),
        safe(`${ticker} social responsibility employee diversity community supply chain 2024 2025`),
        safe(`${ticker} corporate governance board directors compliance ESG rating 2024 2025`),
      ]);

      const extractSnippets = (results: any[]) =>
        results
          .map(r => ({ title: r.title || "", snippet: r.snippet || r.description || "", url: r.link || r.url || "", date: r.date || null }))
          .filter(r => r.title || r.snippet)
          .slice(0, 6);

      res.json({
        ticker,
        as_of: new Date().toISOString(),
        environmental: extractSnippets(envResults),
        social:        extractSnippets(socialResults),
        governance:    extractSnippets(govResults),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message, signals: [] });
    }
  });

  // ── Full refresh endpoint ─────────────────────────────────────────────────────
  // POST /api/refresh/:ticker
  // Fetches live stock price + Bright Data SERP webIntel + compliance in parallel.
  // Runs server-side so BRIGHTDATA_API_KEY stays out of the browser bundle.

  app.post("/api/refresh/:ticker", async (req, res) => {
    const { ticker } = req.params;

    const callSerp = async (query: string): Promise<any[]> => {
      const apiKey = process.env.BRIGHTDATA_API_KEY;
      const zone   = process.env.BRIGHTDATA_SERP_ZONE || "serp_api1";
      if (!apiKey) throw new Error("BRIGHTDATA_API_KEY missing");
      const r = await fetch("https://api.brightdata.com/request", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ zone, url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`, format: "json" }),
      });
      if (!r.ok) throw new Error(`Bright Data SERP ${r.status}`);
      const payload = await r.json();
      // extract organic results from various response shapes
      for (const key of ["organic", "organic_results"]) {
        if (Array.isArray(payload?.[key]))            return payload[key];
        if (Array.isArray(payload?.body?.[key]))      return payload.body[key];
      }
      if (typeof payload?.body === "string") {
        try {
          const p = JSON.parse(payload.body);
          for (const key of ["organic", "organic_results"]) if (Array.isArray(p?.[key])) return p[key];
        } catch {}
      }
      return [];
    };

    const safeSerp = async (query: string): Promise<any[]> => {
      try { return await callSerp(query); } catch { return []; }
    };

    const HIGH_URGENCY = /fine|penalty|violation|lawsuit|banned|criminal/i;
    const MED_URGENCY  = /investigation|inquiry|review|warning|probe/i;
    const IRRELEVANT   = /predict|prophecy|psychic|astrology|horoscope|baba vanga|vanga|tarot|zodiac/i;

    const classifyUrgency = (text: string): "high" | "medium" | "low" =>
      HIGH_URGENCY.test(text) ? "high" : MED_URGENCY.test(text) ? "medium" : "low";

    const toNewsSignals = (results: any[], tickerStr: string, companyWord: string) =>
      results
        .filter(r => {
          const combined = `${r.title || ""} ${r.snippet || r.description || ""}`.toLowerCase();
          return !IRRELEVANT.test(combined) &&
            (combined.includes(tickerStr.toLowerCase()) || combined.includes(companyWord));
        })
        .map(r => ({
          title:     r.title || "Untitled",
          url:       r.link || r.url || "",
          snippet:   r.snippet || r.description || "",
          date:      r.date || null,
          sentiment: "neutral" as const,   // LLM classification skipped for lightweight refresh
        }))
        .slice(0, 8);

    const toComplianceAlerts = (results: any[], category: string) =>
      results
        .map(r => {
          const text = `${r.title || ""} ${r.snippet || r.description || ""}`.trim();
          if (!text) return null;
          return { summary: text, source: r.link || r.url || "", urgency: classifyUrgency(text), date: r.date || null, category };
        })
        .filter(Boolean)
        .slice(0, 5) as any[];

    try {
      const now = new Date().toISOString();

      // Run all fetches in parallel: stock price + 3 webIntel searches + 3 compliance searches
      const [quoteResult, r1, r2, r3, c1, c2, c3] = await Promise.allSettled([
        yahooFinance.quote(ticker).catch(() => null),
        safeSerp(`${ticker} latest news site:reuters.com OR site:bloomberg.com OR site:wsj.com 2026`),
        safeSerp(`${ticker} product launch partnership earnings 2026`),
        safeSerp(`${ticker} analyst rating price target 2026`),
        safeSerp(`${ticker} SEC regulatory change compliance 2025 2026`),
        safeSerp(`${ticker} lawsuit litigation fine penalty 2025 2026`),
        safeSerp(`${ticker} ESG compliance disclosure requirement 2025 2026`),
      ]);

      const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
      const companyWord = (quote as any)?.longName?.split(" ")[0]?.toLowerCase() || ticker.toLowerCase();

      const allNews = [
        ...(r1.status === "fulfilled" ? r1.value : []),
        ...(r2.status === "fulfilled" ? r2.value : []),
        ...(r3.status === "fulfilled" ? r3.value : []),
      ];
      // Deduplicate news by title
      const seenTitles = new Set<string>();
      const newsSignals = allNews
        .filter(r => { const t = (r.title || "").trim().toLowerCase(); if (!t || seenTitles.has(t)) return false; seenTitles.add(t); return true; })
        .sort((a, b) => (!a.date && !b.date) ? 0 : !a.date ? 1 : !b.date ? -1 : new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 10);

      const regulatoryAlerts = toComplianceAlerts(c1.status === "fulfilled" ? c1.value : [], "regulatory");
      const legalAlerts      = toComplianceAlerts(c2.status === "fulfilled" ? c2.value : [], "legal");
      const esgAlerts        = toComplianceAlerts(c3.status === "fulfilled" ? c3.value : [], "esg_compliance");
      const allAlerts        = [...regulatoryAlerts, ...legalAlerts, ...esgAlerts];

      const overall_risk: "high" | "medium" | "low" = allAlerts.some(a => a.urgency === "high")
        ? "high" : allAlerts.some(a => a.urgency === "medium") ? "medium" : "low";

      const dataGaps: string[] = [];
      if (!process.env.BRIGHTDATA_API_KEY) dataGaps.push("BRIGHTDATA_API_KEY not configured");

      const webIntel = {
        as_of:            now,
        data_source:      "brightdata_serp",
        confidence:       dataGaps.length ? "low" : "high",
        refresh_interval: "Hourly",
        ticker,
        news_signals:     toNewsSignals(newsSignals, ticker, companyWord),
        hiring_trend:     { signal: "unknown", evidence: "Hiring data not fetched in lightweight refresh." },
        regulatory_alerts: (c1.status === "fulfilled" ? c1.value : [])
          .filter((r: any) => /sec|regulation|compliance|filing/i.test(`${r.title || ""} ${r.snippet || ""}`))
          .slice(0, 4)
          .map((r: any) => ({ summary: `${r.title || ""} ${r.snippet || ""}`.trim(), urgency: classifyUrgency(`${r.title} ${r.snippet}`), date: r.date || null })),
        competitive_signals: (r2.status === "fulfilled" ? r2.value : []).slice(0, 5)
          .map((r: any) => ({ signal: [r.title, r.snippet].filter(Boolean).join(" — "), source: r.link || r.url || "" })),
        data_gaps: dataGaps,
      };

      const compliance = {
        as_of:            now,
        data_source:      "brightdata_serp",
        confidence:       dataGaps.length ? "low" : "high",
        refresh_interval: "Every Monday 09:00",
        ticker,
        alerts:           allAlerts,
        overall_risk,
        data_gaps:        dataGaps,
      };

      res.json({ ticker, price: quote, webIntel, compliance, refreshed_at: now });
    } catch (err: any) {
      console.error("Refresh error:", err);
      res.status(500).json({ error: err.message || "Refresh failed" });
    }
  });

  // API Route: Stock Summary (Financials, Statistics, & Analyst Recommendations)
  app.get("/api/stock/:symbol/summary", async (req, res) => {
    try {
      const { symbol } = req.params;
      const result = await yahooFinance.quoteSummary(symbol, {
        modules: [
          "defaultKeyStatistics",
          "financialData",
          "summaryDetail",
          "price",
          "recommendationTrend",
          "calendarEvents",
          "assetProfile"   // company officers (CEO/CFO names, titles)
        ]
      });
      res.json(result);
    } catch (error: any) {
      if (error.message?.includes('Quote not found')) {
        return res.status(404).json({ error: "Quote summary not found" });
      }
      console.error("Summary fetch error:", error);
      res.status(500).json({ error: "Failed to fetch stock summary" });
    }
  });

  // API Route: Search Symbol
  app.get("/api/search/:query", async (req, res) => {
    try {
      const { query } = req.params;
      const searchRes = await yahooFinance.search(query, {
        quotesCount: 5,
        newsCount: 0,
      });
      res.json(searchRes);
    } catch (error: any) {
      if (error.name === 'BadRequestError' || error.message?.includes('Invalid Search Query')) {
        return res.json({ quotes: [] });
      }
      console.error("Search fetch error:", error);
      res.status(500).json({ error: "Failed to search symbol", details: error.message });
    }
  });

  // API Route: Extract Text from PDF
  app.post("/api/extract", (req, res, next) => {
    console.log("POST /api/extract hit");
    next();
  }, upload.single("report"), async (req, res) => {
    console.log("Multer finished parsing for /api/extract");
    try {
      if (!req.file) {
        console.error("No file in request to /api/extract");
        return res.status(400).json({ error: "No report file uploaded" });
      }

      console.log("Extracting text from PDF, size:", req.file.size, "mimetype:", req.file.mimetype);
      
      const pdfData = await pdfExtract(req.file.buffer);
      const text = pdfData.text;

      if (!text || text.trim().length === 0) {
        console.warn("Extraction yielded empty text");
        return res.status(422).json({ error: "Could not extract text from PDF. It might be empty or an image-based PDF." });
      }

      console.log("Extraction successful, text length:", text.length);
      res.json({ text });
    } catch (error: any) {
      console.error("Extraction error details:", error);
      res.status(500).json({ error: "Failed to extract text: " + error.message });
    }
  });

  // ── Logging API ────────────────────────────────────────────────────────────

  // POST /api/log/analysis — persist InvestmentSignal for a ticker
  app.post("/api/log/analysis", (req, res) => {
    try {
      const { ticker, signal, companyName } = req.body;
      if (!ticker || !signal) return res.status(400).json({ error: "ticker and signal required" });
      insertAnalysis.run({
        ticker,
        company_name: companyName || "",
        verdict: signal.verdict,
        confidence: signal.confidence,
        key_reasons: JSON.stringify(signal.key_reasons || []),
        risk_warnings: JSON.stringify(signal.risk_warnings || []),
        as_of: signal.generated_at || new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("log/analysis error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/log/analysis/:ticker — retrieve signal history for a ticker
  // Also aliased as /api/log/history/:ticker for SignalTimeline component
  const handleSignalHistory = (req: any, res: any) => {
    try {
      const rows = selectAnalysisByTicker.all(req.params.ticker) as any[];
      const signals = rows.map(row => ({
        verdict: row.verdict,
        confidence: row.confidence,
        key_reasons: JSON.parse(row.key_reasons || "[]"),
        risk_warnings: JSON.parse(row.risk_warnings || "[]"),
        generated_at: row.as_of,
        created_at: row.created_at,
      }));
      res.json(signals);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.get("/api/log/analysis/:ticker", handleSignalHistory);
  app.get("/api/log/history/:ticker", handleSignalHistory);

  // POST /api/log/validation — persist agent validation warnings
  app.post("/api/log/validation", (req, res) => {
    try {
      const { agent, warnings, timestamp } = req.body;
      insertValidation.run(agent || "unknown", JSON.stringify(warnings || []), timestamp || new Date().toISOString());
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Email alerts ───────────────────────────────────────────────────────────

  app.post("/api/alerts/send", async (req, res) => {
    try {
      const recipients = cleanRecipients(req.body?.recipients);
      const alerts = Array.isArray(req.body?.alerts) ? req.body.alerts : [];
      if (recipients.length === 0) return res.status(400).json({ error: "At least one valid recipient email is required" });
      if (alerts.length === 0) return res.status(400).json({ error: "alerts required" });

      const unsent = alerts.filter((alert: any) => {
        const key = String(alert.alertKey || "");
        return key && !selectSentAlert.get(key);
      });

      if (unsent.length === 0) {
        return res.json({ ok: true, sent: false, skipped: alerts.length, reason: "duplicate" });
      }

      const rows = unsent.map((alert: any) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-weight:700">${escapeHtml(alert.ticker)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#bfdbfe">${escapeHtml(alert.type)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#e2e8f0">${escapeHtml(alert.title || alert.message)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#94a3b8">${escapeHtml(alert.detail || "")}</td>
        </tr>
      `).join("");

      const html = `
        <div style="font-family:Inter,Arial,sans-serif;background:#020617;color:#e2e8f0;padding:24px">
          <div style="max-width:760px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px">
            <h1 style="margin:0 0 6px;font-size:20px;color:#fff">Echo Portfolio Alert</h1>
            <p style="margin:0 0 18px;color:#94a3b8;font-size:13px">Triggered ${escapeHtml(new Date().toISOString())}</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Ticker</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Type</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Signal</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Detail</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;

      await sendEmail({
        to: recipients,
        subject: `Echo alert: ${unsent.length} portfolio signal${unsent.length !== 1 ? "s" : ""}`,
        html,
      });

      const sentAt = new Date().toISOString();
      unsent.forEach((alert: any) => {
        insertSentAlert.run(String(alert.alertKey), String(alert.ticker || ""), String(alert.type || ""), sentAt);
      });

      res.json({ ok: true, sent: true, count: unsent.length, skipped: alerts.length - unsent.length });
    } catch (err: any) {
      console.error("alerts/send error:", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to send alert email" });
    }
  });

  app.post("/api/alerts/monthly-report", async (req, res) => {
    try {
      const recipients = cleanRecipients(req.body?.recipients);
      const portfolio = Array.isArray(req.body?.portfolio) ? req.body.portfolio : [];
      const periodLabel = String(req.body?.periodLabel || "Current portfolio snapshot");
      const periodStart = String(req.body?.periodStart || "");
      const periodEnd = String(req.body?.periodEnd || "");
      if (recipients.length === 0) return res.status(400).json({ error: "At least one valid recipient email is required" });
      if (portfolio.length === 0) return res.status(400).json({ error: "portfolio required" });

      const signalCounts = { BUY: 0, HOLD: 0, SELL: 0 };
      const alertRows = portfolio.map((row: any) => ({
        ticker: String(row.ticker || ""),
        company: String(row.company || ""),
        signal: String(row.signal || "NONE"),
        highAlerts: Number(row.highAlerts || 0),
        negativeNews: Number(row.negativeNews || 0),
        priceChange: Number(row.priceChange || 0),
      }));
      alertRows.forEach(row => {
        if (row.signal === "BUY" || row.signal === "HOLD" || row.signal === "SELL") signalCounts[row.signal as keyof typeof signalCounts]++;
      });

      const maxAlerts = Math.max(1, ...alertRows.map(r => r.highAlerts));
      const maxNews = Math.max(1, ...alertRows.map(r => r.negativeNews));
      const bar = (value: number, max: number, color: string) =>
        `<div style="height:8px;width:${Math.max(4, Math.round((value / max) * 100))}%;background:${color};border-radius:999px"></div>`;

      const signalChart = `
        <div style="display:grid;gap:8px">
          ${(["BUY", "HOLD", "SELL"] as const).map(key => `
            <div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#cbd5e1;margin-bottom:4px"><span>${key}</span><strong>${signalCounts[key]}</strong></div>
              ${bar(signalCounts[key], Math.max(1, signalCounts.BUY, signalCounts.HOLD, signalCounts.SELL), key === "BUY" ? "#34d399" : key === "SELL" ? "#fb7185" : "#fbbf24")}
            </div>
          `).join("")}
        </div>
      `;

      const rows = alertRows.map(row => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-weight:700">${escapeHtml(row.ticker)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#94a3b8">${escapeHtml(row.company)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:#e2e8f0">${escapeHtml(row.signal)}</td>
          <td style="padding:10px;border-bottom:1px solid #1e293b">${bar(row.highAlerts, maxAlerts, "#fb7185")}<div style="font-size:11px;color:#94a3b8;margin-top:4px">${row.highAlerts} high</div></td>
          <td style="padding:10px;border-bottom:1px solid #1e293b">${bar(row.negativeNews, maxNews, "#22d3ee")}<div style="font-size:11px;color:#94a3b8;margin-top:4px">${row.negativeNews} negative</div></td>
          <td style="padding:10px;border-bottom:1px solid #1e293b;color:${row.priceChange < 0 ? "#fb7185" : "#34d399"};font-weight:700">${Number.isFinite(row.priceChange) ? row.priceChange.toFixed(2) : "0.00"}%</td>
        </tr>
      `).join("");

      const html = `
        <div style="font-family:Inter,Arial,sans-serif;background:#020617;color:#e2e8f0;padding:24px">
          <div style="max-width:860px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px">
            <h1 style="margin:0 0 6px;font-size:22px;color:#fff">Echo Portfolio Monthly Monitor</h1>
            <p style="margin:0 0 4px;color:#94a3b8;font-size:13px">Period: ${escapeHtml(periodLabel)}</p>
            <p style="margin:0 0 18px;color:#64748b;font-size:12px">Generated ${escapeHtml(new Date().toISOString())}${periodStart && periodEnd ? ` · ${escapeHtml(periodStart.slice(0, 10))} to ${escapeHtml(periodEnd.slice(0, 10))}` : ""}</p>
            <div style="border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:18px;background:#020617">
              <h2 style="margin:0 0 12px;font-size:14px;color:#cbd5e1">Investment Signal Mix</h2>
              ${signalChart}
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Ticker</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Company</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Signal</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">High Alerts</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Negative News</th>
                  <th align="left" style="padding:10px;border-bottom:1px solid #334155;color:#64748b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">1D Move</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;

      await sendEmail({
        to: recipients,
        subject: `Echo monthly portfolio monitor - ${periodLabel} (${portfolio.length} tickers)`,
        html,
      });

      res.json({ ok: true, sent: true, count: portfolio.length });
    } catch (err: any) {
      console.error("alerts/monthly-report error:", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to send monthly report" });
    }
  });

  // Ensure all undefined /api/* routes return JSON 404 instead of falling through to Vite/Index
  app.all("/api/*", (req, res) => {
    console.warn(`404 for API route: ${req.method} ${req.url}`);
    res.status(404).json({ 
      error: `API route not found: ${req.method} ${req.url}`,
      suggestion: "If this route should exist, please check the backend routing table." 
    });
  });

  // Global error handler for API routes to always return JSON
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/')) {
      console.error("Global API Error:", err);
      return res.status(500).json({ 
        error: "Internal Server Error", 
        message: err.message || "An unexpected error occurred." 
      });
    }
    next(err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Echo server running at http://localhost:${PORT}`);
  });
}

startServer();
