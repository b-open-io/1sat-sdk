# Recovering swaps

## Where a swap's funds sit

`executeSwap` first stages what it needs into the wallet basket `amm-swap` (`SWAP_BASKET`) with
ONE wallet action (label `amm-swap-stage`, `SWAP_STAGE_LABEL`, when it carries tokens). Legs
spend from that basket; each accepted leg's payout, own commission and change are taken back in
before the next leg. So between staging and the end of a swap, value is in `amm-swap`, not in
the spendable balance. `client.myTokens()` reports it per token as `inSwaps`;
`client.swapBasketSats()` the sats.

## The tools

| call | does |
|---|---|
| `settleSwaps()` | The pass over `amm-swap`: files a staged token output the basket lacks (from its action's description), then reads every row's spender (`GET /amm/spends`) and takes this wallet's legs in. Returns the txids taken in. Never throws. Run it on connect / start. |
| `moveBackTokens(tokenId)` | ONE wallet action: every `amm-swap` row of the token and every sats row back to a fresh key of the wallet's own, submitted to the token's topic. Returns `{txid, amount, beef, submitted, errors}`. |
| `moveBackStagedSats()` | The sats rows alone. |
| `SwapResult.stuck` / phase `stuck` | Rows whose spending transaction the wallet could not take in (`{outpoint, spentBy, error}`). The next `settleSwaps` retries them. |
| `SwapResult.returned` | What a swap that stopped early moved back itself: `{txid, tokens}` or `{error}`. |

## Rules (as the app does it)

1. Before a swap, nothing: `executeSwap` runs the settle pass itself.
2. A swap that RETURNS (any `status`) moved its own leftovers back; read `result.returned`.
   If it is `{error}`, the rows are still in `amm-swap`: the next swap of that token uses them
   first, or call `moveBackTokens(tokenId)`.
3. A swap that THROWS may have left rows staged. Unless `errorKind(e) === "user_rejected"`
   (nothing was staged), call `moveBackTokens(tokenId)`.
4. `no_answer` means a leg may have landed: let `settleSwaps` take it in before moving back.
5. `result.stuck` non-empty: tell the user part of the swap is still being taken in; run
   `settleSwaps()` again in a moment.

## `stop: "no_pool"` with nothing filled

The client excludes a pool after a refusal other than `pool_spent`, or after two unanswered
relays; when none is left the swap stops `no_pool`. Under load that is a busy host, not a bad
swap, and nothing left the wallet beyond what `returned` reports. Offer a retry with a fresh
`tokenPools` read and quote. Do not retry in a tight loop: contention is what caused it.

## A staging tx the network took but the overlay never admitted

Symptom: the staging action is in the wallet's history and on chain, but `settleSwaps` cannot
file it, `moveBackTokens` fails (the overlay does not know the staged outputs), `inSwaps` stays
non-zero. Seen when the hosted front door rate-limited `/submit` (HTTP 500,
`ERR_FRONT_DOOR fuel exhausted`). Fix: fetch the tx's BEEF from the 1sat indexer, submit it
to the token's topic, then settle and move back.

```ts
import { Beef } from "@bsv/sdk";
import { SWAP_STAGE_LABEL, type AmmClient } from "@dcasegr/amm-client";
import type { WalletInterface } from "@bsv/sdk";

export async function resubmitStaging(wallet: WalletInterface, client: AmmClient, origin: string, tokenId: string) {
  const { actions } = await wallet.listActions({ labels: [SWAP_STAGE_LABEL], limit: 1000 });
  for (const a of actions) {
    const res = await fetch(`https://testnet.api.1sat.app/1sat/beef/${a.txid}`);
    if (!res.ok) { console.error("beef", a.txid, res.status); continue; }
    const atomic = Beef.fromBinary(Array.from(new Uint8Array(await res.arrayBuffer()))).toBinaryAtomic(a.txid);
    const sub = await fetch(`${origin}/submit`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-topics": JSON.stringify([`tm_color_${tokenId}`]) },
      body: new Uint8Array(atomic),
    });
    console.error("submit", a.txid, sub.status, (await sub.text()).slice(0, 200)); // STEAK JSON
  }
  console.error("settled", await client.settleSwaps());
  const t = (await client.myTokens()).find((x) => x.tokenId === tokenId);
  if (t && t.inSwaps > 0n) console.error("moved back", await client.moveBackTokens(tokenId));
}
```

The harness narrowed the list to staged token outputs the basket lacks (the client's internal
`unfiledStagedTokens` in `dist/market/activeSwap.js`, not exported), which resubmits fewer
transactions; with the plain label filter above, read each STEAK answer rather than assuming a
resubmit of an admitted transaction is a no-op. The label marks staging actions that carry
tokens; for staged sats alone use `moveBackStagedSats()` after the settle pass.

## Staged sats with no tokens

`swapBasketSats() > 0` and no token `inSwaps`: `moveBackStagedSats()`.

## Checking a row by hand

`GET <origin>/amm/spends?outpoint=<txid>.<vout>,...` → `{outpoint, tokenId?, spentBy?}`. A
staged input with a `spentBy` landed in a leg; the leg's BEEF is at
`GET /@<token>/amm/tx?id=<spentBy>`.
