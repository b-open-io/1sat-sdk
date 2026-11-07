# Administering an Open Exchange

## Roles

- **root**: the host's key (`SKEIN_KEY_FILE` in `$SKEIN_HOME`). Owns `swap`, every token
  instance and `discovery`. Root passes every gate.
- **admin**: the first wallet to send `claim` (box `amm/claim`). The host grants it the role
  `amm.admin` on `swap`. It configures and enables; it is not root. A second claim is refused:
  to get the admin role back, start again in a fresh `SKEIN_HOME`.
- Read the claim at `GET <origin>/amm/admin` → `{claimant, since}` or `{}`.

The box `amm/admin` is gated by `amm.admin`. Messages are signed by the sending wallet; send
them through the client (each method below), never by hand.

## Messages (swap's app `amm`, box `amm/admin`) and the client calls

Table from the open-exchange 0.17.2 README. "Verified" = run this week through the client.

| message | client call | swap records | event | the host does | verified |
|---|---|---|---|---|---|
| `claim` (box `amm/claim`, any sender, first only) | `claimExchange()` | `{claimant, since}` under `amm/claim` | `claimed {claimant}` | grants `amm.admin` to the claimant | yes |
| `defaults {terms?, market?}` | `setDefaultTerms(t)`, `clearDefaultTerms()`, `setDefaultMarket(minCommissionBps)`, `clearDefaultMarket()` | `amm/defaults` | none | the next `token-enabled` carries them | yes (terms) |
| `terms {tokenId, terms \| null}` | `setTokenTerms(id, t \| null)` | nothing (the instance's `amm/terms` is the record) | `token-terms` | sends root's `terms` to the instance (`amm/validator`); not replayed at start | yes |
| `discovery {on}` | `setDiscovery(on)` | `{on, since}` under `amm/discovery` | `discovery-on` / `-off` | starts / stops `discovery` | yes |
| `enable {tokenId, beef?}` | `enableToken(id)` | row `enabled` under `amm/tokens`, the BEEF kept | `token-enabled {tokenId, beef, terms?, market?}` | creates or starts the instance (below) | yes |
| `disable {tokenId}` | `disableToken(id)` | row `disabled` | `token-disabled` | stops the instance; never removes it | docs |
| `price {sats \| null}` | `setEnablePrice(sats \| null)` | `{sats}` under `amm/enable-price` (read as `enablePriceSats` on `/amm/defaults`) | none | nothing | yes |
| `withdraw` (no args) | `withdrawAll()`, then `settleWithdrawals()` | a BRC-29 payment to the sender, unsent, under `amm/withdrawals` | none | nothing broadcast: the admin's wallet takes it in | docs |

Reads for the admin: `defaults()`, `tokenTerms(id)`, `validatorTerms(id)`, `discoveryState()`,
`exchangeWallet()` (`GET /amm/wallet`: the paid enables' coins), `claimStatus()`, `isRoot(key)`.

## Terms: two spellings

`TermsInput` (what the client takes):

```ts
{ lpBps: 35, validatorBps: 10, commissionBps: 5, minLegSats: 100_000 }
```

The wire and every read (`/amm/defaults`, `/@<token>/amm/terms`, `tokenTerms`) say
`{lpFeeBps, validatorFeeBps, commissionBps, minLegSats}`. Passing the wire names to
`setDefaultTerms` / `setTokenTerms` is a silent mistake. Basis points are integers 0..10000;
`minLegSats` is the validator's minimum leg on the sats side (absent or 0: none).

## The admin sequence (fresh exchange)

Order matters. Run `examples/admin-setup.ts`, or:

```ts
await client.claimExchange();                                    // 1. become admin
await client.setDefaultTerms({ lpBps: 35, validatorBps: 10, commissionBps: 5, minLegSats: 100_000 }); // 2.
await client.setDiscovery(true);                                 // 3. deploys must be indexed
await client.enableToken(tokenId);                               // 4a. admin enable, free
await client.setEnablePrice(100_000_000);                        // 4b. or sell listings (sats; null = off)
```

- Set terms BEFORE enabling. A token enabled with no terms answers `validatorTerms` with no
  validator (`hasTerms(t) === false`, text "This exchange validates nothing: no terms are set.")
  and refuses pool deploys. Fix an already-enabled token with `setTokenTerms(id, terms)`.
- `enableToken` finds the deploy BEEF in the wallet (the deployer's basket) else at
  `/@discovery/1color/<token>/deploy`, so discovery must be on and have seen the deploy.

## What `token-enabled` does on the host (docs)

New token: create instance `<tokenId>` from image `token` (disabled) → record its names
`[tm_color_<id>, ls_color_<id>, ls_amm_<id>]` → feed the deploy BEEF into `amm/deploy` (the door
checks it) → if admitted, publish the instance → send `terms` into `amm/validator` and `market`
into `amm/amm-p2p` as root. A refused deploy: the instance is removed (file store) or left
disabled (SQLite/RocksDB/LMDB set). Existing instance: a stopped one is started; one with no
token gets its deploy fed in. Every reaction is idempotent. At start the host reconciles its
instance table with swap's `amm/tokens` and `amm/discovery` heads.

## The paid enable (any signed wallet)

`enableTokenPaid(tokenId, {deployBeef?})` does it all: reads `enablePriceSats` from
`/amm/defaults`, builds a BRC-29 payment to the exchange as a protected noSend (BRC-177 label
`p nosend expiry seconds 600`: the wallet reclaims it if nobody sends it in 600 s), puts the
deploy and payment in ONE BEEF, and `POST`s `/amm/enable?tokenId=&paymentTxid=&paymentVout=&
derivationPrefix=&derivationSuffix=` signed (BRC-104). The exchange internalizes the payment,
which broadcasts it. On any refusal the client aborts the unsent payment (`abortAction`).
Wallet prompts: one for the BRC-177 label, one for the spend. Cost: the price plus two small
fees. The hosted testnet price is 1 BSV (`enablePriceSats` 100000000). Default terms apply.

Refusals arrive as `ClientError` kind `refused`, message `"<CODE>: <text>"`:

| code | status | meaning |
|---|---|---|
| `ERR_PAID_ENABLE_OFF` | 403 | no price set; only the admin enables |
| `ERR_BAD_REQUEST` | 400 | no `tokenId` |
| `ERR_TOKEN_ENABLED` | 409 | already listed |
| `ERR_TOKEN_DISABLED` | 409 | the admin disabled it; only the admin re-enables |
| `ERR_BAD_DEPLOY` | 400 | the BEEF holds no deploy of that token |
| `ERR_PAYMENT_REQUIRED` | 402 | no payment named or not in the BEEF (`satoshisRequired`) |
| `ERR_PAYMENT_TOO_SMALL` | 402 | under the price (`satoshisRequired`): re-read the price |
| `ERR_PAYMENT_REPLAYED` | 409 | the exchange already holds that payment |
| `ERR_INVALID_PAYMENT` | 400 | the output does not pay the key derived for the signer |
| `ERR_BEEF` | — | the deploy BEEF did not verify (the `kernel.beef` filter; seen in the app's map) |

Parse the code: `/^([A-Z_]+):\s*(.*)$/s.exec(e.message)`.

## Upgrading a host (docs)

`npx open-exchange@<newer> run` (or `npm install -g open-exchange@latest`), then restart. At
start the host installs the packaged swap app into `swap` as root when its version differs, so
the pages follow the package.
