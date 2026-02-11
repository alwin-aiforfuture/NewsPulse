# Crypto News → Price Direction (LangChain)

This app fetches recent crypto news (CoinDesk, CoinTelegraph) and uses LangChain with an LLM to predict short‑term (e.g., 24h) price direction for selected coins, with confidence and rationale.

## Setup

1. Install deps

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
```

Optionally set `MODEL` (default: `gpt-4o-mini`).
You can also set `OPENAI_BASE_URL` to a custom endpoint (e.g., proxy/Azure/OpenRouter).

If you encounter TLS errors (SELF_SIGNED_CERT_IN_CHAIN), for testing you may set `INSECURE_TLS=true` in `.env` to temporarily disable TLS verification. Prefer installing your proxy CA and using `NODE_EXTRA_CA_CERTS` or proper trust store setup for production.

## Run

Predict for default coins (BTC, ETH, SOL):

```bash
npm start
```

Predict for custom coins:

```bash
npm run predict -- --coins=BTC,ETH,SOL,ADA
```

Yesterday mode (use yesterday's news window and curves):

```bash
npm run yesterday
# or
node index.js --yesterday --coins=BTC,ETH,SOL
```

YTD mode (use YTD curves plus recent news):

```bash
npm run ytd
# or
node index.js --ytd --coins=BTC,ETH,SOL
```

## Notes

- Output is strictly JSON-driven predictions rendered as readable lines.
- This is informational only, not financial advice. Markets are volatile; do your own research.
- Feeds are public RSS metadata; full articles are not fetched.
- Price curves pulled from CoinGecko (UTC window for yesterday).
- Connection troubleshooting:
	- Corporate proxy: set `OPENAI_BASE_URL` to your proxy endpoint.
	- Provide CA: use `NODE_EXTRA_CA_CERTS=/path/to/your-ca.pem` when running `node`.
	- Last resort test: `INSECURE_TLS=true` (not recommended for production).

## CoinGecko Reliability

- The app calls CoinGecko public endpoints. To reduce fetch failures:
	- Add a `USER_AGENT` in `.env` to identify your client.
	- If you have keys, set `COINGECKO_DEMO_API_KEY` or `COINGECKO_API_KEY` (pro).
	- We retry requests and fallback to `market_chart?days=366` for YTD when `range` fails.

## Provider Fallback

- You can choose the price data provider via `.env`:
	- `COIN_PROVIDER=coingecko` (default)
	- `COIN_PROVIDER=binance` (uses `api.binance.com` daily klines in USDT)
- When CoinGecko fails or is rate-limited, we attempt a fallback to Binance automatically for yesterday and YTD curves.

## YTD Comparison

- In `--yesterday` mode, the app also fetches YTD curves per coin and:
	- In `--ytd` mode, YTD curves are fetched even without `--yesterday`.
	- Includes YTD summaries in the LLM context.
	- Prints whether the 24h prediction direction is aligned with the YTD trend.
		- YTD trend thresholds: neutral if |return| < 0.5%; otherwise up/down by sign.
