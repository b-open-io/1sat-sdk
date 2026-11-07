# Open Exchange read API

The route table of `references/openapi.json` (OpenAPI 3.1, document version 0.18.0 from
open-exchange `main`; published 0.17.2 serves the same 37 routes). The live copy of the spec is
`<origin>/api/openapi.json`; the rendered reference page is `<origin>/api/`. Default server:
`https://testnet.openex.dev`.

Search the JSON instead of loading it whole:

```bash
jq '.paths["/@{token}/amm/pools"].get' references/openapi.json        # one operation
jq '.components.schemas | keys' references/openapi.json                # schema names
jq '.paths | to_entries[] | select(.value.get.tags[0]=="history") | .key' references/openapi.json
```

## Conventions (from the spec)

- Plain HTTP GETs, JSON unless a route says bytes. List parameters are comma-separated and
  answered one record per key, in query order.
- `{token}` is a token id `<txid>_<vout>` (`_0` for a 1Color token). A token's routes live under
  its instance: `/@<token>/amm/...`. A pool id is the pool's deploy outpoint `<txid>_<vout>`; a
  pool's `outpoint` is its CURRENT output and changes on every swap.
- Amounts and prices are integers in base units. A price is a pair `{sats, tokens}`; sats per
  whole token = `sats * 10^dec / tokens` (`pairPrice` in the client). `change1h` / `change24h`
  are basis points.
- Cache classes (`x-cache` on each operation): `state` = `public, max-age=5`; `imm` = immutable,
  only for bytes of a proven transaction; `stream` = `text/event-stream`; some host reads send no
  `Cache-Control`.
- Writes are NOT on this API: overlay `POST /submit` (BRC-22, header `x-topics`) and
  `POST /lookup` (BRC-24), signed admin messages (`/sendMessage`, `/call`, via the client), the
  swap relay and the paid enable below.

## Routes (37, 8 tags)

"Used" marks routes exercised live this week through the client, the app or the headless
harness; the rest are from the spec and README (docs, not individually exercised).

| tag | method | path | query (`*` required) | cache | used | summary |
|---|---|---|---|---|---|---|
| pools | GET | `/amm/pools` | | state | | Every enabled token's live pools |
| pools | GET | `/amm/events` | | stream | yes | Every enabled token's pool events (SSE `event: pool`, `{tokenId, ...row}`; nothing replayed) |
| pools | GET | `/@{token}/amm/pools` | | state | yes | Live pools, `market`, beating `validators` (each `minLegSats`) |
| pools | GET | `/@{token}/amm/events` | | stream | | One token's pool events |
| pools | GET | `/@{token}/amm/pools/beef` | pool | state | yes | Current pools with one BEEF (by pool id) |
| pools | GET | `/@{token}/amm/terms` | | state | yes | Validator terms (`lpFeeBps`, `validatorFeeBps`, `commissionBps`, `minLegSats`) and market |
| history | GET | `/amm/stats` | ids | state | yes | Every enabled token's stats, one array |
| history | GET | `/amm/positions` | pool* | state | | Positions across tokens by pool id |
| history | GET | `/@{token}/amm/pools/at` | t* | state | | Every pool listed at time `t` |
| history | GET | `/@{token}/amm/pools/history` | from, to, pool, limit, after | state | | Raw pool history, oldest first, paged by `next` |
| history | GET | `/@{token}/amm/trades` | from, to, limit, before, pool, txid | state | yes | Trades newest first (`poolId`, `payoutPkh`) |
| history | GET | `/@{token}/amm/candles` | tf*, from*, to*, series | state | yes | `series=fill` (default) or `market` (the mid; use this for charts) |
| history | GET | `/@{token}/amm/stats` | | state | yes | `price` (mid), `buyPrice`, `sellPrice`, `lastTradePrice`, 24 h volume, TVL |
| history | GET | `/@{token}/amm/color/{tokenId}/holders` | limit, skip | state | yes | Holder count and balances, largest first |
| fees | GET | `/@{token}/amm/positions` | pool* | state | yes | Positions by pool id (with LP fees) |
| fees | GET | `/@{token}/amm/fees/validator` | id* | state | | Validator fees by identity key |
| fees | GET | `/@{token}/amm/fees/commission` | pkh* | state | | Commissions by pkh |
| chain | GET | `/amm/spends` | outpoint* | state | yes | `{outpoint, tokenId?, spentBy?}` per outpoint |
| chain | GET | `/@{token}/amm/spends` | outpoint* | state | | One token's spends |
| chain | GET | `/@{token}/amm/tx` | id* | imm / state | yes | A transaction's BEEF |
| host, swaps | POST | `/@{token}/amm/swap` | | none | yes | The swap relay: one leg to its validator |
| tokens | GET | `/@{token}/amm/token` | | none | | The instance's token |
| tokens | GET | `/amm/tokens` | | none | yes | The exchange's list `[{tokenId, topic, sym, dec, status, since, iconUrl}]` |
| tokens | GET | `/@discovery/1color/tokens` | ids, q, after, limit, skip | state | yes | Discovery's 1Color list (`amount`, `height`); `q` = symbol/id prefix |
| tokens | GET | `/@discovery/1color/{token}` | | state | | One listed token |
| tokens | GET | `/@discovery/1color/{token}/icon` | | imm / state | yes | Icon bytes |
| tokens | GET | `/@discovery/1color/{token}/deploy` | | imm / state | yes | Deploy BEEF (what `enableToken` falls back to) |
| host | GET | `/.well-known/skein` | | none | yes | Instance card (the exchange's identity key) |
| host | GET | `/skeins` | key* | none | | Instances a key holds root on |
| host | GET | `/amm/admin` | | none | yes | `{claimant, since}` or `{}` |
| host | GET | `/amm/defaults` | | none | yes | `{terms?, market?, enablePriceSats}` |
| host | GET | `/amm/discovery` | | none | yes | `{on, since}` |
| host | POST | `/amm/enable` | tokenId*, paymentTxid*, paymentVout*, derivationPrefix*, derivationSuffix* | none | yes | Paid enable (BEEF body, BRC-104 signed) |
| host | GET | `/amm/wallet` | | none | | `{sats, outputs, withdrawals}` of the exchange's wallet |
| host | GET | `/amm/wallet/tx` | n* | none | | Withdrawal n's Atomic BEEF |
| docs | GET | `/api/openapi.json` | | pages | yes | This document |
| docs | GET | `/api/` | | pages | yes | The reference page |

## Answer shapes worth knowing

```jsonc
// GET /@<token>/amm/pools  (illustrative values)
{ "market": { "commissionPkh": "<hash160 hex>", "minCommissionBps": 0 },
  "validators": [{ "identity": "<pubkey>", "peerId": "16Uiu2...", "minLegSats": 100000 }],
  "pools": [{ "poolId": "<deploy txid>_0", "outpoint": "<current txid>_0", "lpPubKey": "...",
              "bsvReserve": 104207588, "tokenReserve": 479811567, "liquidityFeeBps": 35,
              "validationFeeBps": 10, "commissionBps": 5, "validatorIdentityKey": "...",
              "validatorPeerId": "...", "swaps": 54 }] }

// GET /amm/spends?outpoint=a.1,b.2
[{ "outpoint": "a.1", "tokenId": "<id>", "spentBy": "<txid>" }, { "outpoint": "b.2" }]
```

## The swap relay (`POST /@<token>/amm/swap`)

Use the client (`executeSwap`); do not hand-build legs. Facts from the spec and README (docs):
plain (no BRC-104 session); the host checks ONE rule, that the leg's commission pays this
exchange's key (`commission_missing` otherwise); everything else is the validator's. Answers:
`{ok: true, tx, txid, beef?}` / `{ok: false, reason, detail?, pool?, beef?}` /
`{ok: false, reason: "unreachable", detail}`. The client's request close is the only timer
(`LEG_PATIENCE_MS` = 15 s). 0.18.0 on `main` (not in 0.17.2): transactions the token's topic
already admitted go by txid alone in the BEEF; an unknown txid-only entry is `submit_refused`.

## Overlay writes (verified)

```http
POST <origin>/lookup
content-type: application/json
{"service":"ls_color_<assetId>","query":{"type":"color-spendability"|"color-admission",
 "version":1,"assetId":"<assetId>","topic":"tm_color_<assetId>","outpoints":["<txid>.<vout>"]}}

POST <origin>/submit
content-type: application/octet-stream
x-topics: ["tm_color_<assetId>"]
<AtomicBEEF bytes>          -> STEAK JSON
```

Topic and lookup names are derived, never typed: `topicOf(id)` = `tm_color_<id>`,
`lookupOf(id)` = `ls_color_<id>`, `ammLookupOf(id)` = `ls_amm_<id>`.
