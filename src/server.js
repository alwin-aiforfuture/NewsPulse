import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchYesterdaySeries, fetchYTDSeries, getYesterdayUTCWindow, getYTDUTCWindow, getUTCDayWindow, fetchDateSeries } from "./market.js";
import { fetchNews, isNewsAboutCoin } from "./news.js";
import { classifyNewsItems } from "./sentiment.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "../public");

app.use(express.json());
app.use(express.static(publicDir));

// Simple in-memory cache for news classification
const newsCache = new Map(); // key -> { ts: number, data: any }
const NEWS_CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 300000); // default 5 minutes

app.get("/api/series", async (req, res) => {
  const coinsParam = req.query.coins || "BTC";
  let dateParam = req.query.date; // YYYY-MM-DD
  const windowParam = (req.query.window || "yesterday").toLowerCase();
  const coins = coinsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  try {
    let series;
    // Default to today's daily when no date is provided and not explicitly YTD
    if (!dateParam && windowParam !== "ytd") {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      dateParam = `${y}-${m}-${d}`;
    }
    if (dateParam) {
      series = await fetchDateSeries(coins, String(dateParam));
      return res.json({ window: "date", date: String(dateParam), coins, series });
    }
    if (windowParam === "ytd") {
      series = await fetchYTDSeries(coins);
    } else {
      series = await fetchYesterdaySeries(coins);
    }
    res.json({ window: windowParam, coins, series });
  } catch (e) {
    res.status(500).json({ error: "server-error" });
  }
});

app.get("/api/news_points", async (req, res) => {
  const coin = (req.query.coin || "BTC").toUpperCase();
  const windowParam = (req.query.window || "yesterday").toLowerCase();
  let dateParam = req.query.date; // YYYY-MM-DD
  console.log(dateParam, windowParam);
  try {
    let fromDate, toDate, keyWindow;
    // Default to today's daily when no date is provided and not explicitly YTD
    if (!dateParam && windowParam !== "ytd") {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      dateParam = `${y}-${m}-${d}`;
    }
    if (dateParam) {
      const w = getUTCDayWindow(String(dateParam));
      fromDate = w.fromDate; toDate = w.toDate; keyWindow = `date:${dateParam}`;
    } else {
      const w = windowParam === "ytd" ? getYTDUTCWindow() : getYesterdayUTCWindow();
      fromDate = w.fromDate; toDate = w.toDate; keyWindow = windowParam;
    }
    const cacheKey = `${coin}:${keyWindow}:${fromDate.toISOString()}:${toDate.toISOString()}`;
    const now = Date.now();
    const cached = newsCache.get(cacheKey);
    if (cached && now - cached.ts < NEWS_CACHE_TTL_MS) {
      return res.json({ window: keyWindow, coin, points: cached.data });
    }

    const items = await fetchNews({ from: fromDate, to: toDate, perFeed: 60, coin });
    const filtered = items.filter((it) => isNewsAboutCoin(it, coin));
    // Limit items before LLM for latency; keep most recent first
    const limited = filtered
      .sort((a, b) => b.pubDate - a.pubDate)
      .slice(0, Number(process.env.NEWS_CLASSIFY_LIMIT || 30));
    let points = [];
    try {
      const labels = await classifyNewsItems(coin, limited);
      const byTs = new Map(labels.map((l) => [l.ts, l]));
      points = limited
        .map((it) => {
          const ts = it.pubDate.getTime();
          const lab = byTs.get(ts);
          return {
            t: ts,
            title: it.title,
            link: it.link,
            source: it.source,
            sentiment: lab ? lab.sentiment : "bearish",
            confidence: lab && typeof lab.confidence === "number" ? lab.confidence : 0.5,
            reason: lab && lab.reason ? lab.reason : "",
            isPriceNews: lab ? Boolean(lab.isPriceNews) : false,
            timeframe: lab && typeof lab.timeframe === "string" ? lab.timeframe : "medium_term",
          };
        })
        .sort((a, b) => a.t - b.t)
        .slice(0, 50);
    } catch {
      points = limited
        .map((it) => ({ t: it.pubDate.getTime(), title: it.title, link: it.link, source: it.source, sentiment: "neutral", confidence: 0.5, reason: "", isPriceNews: false, timeframe: "medium_term" }))
        .sort((a, b) => a.t - b.t)
        .slice(0, 50);
    }
    newsCache.set(cacheKey, { ts: now, data: points });
    res.json({ window: keyWindow, coin, points });
  } catch (e) {
    res.status(500).json({ error: "server-error" });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Web server running at http://localhost:${port}`);
});
