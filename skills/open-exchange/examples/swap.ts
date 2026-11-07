#!/usr/bin/env bun
/**
 * One swap through a headless wallet (headless-wallet.ts), printing every progress phase.
 *   WIF=<testnet wif> bun swap.ts <tokenId> buy|sell <amount in base units> [maxSources=1] [slippageBps=100]
 * Buy: <amount> is sats paid. Sell: token base units paid. Wallet data in .data/<identity prefix>/.
 * Exit 0 filled, 2 partial, 1 failed.
 */
import { createClient, errorKind, type SwapProgress } from "@dcasegr/amm-client";
import { exchangeOrigin, loadWallet } from "./headless-wallet.ts";

const [tokenId, side, amount, sources = "1", slip = "100"] = process.argv.slice(2);
if (!tokenId || (side !== "buy" && side !== "sell") || !amount || !process.env.WIF) {
  console.error("usage: WIF=<wif> bun swap.ts <tokenId> buy|sell <base units> [maxSources] [slippageBps]");
  process.exit(1);
}
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

const w = await loadWallet({ wif: process.env.WIF, dir: `.data/${process.env.WIF.slice(0, 8)}` });
const client = createClient({ origin: exchangeOrigin(), feeRateSatsPerKb: 100, wallet: w.wallet });
let code = 1;
try {
  const meta = (await client.enabledList()).find((t) => t.tokenId === tokenId);
  if (!meta) throw new Error(`${tokenId} is not enabled on ${exchangeOrigin()}`);
  // Quote against the pools as the host answers NOW (never a cached copy).
  const pools = await client.tokenPools(tokenId);
  const quote = client.quoteSwap(
    { tokenId, side, amountIn: BigInt(amount), maxSlippageBps: Number(slip), maxSources: Number(sources) },
    pools,
    { sym: meta.sym, dec: meta.dec },
  );
  console.log("quote", j({ legs: quote.legs.length, amountOut: quote.amountOut, min: quote.minAmountOut, impactBps: quote.impactBps, stage: quote.stage }));
  if (quote.legs.length === 0) throw new Error("no pool can fill this within the slippage (or below the validator's minLegSats)");

  const onProgress = (p: SwapProgress) => {
    switch (p.phase) {
      case "staging": // ONE wallet action reserves sats (and tokens on a sell) in amm-swap
        return console.log("staging", j({ sats: p.sats, tokens: p.tokens }));
      case "relaying": // a leg sent to the host's relay; up to 15 s (LEG_PATIENCE_MS)
      case "repricing": // the leg was refused pool_spent: fresh pools, priced again
        return console.log(p.phase, j({ pool: p.leg, in: p.amountIn, out: p.amountOut, filled: p.filled.length }));
      case "returning": // stopped early: unfilled rows moving back to the wallet
        return console.log("returning", j({ filled: p.filled.length }));
      case "stuck": // rows whose spender the wallet could not take in yet: settleSwaps retries
        return console.log("stuck", j(p.rows));
      case "done":
        return console.log("done", p.result.status, p.result.stop);
      case "failed":
        return console.log("failed", p.error?.message ?? p.result?.stop);
    }
  };
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort()); // stops BEFORE the next leg (stop "cancelled")
  const r = await client.executeSwap(quote, { onProgress, signal: ac.signal });
  console.log("result", j(r));
  code = r.status === "filled" ? 0 : r.status === "partial" ? 2 : 1;
} catch (e) {
  console.error("swap threw:", errorKind(e) ?? "error", e instanceof Error ? e.message : e);
  // A swap that stops on its own moves leftovers back itself; one that THROWS may leave rows staged.
  if (errorKind(e) !== "user_rejected") {
    const m = await client.moveBackTokens(tokenId).catch((x) => ({ error: String(x) }));
    console.error("moveBackTokens", j(m));
  }
} finally {
  await w.destroy();
}
process.exit(code);
