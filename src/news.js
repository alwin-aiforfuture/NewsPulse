import Parser from "rss-parser";

const NEWS_PROVIDER = (process.env.NEWS_PROVIDER ||  "cryptocompare").toLowerCase();
const CRYPTOPANIC_TOKEN = process.env.CRYPTOPANIC_TOKEN || "";
const FEEDLY_TOKEN = process.env.FEEDLY_TOKEN || "";
const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || process.env.CRYPTOCOMPARE_KEY || "";

// Optional volume controls
const NEWS_MAX_PAGES = Number(process.env.NEWS_MAX_PAGES || 4);
const NEWS_PER_PAGE = Number(process.env.NEWS_PER_PAGE || 50);
const NEWS_SINCE_HOURS_DEFAULT = Number(process.env.NEWS_SINCE_HOURS || 72);

const FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss", source: "CoinTelegraph" },
];

const parser = new Parser();

export async function fetchNews({ feeds = FEEDS, perFeed = 10, sinceHours = 72, from, to } = {}) {
  const now = Date.now();
  const results = [];
  console.log(`From: ${from}, To: ${to}`);

  // Feedly provider for deeper pagination on specific feeds
  if (NEWS_PROVIDER === "feedly" && FEEDLY_TOKEN) {
    for (const f of feeds) {
      try {
        const items = await fetchNewsFeedlyForFeed({ feed: f, perPage: Math.max(perFeed, 50), maxPages: 6 });
        const filtered = items.filter((it) => {
          if (from && to) return it.pubDate >= from && it.pubDate <= to;
          const ageH = (now - it.pubDate.getTime()) / 3600000;
          return ageH <= sinceHours;
        });
        results.push(...filtered);
      } catch (e) {
        // skip feed on error
      }
    }
    results.sort((a, b) => b.pubDate - a.pubDate);
    return results;
  }

  // If requesting an arbitrary date window and provider is CryptoPanic, use its API for deeper history
  if (NEWS_PROVIDER === "cryptopanic" && CRYPTOPANIC_TOKEN) {
    const items = await fetchNewsCryptoPanic({ from, to, perPage: Math.max(perFeed, 50), maxPages: 6 });
    return items
      .filter((it) => {
        if (from && to) return it.pubDate >= from && it.pubDate <= to;
        const ageH = (now - it.pubDate.getTime()) / 3600000;
        return ageH <= sinceHours;
      })
      .sort((a, b) => b.pubDate - a.pubDate);
  }

  // CryptoCompare (CoinDesk Legacy docs reference) provider
  if (NEWS_PROVIDER === "cryptocompare") {
    const feedsList = (feeds || [])
      .map((f) => String(f.source || "").toLowerCase())
      .filter((s) => s)
      .map((s) => {
        // Map known sources to CryptoCompare feed names
        if (s.includes("coindesk")) return "coindesk";
        if (s.includes("cointelegraph")) return "cointelegraph";
        return s;
      });
    const items = await fetchNewsCryptoCompare({
      feedsList,
      from,
      to,
      perPage: Math.max(NEWS_PER_PAGE, perFeed * 5),
      maxPages: NEWS_MAX_PAGES,
      sinceHours: sinceHours || NEWS_SINCE_HOURS_DEFAULT,
    });
    return items
      .filter((it) => {
        if (from && to) return it.pubDate >= from && it.pubDate <= to;
        const ageH = (now - it.pubDate.getTime()) / 3600000;
        return ageH <= (sinceHours || NEWS_SINCE_HOURS_DEFAULT);
      })
      .sort((a, b) => b.pubDate - a.pubDate);
  }

  for (const f of feeds) {
    try {
      const feed = await parser.parseURL(f.url);
      const items = (feed.items || [])
        .map((item) => ({
          title: item.title || "",
          link: item.link || item.guid || "",
          pubDate: item.pubDate
            ? new Date(item.pubDate)
            : item.isoDate
            ? new Date(item.isoDate)
            : new Date(),
          source: f.source,
        }))
        .filter((it) => {
          if (from && to) {
            return it.pubDate >= from && it.pubDate <= to;
          }
          const ageH = (now - it.pubDate.getTime()) / 3600000;
          return ageH <= sinceHours;
        })
        .sort((a, b) => b.pubDate - a.pubDate)
        .slice(0, perFeed);

      results.push(...items);
    } catch (e) {
      // skip this feed on error
    }
  }

  results.sort((a, b) => b.pubDate - a.pubDate);
  return results;
}

const COIN_SYNONYMS = {
  BTC: ["BTC", "Bitcoin"],
  ETH: ["ETH", "Ethereum"],
  SOL: ["SOL", "Solana"],
  ADA: ["ADA", "Cardano"],
  XRP: ["XRP", "Ripple"],
  BNB: ["BNB", "Binance"],
  DOGE: ["DOGE", "Dogecoin"],
  AVAX: ["AVAX", "Avalanche"],
  MATIC: ["MATIC", "Polygon"],
  TRX: ["TRX", "Tron"],
};

export function isNewsAboutCoin(item, coin) {
  const title = (item.title || "").toLowerCase();
  const syn = COIN_SYNONYMS[coin] || [coin];
  return syn.some((s) => title.includes(String(s).toLowerCase()));
}

async function fetchNewsCryptoPanic({ coin, from, to, perPage = 50, maxPages = 6 } = {}) {
  if (!CRYPTOPANIC_TOKEN) return [];
  const base = `https://cryptopanic.com/api/v1/posts/?auth_token=${encodeURIComponent(CRYPTOPANIC_TOKEN)}&kind=news&filter=all`;
  const currencyParam = coin ? `&currencies=${encodeURIComponent(coin.toLowerCase())}` : "";
  const items = [];
  let page = 1;
  for (; page <= maxPages; page++) {
    const url = `${base}${currencyParam}&page=${page}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) break;
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      if (!results.length) break;
      for (const r of results) {
        const pub = r.published_at ? new Date(r.published_at) : new Date();
        const item = {
          title: r.title || "",
          link: r.url || r.source?.url || "",
          pubDate: pub,
          source: r.source?.title || "CryptoPanic",
        };
        // stop early if we're before 'from' window
        if (from && item.pubDate < from) {
          return items.sort((a, b) => b.pubDate - a.pubDate);
        }
        if (to && item.pubDate > to) continue;
        items.push(item);
        if (items.length >= perPage * maxPages) break;
      }
      if (items.length >= perPage * maxPages) break;
    } catch (e) {
      break;
    }
  }
  return items.sort((a, b) => b.pubDate - a.pubDate);
}

async function fetchNewsFeedlyForFeed({ feed, perPage = 100, maxPages = 6 } = {}) {
  if (!FEEDLY_TOKEN || !feed || !feed.url) return [];
  const streamId = `feed/${feed.url}`;
  const items = [];
  let continuation = null;
  for (let page = 0; page < maxPages; page++) {
    let url = `https://cloud.feedly.com/v3/streams/contents?streamId=${encodeURIComponent(streamId)}&count=${perPage}`;
    if (continuation) url += `&continuation=${encodeURIComponent(continuation)}`;
    const headers = {
      accept: "application/json",
      authorization: `OAuth ${FEEDLY_TOKEN}`,
    };
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const json = await res.json();
      const arr = Array.isArray(json.items) ? json.items : [];
      if (!arr.length) break;
      for (const it of arr) {
        const title = it.title || "";
        const pubDate = it.published ? new Date(it.published) : new Date();
        let link = "";
        if (Array.isArray(it.alternate) && it.alternate.length) {
          link = it.alternate[0].href || link;
        }
        if (it.canonicalUrl) link = it.canonicalUrl;
        const source = feed.source || (it.origin && it.origin.title) || "Feedly";
        items.push({ title, link, pubDate, source });
      }
      continuation = json.continuation || null;
      if (!continuation) break;
    } catch (e) {
      break;
    }
  }
  return items.sort((a, b) => b.pubDate - a.pubDate);
}

// CryptoCompare Latest News Articles endpoint
// Docs reference: https://developers.coindesk.com/documentation/legacy/News/latestNewsArticlesEndpoint
async function fetchNewsCryptoCompare({ feedsList = [], from, to, perPage = 50, maxPages = 4, sinceHours = 72 } = {}) {
  const items = [];
  const base = "https://min-api.cryptocompare.com/data/v2/news/";
  const headers = { accept: "application/json" };
  if (CRYPTOCOMPARE_API_KEY) headers["Apikey"] = CRYPTOCOMPARE_API_KEY;

  let lTs = undefined; // paginate toward older items
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.set("lang", "EN");
    params.set("sortOrder", "latest");
    if (feedsList.length) params.set("feeds", feedsList.join(","));
    if (lTs) params.set("lTs", String(Math.floor(lTs / 1000))); // seconds

    const url = `${base}?${params.toString()}`;
    let json;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      json = await res.json();
    } catch (e) {
      break;
    }
    const arr = Array.isArray(json?.Data) ? json.Data : [];
    if (!arr.length) break;

    // Normalize items
    const pageItems = [];
    for (const r of arr) {
      const tsSec = typeof r.published_on === "number" ? r.published_on : 0;
      const pubDate = tsSec ? new Date(tsSec * 1000) : new Date();
      const item = {
        title: r.title || "",
        link: r.url || r.guid || "",
        pubDate,
        source: r.source || "CryptoCompare",
        categories: r.categories || "",
        tags: r.tags || "",
      };
      // window filtering
      if (from && item.pubDate < from) {
        // we've reached lower bound; finish current page then stop
        // console.log('skipped old item', item.pubDate, from)
        continue;
      }
      if (to && item.pubDate > to) {
        // newer than upper bound; skip but keep paginating in case we have many newer items
        // console.log('skipped new item', item.pubDate, to)
        // newer than upper bound
        continue;
      }
      pageItems.push(item);
      if (items.length + pageItems.length >= perPage * maxPages) break;
    }
    items.push(...pageItems);

    // Prepare lTs for next page: oldest item timestamp - 1s
    const oldest = arr.reduce((min, r) => {
      const t = (typeof r.published_on === "number" ? r.published_on : 0) * 1000;
      return !min || (t && t < min) ? t : min;
    }, 0);
    if (!oldest) break;
    lTs = oldest - 1000;

    // Stop if we've filled desired volume
    if (items.length >= perPage * maxPages) break;

    // Stop if we have a strict lower bound and next page would be entirely older
    if (from && lTs < from.getTime()) break;
    
    // Stop if no specific date window and we've reached sinceHours
    if (!from && !to) {
      const now = Date.now();
      const hoursOld = (now - lTs) / 3600000;
      if (hoursOld > sinceHours) break;
    }
  }

  return items.sort((a, b) => b.pubDate - a.pubDate);
}
