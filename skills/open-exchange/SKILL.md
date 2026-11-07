---
name: open-exchange
description: "This skill should be used when building against, operating, or testing an Open Exchange — the 1Color token AMM host (npm `open-exchange`, client `@dcasegr/amm-client`, engine `@dcasegr/amm-engine`), on testnet at testnet.openex.dev. Use it to read AMM market data (pools, prices, trades, candles, holders), run a token swap or a pool deploy/close/rebalance through a BRC-100 wallet with the 1Color module, list a token (paid or admin enable), run and administer a local exchange (claim, terms, discovery), drive a headless wallet for load tests, or recover stuck swap rows. Triggers on 'Open Exchange', 'openex', 'testnet.openex.dev', 'amm-client', 'amm-engine', '1Color swap', 'AMM pool', 'executeSwap', 'quoteSwap', 'deployPosition', 'enableToken', 'enableTokenPaid', 'list a token on the exchange', 'claim the exchange', 'setDefaultTerms', 'moveBackTokens', 'settleSwaps', 'stuck swap', 'pool_spent', 'no_pool', or 'npx open-exchange'."
disable-model-invocation: false
---

# Open Exchange

The Open Exchange is a skein application host for 1Color (BRC-162, BRC-207) token swaps. Each
liquidity provider owns separate constant-product pools; a validator signs each swap leg; the
host relays legs and serves a public read API. Testnet only today: the hosted exchange is
`https://testnet.openex.dev`.

Token ids are `<txid>_<vout>` (`_0` for 1Color). A pool's id is its deploy outpoint
`<txid>_<vout>` and never changes; its `outpoint` is the current output and changes every swap.
Amounts are bigints in base units; prices are `{sats, tokens}` pairs.

## The three protocols

| what | how | auth |
|---|---|---|
| Reads | Plain `GET`s: `/amm/*` (host-wide), `/@<token>/amm/*` (per token), `/@discovery/1color/*`. SSE feeds `/amm/events`, `/@<token>/amm/events` | none |
| Overlay writes | `POST /submit` (BRC-22, header `x-topics: ["tm_color_<id>"]`, AtomicBEEF body) and `POST /lookup` (BRC-24, service `ls_color_<id>`). The swap relay `POST /@<token>/amm/swap` | none |
| Admin and paid enable | Messages signed by the wallet (BRC-104) to the `swap` instance: claim, terms, discovery, enable, price, withdraw. `POST /amm/enable` for the paid listing | wallet signature |

Use `@dcasegr/amm-client` for all three. Hand-roll only reads and the overlay provider.

## Quick start: read-only (no wallet)

```ts
import { createClient, pairPrice } from "@dcasegr/amm-client"; // 0.44.3
const client = createClient({ origin: "https://testnet.openex.dev", wallet: null });
const tokens = (await client.enabledList()).filter((t) => t.status === "enabled");
const stats = await client.statsAll();                 // ONE GET /amm/stats; poll every 30 s
const t = tokens[0];
const s = stats.find((x) => x.tokenId === t.tokenId);
console.log(t.sym, s?.price && pairPrice(s.price, t.dec), "sats/token, tvl", s?.tvlSats);
const pools = await client.tokenPools(t.tokenId);      // {market, pools, validators}
const { trades } = await client.trades(t.tokenId, { limit: 20 });   // newest first
```

Other reads: `candles(id, {tf, from, to, series: "market"})` (`market` = the mid, chart this),
`holders(id, {limit})`, `stats(id)`, `poolsAt(id, t)`, `poolHistory(id, …)`,
`positionsAll(poolIds)`, `spendsAll(outpoints)`, `watchPoolEvents(id | "all", onEvent)`. The
event feeds are signals only (nothing replayed): on an event, re-read `tokenPools` and
`statsAll({ids})`. Legs of one order share `payoutPkh` on trade rows: group by it.
`examples/read-market.ts` is the runnable version. Routes: `references/api.md`.

## Quick start: a swap with a connected wallet

```ts
import { createClient, errorKind, type SwapProgress } from "@dcasegr/amm-client";
const client = createClient({ origin, feeRateSatsPerKb: 100, wallet }); // wallet: BRC-100 + color module
const pools = await client.tokenPools(tokenId);        // read FRESH right before quoting
const quote = client.quoteSwap(
  { tokenId, side: "buy", amountIn: 200_000n, maxSlippageBps: 100, maxSources: 1 },
  pools, { sym, dec },
);
if (quote.legs.length === 0) throw new Error("no pool fills this (slippage or minLegSats)");
const ac = new AbortController();                      // abort: stops before the next leg
try {
  const r = await client.executeSwap(quote, { signal: ac.signal, onProgress: (p: SwapProgress) => show(p) });
  // r: {status: filled|partial|failed, stop, legs, totalIn, totalOut, unfilled, returned?, stuck?}
} catch (e) {
  if (errorKind(e) !== "user_rejected") await client.moveBackTokens(tokenId); // a throw may leave rows staged
}
```

`maxSources` is required: the most pools the order may draw on (1 = exactly one leg; the pages
send 1 or 5). `quote.stage` is what gets reserved: the amount plus fee sats for `maxSources`
legs. One swap per client at a time. `examples/swap.ts` runs this headless.

### Progress phases and what to show

| phase | meaning | show |
|---|---|---|
| `staging` `{sats, tokens}` | ONE wallet action reserves funds into `amm-swap` | "Approve in your wallet" |
| `relaying` `{leg, amountIn, amountOut, filled}` | a leg is at the host's relay (up to 15 s) | pool N of the order; offer Stop |
| `repricing` | the leg got `pool_spent`; fresh pools, priced again | "price refreshed" |
| `returning` `{filled}` | stopped early; unfilled rows moving back | "returning the rest" |
| `stuck` `{rows}` | a spender the wallet could not take in yet | "still being received; check shortly" |
| `done` `{result}` / `failed` `{result?, error?}` | end | outcome, legs with txids, `stop` reason |

`stop`: `filled`, `cancelled` (aborted), `floor` (next leg breaks slippage), `min` (rest below
the validator's minimum leg), `no_pool` (every pool excluded), `fees` (rest cannot cover the
miner fee). `ClientError.kind`: `stale_pool`, `fee_mismatch`, `quote_mismatch`, `slippage`,
`pool_spent`, `user_rejected`, `no_answer`, `below_minimum`, `refused`, `network`; classify any
error with `errorKind(e)`.

## Wallet requirements

The wallet must be BRC-100 and carry the BRC-207 1Color permission module
(`@bsv/color-permission-module`) for every token action. Peers `@bsv/sdk` 4,
`@1sat/templates`, the color module: ONE copy each, the wallet's.

- **Browser**: `@1sat/react` `WalletProvider` + `useWallet()` → `wallet` (Yours exposes BRC-100
  as `window.CWI`; it runs the module). Pass `wallet` to `createClient` or
  `readClient.withWallet(wallet)`, which keeps the reads already made. Force one copy with
  package.json `overrides`: `"@1sat/actions": "0.1.5"`,
  `"@bsv/color-permission-module": "npm:@bopen-io/color-permission-module@0.2.2"`.
- **Headless (Bun)**: toolbox wallet from `@1sat/wallet-node` (bun-sqlite) + the hex shim +
  `LocalWalletPermissionsManager` with the REAL module under `color` + an admin-originator
  proxy. Needs THREE overrides: the two above plus
  `"@bsv/wallet-toolbox-client": "npm:@bopen-io/wallet-toolbox-client@2.15.3"`. Full recipe and
  funding: `references/wallet-headless.md`; code: `examples/headless-wallet.ts`.

## Pools and listing

- **Terms first**: `await client.validatorTerms(tokenId)`; `hasTerms(t)` false means no
  validator, and deploys are refused. Fees are the validator's (LP accepts them; no fee input).
- **Deploy**: `deployPosition({tokenId, tokens, sats})` → `{outpoint, txid, warnings?}`. Pool id
  = `outpoint.replace(".", "_")`. One pool per deploy; no top-up, no partial withdraw.
- **Close**: `closePosition({outpoint})` → `{txid, sats, tokens}` back to the wallet.
- **Rebalance**: `rebalancePosition({outpoint, tokens, sats})` closes and redeploys in ONE
  wallet action. On an unknown failure, fall back to close then deploy.
- **Positions**: `myPositions()` (fees earned, `rescinded`, `closed`).
- **Size**: keep each pool's sats well above the validator's `minLegSats` (100000 on the hosted
  testnet validator today; read it, do not hardcode). Swaps under it fail `below_minimum`.
- **Deploy a token**: `deploy1Color.execute(ctx, {amount, decimals, symbol, icon?})` from
  `@1sat/actions` → `assetId` (the token id).
- **List it, paid**: `enableTokenPaid(tokenId, {deployBeef})` (deploy BEEF from
  `client.deployBeef(tokenId, wallet)`). Price = `enablePriceSats` on `GET /amm/defaults`
  (1 BSV on hosted testnet; null = not sold). Refusals are `ClientError` `refused` with
  `"ERR_…: text"`; codes in `references/admin-messages.md`.
- **List it, admin**: `enableToken(tokenId)`, free.

## Running and administering a local exchange

```bash
SKEIN_HOME=$PWD/.skein-openex SKEIN_NETWORK=test npx -y open-exchange@0.17.2 run   # Node 24+
# -> http://localhost:8100 (pages at /, reference at /api/). First run syncs headers: minutes.
```

The first run writes `host.env`, the host key (root of every instance), `swap` and `discovery`.
Then, with the admin wallet (`examples/admin-setup.ts`, `origin: "http://localhost:8100"`):

1. `claimExchange()`: the first claimant becomes admin (`amm.admin`); a second is refused.
2. `setDefaultTerms({lpBps, validatorBps, commissionBps, minLegSats})` BEFORE any enable.
3. `setDiscovery(true)`: deploys must be indexed for enables and pools.
4. `enableToken(tokenId)` (admin, free), or `setEnablePrice(sats)` to sell listings.

`examples/local-exchange.sh` starts the host, waits, and prints the status reads. The message
table, roles and terms naming: `references/admin-messages.md`.

## Recovery

- Run `settleSwaps()` on start/connect: files staged rows and takes in landed legs.
- A swap that returns moved its own leftovers (`result.returned`); if that is `{error}` or the
  swap threw, `moveBackTokens(tokenId)`. Staged sats alone: `moveBackStagedSats()`.
- `stop: "no_pool"` with no legs: busy host, nothing sent; offer a retry with a fresh quote.
- `myTokens()[i].inSwaps > 0` that settle and move back cannot clear: the staging tx was never
  admitted. Fetch its BEEF from `https://testnet.api.1sat.app/1sat/beef/<txid>`, `POST /submit`
  to `tm_color_<id>`, then settle and move back. Code: `references/recovery.md`.

## Load and scale

- The exchange serializes ONE leg in flight per pool. A second leg on the same pool gets
  `pool_spent` and is repriced against the new state.
- Uncontended, a pool takes about one leg per 2.5 s. Contention amplifies: every concurrent
  taker on a pool adds reprices and relays, so throughput per pool drops as takers rise. Spread
  load over pools (`maxSources` > 1, more pools) rather than more takers per pool.
- A leg waits 15 s (`LEG_PATIENCE_MS`) for the relay. After a non-`pool_spent` refusal, or two
  unanswered relays, the client excludes that pool; with none left the swap stops `no_pool`.
- One swap at a time per wallet: run one process per wallet for parallel load.
- A leg's tx is about 13 kB (about 1,300 sats at 100 sat/kB).

## Traps

- **bun-sqlite scripts** (b-open-io/1sat-sdk#99): `listOutputs` returns `lockingScript` as
  `Uint8Array`; the client sees no sats and stops `fees`. Apply the hex shim.
- **Toolbox spend check**: upstream `@bsv/wallet-toolbox-client` rejects module-added inputs;
  alias to `@bopen-io/wallet-toolbox-client@2.15.3`.
- **Two copies** of `@1sat/actions` or the color module break token actions: use overrides.
- **No terms**: a token enabled before terms answers validator null and refuses deploys. Set
  defaults first, or `setTokenTerms` after.
- **TermsInput names** are `lpBps`/`validatorBps`; the wire and reads say
  `lpFeeBps`/`validatorFeeBps`.
- **Discovery off**: deploys do not index; enables cannot find the deploy BEEF.
- **Fresh host**: `/amm/*` answers empty for a moment after start; re-read before concluding.
- **Front door rate limit** on hosted testnet: `ERR_FRONT_DOOR fuel exhausted`, HTTP 500 on
  `/submit`. Back off; then check for unadmitted staging txs (Recovery).
- **Paid listing** costs 1 BSV on hosted testnet; the payment is a protected noSend the
  wallet reclaims after 600 s if refused.
- **Stale pools**: never quote from a cached pools answer; `tokenPools` right before
  `quoteSwap` (the client re-reads before each leg itself).
- **Funding**: the 1sat testnet indexer credits a plain send in about a minute
  (`GET https://testnet.api.1sat.app/1sat/owner/<address>/balance`); then sweep with
  `syncAddresses` from `@1sat/actions`.

## Versions (as of 2026-11-07)

| package | version |
|---|---|
| `open-exchange` | 0.17.2 published; 0.18.0 on `main` (OpenAPI doc version) |
| `@dcasegr/amm-client`, `@dcasegr/amm-engine` | 0.44.3 (pin both to the same version) |
| `@1sat/actions` | 0.1.5 |
| `@bsv/color-permission-module` → `@bopen-io/color-permission-module` | 0.2.2 |
| `@bsv/wallet-toolbox-client` → `@bopen-io/wallet-toolbox-client` (headless) | 2.15.3 |
| `@bsv/sdk` | 4.0.1 |

The client and pages track skein-amm releases; re-check the host's `/api/openapi.json` and the
client README after an upgrade.

## Related skills

- `tokens`: `deploy1Color` / `send1Color` and the 1Color baskets.
- `wallet-setup`: `createNodeWallet` options and storage.
- `permission-module`: hosting `permissionModules` on `WalletPermissionsManager`.
- `dapp-connect`: connecting a browser dApp to a wallet.

## Additional resources

### Reference files

- **`references/api.md`**: the 37 routes by tag, query params, cache classes, answer shapes,
  the swap relay, the overlay write formats.
- **`references/openapi.json`**: the full OpenAPI 3.1 spec (search with `jq`; do not load whole).
- **`references/admin-messages.md`**: roles, the admin message table and client calls, terms
  naming, the host's enable reaction, the paid enable and its refusal codes.
- **`references/wallet-headless.md`**: the headless wallet recipe with the overlay provider,
  the hex shim, the three overrides, and funding.
- **`references/recovery.md`**: staged funds, settle/move back rules, `no_pool`, resubmitting an
  unadmitted staging tx.

### Examples (Bun; `bun install` in `examples/`, versions pinned with overrides)

- **`examples/read-market.ts`**: token list with prices, or one token's pools, trades, candles,
  holders.
- **`examples/swap.ts`**: one swap through a headless wallet, every phase printed.
- **`examples/admin-setup.ts`**: claim, default terms, discovery, enable or price.
- **`examples/local-exchange.sh`**: start a local testnet exchange and print its status.
- **`examples/headless-wallet.ts`**: the wallet bootstrap the TypeScript examples import.
