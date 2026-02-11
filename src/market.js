const COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  MATIC: "matic-network",
  TRX: "tron",
};

const BINANCE_SYMBOLS = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  ADA: "ADAUSDT",
  XRP: "XRPUSDT",
  BNB: "BNBUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
  MATIC: "MATICUSDT",
  TRX: "TRXUSDT",
};

export function getYesterdayUTCWindow() {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();
  const todayStart = Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0);
  const yesterdayStart = todayStart - 24 * 3600 * 1000;
  const yesterdayEnd = todayStart - 1; // up to 23:59:59.999
  return {
    fromMs: yesterdayStart,
    toMs: yesterdayEnd,
    fromSec: Math.floor(yesterdayStart / 1000),
    toSec: Math.floor(yesterdayEnd / 1000),
    fromDate: new Date(yesterdayStart),
    toDate: new Date(yesterdayEnd),
  };
}

const DEFAULT_UA = "rss-llm/0.1 (LangChain crypto predictor)";

async function fetchJSONWithRetry(url, tries = 3) {
  const headers = {
    accept: "application/json",
    "user-agent": process.env.USER_AGENT || DEFAULT_UA,
  };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  } else if (process.env.COINGECKO_DEMO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_DEMO_API_KEY;
  }

  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr || new Error("fetch failed");
}

async function fetchRangeUSD(coinId, fromSec, toSec) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
  return fetchJSONWithRetry(url, 3);
}

async function fetchMarketChartDaysUSD(coinId, days = 366) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  return fetchJSONWithRetry(url, 3);
}

async function fetchBinanceKlines(symbol, interval, startMs, endMs) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}`;
  return fetchJSONWithRetry(url, 3);
}

function summarizePrices(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const onlyYesterday = prices.sort((a, b) => a[0] - b[0]);
  const open = onlyYesterday[0][1];
  const close = onlyYesterday[onlyYesterday.length - 1][1];
  let high = -Infinity;
  let low = Infinity;
  for (const [, p] of onlyYesterday) {
    if (p > high) high = p;
    if (p < low) low = p;
  }
  const ret = open ? (close / open) - 1 : 0;
  return {
    open,
    close,
    high,
    low,
    return: ret,
    samples: onlyYesterday.length,
  };
}

function summarizeKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return null;
  const sorted = klines.slice().sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const open = Number(first[1]);
  const high = sorted.reduce((mx, k) => Math.max(mx, Number(k[2])), -Infinity);
  const low = sorted.reduce((mn, k) => Math.min(mn, Number(k[3])), Infinity);
  const close = Number(last[4]);
  const ret = open ? (close / open) - 1 : 0;
  return {
    open,
    close,
    high,
    low,
    return: ret,
    samples: sorted.length,
  };
}

export async function fetchYesterdayCurves(coins) {
  const { fromSec, toSec, fromDate, toDate } = getYesterdayUTCWindow();
  const out = [];
  for (const c of coins) {
    const id = COINGECKO_IDS[c];
    if (!id) {
      out.push({ coin: c, error: "unsupported", source: "CoinGecko" });
      continue;
    }
    try {
      const data = await fetchRangeUSD(id, fromSec, toSec);
      const summary = summarizePrices(data.prices);
      if (!summary) {
        out.push({ coin: c, error: "no-data", source: "CoinGecko" });
        continue;
      }
      out.push({
        coin: c,
        ...summary,
        window_start: fromDate.toISOString(),
        window_end: toDate.toISOString(),
        source: "CoinGecko",
      });
    } catch (e) {
      // Fallback to Binance
      try {
        const symbol = BINANCE_SYMBOLS[c];
        if (!symbol) throw new Error("unsupported");
        const klines = await fetchBinanceKlines(
          symbol,
          "1d",
          fromDate.getTime(),
          toDate.getTime()
        );
        const summary = summarizeKlines(klines);
        if (!summary) {
          out.push({ coin: c, error: "no-data", source: "Binance" });
          continue;
        }
        out.push({
          coin: c,
          ...summary,
          window_start: fromDate.toISOString(),
          window_end: toDate.toISOString(),
          source: "Binance",
        });
      } catch (e2) {
        out.push({ coin: c, error: "fetch-failed", source: "CoinGecko" });
      }
    }
  }
  return out;
}

export function curvesToText(curves) {
  return curves
    .map((cv) => {
      if (cv.error) return `- ${cv.coin}: error=${cv.error}`;
      const pct = Math.round((cv.return || 0) * 10000) / 100;
      return `- ${cv.coin}: open=${cv.open.toFixed(2)} close=${cv.close.toFixed(2)} high=${cv.high.toFixed(2)} low=${cv.low.toFixed(2)} return=${pct}% samples=${cv.samples}`;
    })
    .join("\n");
}

export function getYTDUTCWindow() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0); // Jan 1 UTC
  const end = now.getTime();
  return {
    fromMs: start,
    toMs: end,
    fromSec: Math.floor(start / 1000),
    toSec: Math.floor(end / 1000),
    fromDate: new Date(start),
    toDate: new Date(end),
  };
}

export async function fetchYTDCurves(coins) {
  const { fromSec, toSec, fromDate, toDate } = getYTDUTCWindow();
  const out = [];
  for (const c of coins) {
    const id = COINGECKO_IDS[c];
    if (!id) {
      out.push({ coin: c, error: "unsupported", source: "CoinGecko" });
      continue;
    }
    try {
      let data;
      let summary;
      try {
        data = await fetchRangeUSD(id, fromSec, toSec);
        summary = summarizePrices(data.prices);
      } catch (e) {
        // Fallback: use ~1y chart and filter for YTD window
        const rough = await fetchMarketChartDaysUSD(id, 366);
        const filtered = (rough.prices || []).filter(
          ([ts]) => ts >= fromDate.getTime() && ts <= toDate.getTime()
        );
        summary = summarizePrices(filtered);
      }
      if (!summary) {
        out.push({ coin: c, error: "no-data", source: "CoinGecko" });
        continue;
      }
      out.push({
        coin: c,
        ...summary,
        window_start: fromDate.toISOString(),
        window_end: toDate.toISOString(),
        source: "CoinGecko",
      });
    } catch (e) {
      // Fallback to Binance
      try {
        const symbol = BINANCE_SYMBOLS[c];
        if (!symbol) throw new Error("unsupported");
        const klines = await fetchBinanceKlines(
          symbol,
          "1d",
          fromDate.getTime(),
          toDate.getTime()
        );
        const summary = summarizeKlines(klines);
        if (!summary) {
          out.push({ coin: c, error: "no-data", source: "Binance" });
          continue;
        }
        out.push({
          coin: c,
          ...summary,
          window_start: fromDate.toISOString(),
          window_end: toDate.toISOString(),
          source: "Binance",
        });
      } catch (e2) {
        out.push({ coin: c, error: "fetch-failed", source: "CoinGecko" });
      }
    }
  }
  return out;
}

export function curvesToTextYTD(curves) {
  return curves
    .map((cv) => {
      if (cv.error) return `- ${cv.coin}: error=${cv.error}`;
      const pct = Math.round((cv.return || 0) * 10000) / 100;
      return `- ${cv.coin}: YTD open=${cv.open.toFixed(2)} close=${cv.close.toFixed(2)} return=${pct}% samples=${cv.samples}`;
    })
    .join("\n");
}

export function ytdTrendDirection(cv, neutralThreshold = 0.005) {
  if (!cv || cv.error) return "neutral";
  const r = cv.return || 0;
  if (Math.abs(r) < neutralThreshold) return "neutral";
  return r > 0 ? "up" : "down";
}

// --- Time series for charts ---
async function fetchSeriesRangeCoinGecko(coinId, fromMs, toMs) {
  const fromSec = Math.floor(fromMs / 1000);
  const toSec = Math.floor(toMs / 1000);
  const data = await fetchRangeUSD(coinId, fromSec, toSec);
  const points = (data.prices || []).map(([ts, price]) => ({ t: ts, price }));
  return { source: "CoinGecko", points };
}

async function fetchSeriesRangeBinance(symbol, fromMs, toMs) {
  const spanMs = Math.max(0, toMs - fromMs);
  // Choose finer interval for short windows; default to daily for long windows
  let interval = "1d";
  if (spanMs <= 36 * 3600 * 1000) interval = "1h"; // <= 36h → hourly points
  if (spanMs <= 12 * 3600 * 1000) interval = "30m"; // <= 12h → 30-min points
  if (spanMs <= 6 * 3600 * 1000) interval = "15m";  // <= 6h  → 15-min points
  const klines = await fetchBinanceKlines(symbol, interval, fromMs, toMs);
  const points = (klines || []).map((k) => ({ t: k[0], price: Number(k[4]) }));
  return { source: "Binance", points };
}

async function fetchSeriesRange(coin, fromMs, toMs) {
  const cgId = COINGECKO_IDS[coin];
  const binanceSymbol = BINANCE_SYMBOLS[coin];
  if (!cgId && !binanceSymbol) return { coin, error: "unsupported" };
  try {
    console.log(`Fetching series for ${coin} from CoinGecko...`);
    if (cgId) {
      const { source, points } = await fetchSeriesRangeCoinGecko(cgId, fromMs, toMs);
      return { coin, source, points };
    }
    throw new Error("no-coingecko-id");
  } catch (e) {
    try {
        console.log(`Fetching series for ${coin} from CoinGecko...`);
      if (!binanceSymbol) throw new Error("no-binance-symbol");
      const { source, points } = await fetchSeriesRangeBinance(binanceSymbol, fromMs, toMs);
      return { coin, source, points };
    } catch (e2) {
      return { coin, error: "fetch-failed" };
    }
  }
}

export async function fetchYesterdaySeries(coins) {
  const { fromMs, toMs, fromDate, toDate } = getYesterdayUTCWindow();
  const out = [];
  for (const c of coins) {
    const r = await fetchSeriesRange(c, fromMs, toMs);
    if (r.error) out.push({ coin: c, error: r.error });
    else out.push({ coin: c, source: r.source, window_start: fromDate.toISOString(), window_end: toDate.toISOString(), points: r.points });
  }
  return out;
}

export async function fetchYTDSeries(coins) {
  const { fromMs, toMs, fromDate, toDate } = getYTDUTCWindow();
  const out = [];
  for (const c of coins) {
    const r = await fetchSeriesRange(c, fromMs, toMs);
    if (r.error) out.push({ coin: c, error: r.error });
    else out.push({ coin: c, source: r.source, window_start: fromDate.toISOString(), window_end: toDate.toISOString(), points: r.points });
  }
  return out;
}

export function getUTCDayWindow(dateStr) {
  // dateStr expected as YYYY-MM-DD (UTC date)
  // Build start/end in UTC for that day
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  if (!y || !m || !d) throw new Error("invalid-date");
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const endMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return {
    fromMs: startMs,
    toMs: endMs,
    fromDate: new Date(startMs),
    toDate: new Date(endMs),
  };
}

export async function fetchDateSeries(coins, dateStr) {
  const { fromMs, toMs, fromDate, toDate } = getUTCDayWindow(dateStr);
  const out = [];
  for (const c of coins) {
    const r = await fetchSeriesRange(c, fromMs, toMs);
    if (r.error) out.push({ coin: c, error: r.error });
    else out.push({ coin: c, source: r.source, window_start: fromDate.toISOString(), window_end: toDate.toISOString(), points: r.points });
  }
  return out;
}
