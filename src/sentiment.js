import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

function getModel() {
  const modelName = process.env.MODEL || "gpt-4o-mini";
  return new ChatOpenAI({
    model: modelName,
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

const schema = z.array(
  z.object({
    ts: z.number(),
    title: z.string(),
    link: z.string().optional().default(""),
    sentiment: z.enum(["bullish", "bearish", "neutral"]),
    confidence: z.number().min(0).max(1).optional().default(0.5),
    reason: z.string().optional().default(""),
  })
);

const parser = StructuredOutputParser.fromZodSchema(schema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are a crypto market analyst. Classify each news item for the given coin as bullish, bearish, or neutral for the next 24 hours.",
      "Focus on the coin-specific impact. If unclear or mixed, choose neutral.",
      "Return a confidence value between 0 and 1 and a concise reason (<= 200 chars) explaining your judgement for each item.",
    ].join(" "),
  ],
  [
    "user",
    [
      "Coin: {coin}",
      "News items (one per line):\n{items}",
      "Follow this structured output format strictly:\n{format_instructions}",
    ].join("\n"),
  ],
]);

export async function classifyNewsItems(coin, items) {
    console.log(`Classifying ${items.length} items for ${coin}...`);
  const lines = items.map((it) => {
    const ts = it.pubDate instanceof Date ? it.pubDate.getTime() : new Date(it.pubDate).getTime();
    return `- ts=${ts} | ${it.title} (${it.source}) ${it.link}`;
  }).join("\n");
  try {
      console.time(`classify:${coin}`);
      const count = items.length;
      console.log(`[sentiment] coin=${coin} items=${count}`);
    const chain = prompt.pipe(getModel()).pipe(parser);
    console.log('invoke')
    const res = await chain.invoke({
      coin,
      items: lines,
      format_instructions: parser.getFormatInstructions(),
    });
      console.timeEnd(`classify:${coin}`);
    const arr = Array.isArray(res) ? res : [];
    return arr.map((o) => {
      const s = String(o.sentiment || "");
      const sentiment = s === "bullish" || s === "neutral" ? s : "bearish";
      return {
        ts: Number(o.ts || 0),
        title: String(o.title || ""),
        link: String(o.link || ""),
        sentiment,
        confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
        reason: String(o.reason || ""),
      };
    });
  } catch (error) {
    console.log(error);
    // Fallback: mark all as neutral
    return items.map((it) => ({
      ts: (it.pubDate instanceof Date ? it.pubDate.getTime() : new Date(it.pubDate).getTime()),
      title: it.title,
      link: it.link,
      sentiment: "neutral",
      confidence: 0.5,
      reason: "fallback neutral",
    }));
  }
}
