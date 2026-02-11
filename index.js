
import "dotenv/config";
// Optional: allow insecure TLS for corporate proxies (use with caution)
if (process.env.INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn("[warn] INSECURE_TLS enabled: TLS cert verification disabled.");
}
import { fetchNews } from "./src/news.js";
import { predictFromNews } from "./src/chain.js";
import {
  fetchYesterdayCurves,
  fetchYTDCurves,
  curvesToText,
  curvesToTextYTD,
  ytdTrendDirection,
} from "./src/market.js";

function parseCoinsArg() {
  const arg = process.argv.find((a) => a.startsWith("--coins="));
  if (!arg) return ["BTC", "ETH", "SOL"];
  return arg
    .split("=")[1]
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function hasYesterdayFlag() {
  return process.argv.some((a) => a === "--yesterday");
}

function hasYTDFlag() {
  return process.argv.some((a) => a === "--ytd");
}

function getYesterdayWindowUTC() {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();
  const todayStart = Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart - 24 * 3600 * 1000);
  const yesterdayEnd = new Date(todayStart - 1);
  return { from: yesterdayStart, to: yesterdayEnd };
}

async function main() {
  const coins = parseCoinsArg();
  const useYesterday = hasYesterdayFlag();
  const useYTD = hasYTDFlag();
  const modeLabel = useYesterday ? " (yesterday mode)" : useYTD ? " (ytd mode)" : "";
  console.log(`Coins: ${coins.join(", ")}${modeLabel}`);

  let news;
  let curves = [];
  let ytdCurves = [];

  if (useYesterday) {
    const { from, to } = getYesterdayWindowUTC();
    news = await fetchNews({ perFeed: 50, from, to });
    curves = await fetchYesterdayCurves(coins);
    console.log(curves)
    ytdCurves = await fetchYTDCurves(coins);
  } else {
    news = await fetchNews({ perFeed: 10, sinceHours: 48 });
    if (useYTD) {
      ytdCurves = await fetchYTDCurves(coins);
    }
  }

  console.log(`Fetched ${news.length} news items`);

  const predictions = await predictFromNews(coins, news, {
    horizonHours: 24,
    curvesText: useYesterday ? curvesToText(curves) : "",
    ytdCurvesText: (useYesterday || useYTD) ? curvesToTextYTD(ytdCurves) : "",
  });

  console.log("Predictions:");
  predictions.forEach((p) => {
    const pct = Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) : 0;
    console.log(`\n`);
    console.log(`- ${p.coin}: ${p.direction} (conf ${pct}%)`);
    console.log(`  Horizon: ${p.horizon_hours}h`);
    console.log(`  Rationale: ${p.rationale}`);

    if (useYesterday || useYTD) {
      const ytd = ytdCurves.find((c) => c.coin === p.coin);
      if (ytd && !ytd.error) {
        const ytdPct = Math.round((ytd.return || 0) * 10000) / 100;
        const ytdDir = ytdTrendDirection(ytd);
        const aligned =
          p.direction === ytdDir
            ? "aligned"
            : p.direction === "neutral" || ytdDir === "neutral"
            ? "mixed"
            : "misaligned";
        console.log(`  YTD: ${ytdDir} (${ytdPct}%) — ${aligned}`);
      }
    }
  });

  console.log("\nEnd of predictions.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});