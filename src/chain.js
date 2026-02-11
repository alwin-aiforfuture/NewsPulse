import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";


const parser = new JsonOutputParser();

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are a crypto market analyst.",
      "Given recent news headlines/links, yesterday's price curves, and YTD curves, predict short-term (24h) price direction for each requested coin.",
      "Only use the provided context; if insufficient, output 'neutral' with low confidence.",
      "Return STRICT JSON array where each object has: coin, direction ('up'|'down'|'neutral'), confidence (0..1), rationale, horizon_hours.",
    ].join(" "),
  ],
  [
    "user",
    [
      "Coins: {coins}",
      "News items:\n{news}",
      "Yesterday curves:\n{curves}",
      "YTD curves:\n{ytd}",
      "Constraints:",
      "- Base reasoning only on listed items.",
      "- Consider regulatory, hacks, partnerships, macro signals, and technical momentum from curves (yesterday + YTD).",
      "Output: JSON only, no extra commentary.",
    ].join("\n"),
  ],
]);

function getModel() {
  const modelName = process.env.MODEL || "gpt-4o-mini";
  const opts = {
    model: modelName,
    temperature: 0.2,
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  };
  return new ChatOpenAI(opts);
}

export async function predictFromNews(coins, news, { horizonHours = 24, curvesText = "", ytdCurvesText = "" } = {}) {
  const newsText = news
    .map(
      (n) => `- ${n.title} (${n.source}, ${n.pubDate.toISOString()}) ${n.link}`
    )
    .join("\n");

  const chain = prompt.pipe(getModel()).pipe(parser);
  const raw = await chain.invoke({
    coins: coins.join(", "),
    news: newsText,
    curves: curvesText,
    ytd: ytdCurvesText,
    horizon_hours: horizonHours,
  });

  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((o) => ({
    coin: String(o.coin || "").toUpperCase(),
    direction: o.direction || "neutral",
    confidence: Number(o.confidence ?? 0),
    rationale: o.rationale || "",
    horizon_hours: Number(o.horizon_hours ?? horizonHours),
  }));
}
