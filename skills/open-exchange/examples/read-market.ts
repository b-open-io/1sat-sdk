#!/usr/bin/env bun
/**
 * Read-only market data from an Open Exchange. No wallet.
 *   bun read-market.ts                 # every enabled token, with price and TVL
 *   bun read-market.ts <txid>_0        # one token: pools, trades, candles, holders
 * OPENEX_ORIGIN overrides the exchange (default https://testnet.openex.dev).
 */
import { createClient, pairPrice } from "@dcasegr/amm-client";

const origin = (process.env.OPENEX_ORIGIN || "https://testnet.openex.dev").replace(/\/+$/, "");
const client = createClient({ origin, wallet: null });
const show = (v: unknown) =>
  console.log(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

const list = (await client.enabledList()).filter((t) => t.status === "enabled");
const stats = await client.statsAll(); // ONE GET /amm/stats; poll it (the app: every 30 s)
const statsOf = new Map(stats.map((s) => [s.tokenId, s]));
const tokenId = process.argv[2];

if (!tokenId) {
  show(
    list.map((t) => {
      const s = statsOf.get(t.tokenId);
      return {
        sym: t.sym,
        tokenId: t.tokenId,
        // Price is a {sats, tokens} pair in base units; pairPrice gives sats per WHOLE token.
        priceSatsPerToken: s?.price ? pairPrice(s.price, t.dec) : null,
        change24hBps: s?.change24h ?? null,
        tvlSats: s?.tvlSats ?? 0n,
        pools: s?.pools ?? 0,
      };
    }),
  );
} else {
  const meta = list.find((t) => t.tokenId === tokenId);
  if (!meta) throw new Error(`${tokenId} is not enabled on ${origin}`);
  const now = Date.now();
  const [pools, trades, candles, holders] = await Promise.all([
    client.tokenPools(tokenId), // what a swap may use now: market, pools, beating validators
    client.trades(tokenId, { limit: 5 }), // newest first; legs of one order share payoutPkh
    client.candles(tokenId, { tf: "1h", from: now - 86_400_000, to: now, series: "market" }),
    client.holders(tokenId, { limit: 5 }),
  ]);
  show({
    token: { sym: meta.sym, dec: meta.dec, tokenId },
    stats: statsOf.get(tokenId) ?? null,
    market: pools.market,
    validators: pools.validators, // each with minLegSats when its terms carry one
    pools: pools.pools.map((p) => ({
      poolId: p.poolId, // the deploy outpoint, <txid>_<vout>: stable for the pool's life
      outpoint: p.outpoint, // the current output: changes on every swap
      sats: p.bsvReserve,
      tokens: p.tokenReserve,
      swaps: p.swaps,
    })),
    trades: trades.trades,
    candles: candles.length,
    holders,
  });
}
