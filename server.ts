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

const yahooFinance = new YahooFinance();

dotenv.config();

const app = express();
const PORT = 3000;

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
          "calendarEvents"
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
