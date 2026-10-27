# Plan: testnet wiring

Status: **In Progress**
Date: 2026-10-07

Repos at research time: yours-wallet `v5.1.1` (`3c88f68`), 1sat-sdk `20947539`. SDK working tree has an unrelated client diff (`parseOutpoint` + `@1sat/utils`). Do not mix that into this work.

## Invariant

P2PKH scripts store a 20-byte hash. The prefix byte only exists in the printed address (`0x00` mainnet `1…`, `0x6f` testnet `m…`/`n…`). Locking scripts do not care. String equality does.

`own:` queries, Sigma/AIP address fields, displayed receive addresses, and indexer events must all use the same prefix for a given chain. A testnet client that prints `m…` will miss UTXOs if the stack indexed `own:1…` for the same hash.

`PublicKey.toAddress()` and `PrivateKey.toWif()` default to mainnet (`[0x00]`, `[0x80]`). Passing `'testnet'` / `[0x6f]` is already supported by `@bsv/sdk`. WIF prefix is not the bug: `fromWif` accepts both. Stored mainnet WIFs for the same key bytes are fine.

## Already wired

- `chain: 'main' | 'test'` on `OneSatContext`, `createWebWallet`, `createNodeWallet`, `createRemoteWallet`, `createWalletCore`.
- `OneSatServices` picks `ONESAT_MAINNET_URL` vs `ONESAT_TESTNET_URL` (`https://testnet.api.1sat.app`) from `chain`. `servicesBaseUrl` can override.
- CLI `--chain test`, config `chain`, permission-grant hint, WhatsOnChain repricer test URL.
- Indexers take `network`. `internalizeBeef` maps `chain` → `mainnet`/`testnet` and constructs them with it.
- Templates (`Cosign`, `Lock`, `OrdLock`, `OrdLockV2`) take a mainnet flag and encode `0x00` vs `0x6f`. `enrichIntent` passes chain into decode.
- `parseAddress` uses the network argument.
- Toolbox storage options are per-chain (`StorageProvider.createStorageBaseOptions(chain)`).

## Not wired

### Services host

`https://testnet.api.1sat.app` is a constant only. It has never been stood up.

1sat-stack `config.yaml`, `config.example.yaml`, and `config.test.yaml` are all `network: main`. JungleBus defaults to `https://junglebus.gorillapool.io`. `config.network` is loaded and copied onto the P2P client only (`cmd/server/config.go`). It never reaches parsers, the TXO store, or address encoding.

No JungleBus testnet URL is configured in-tree. Do not invent one.

### Owner tags do not differentiate

Owners are stored as a 20-byte `PKHash`. That part is network-neutral. The tag string is not.

`PKHash.Address()` defaults to mainnet when called with no network (`pkg/types/network.go`: mainnet `0`, testnet `0x6f`). Every `own:` and `p2pkh:` tag is built from that default, or from a decode that hardcodes `mainnet=true`:

| Site | What it writes |
|------|----------------|
| `pkg/txo/output_store.go` | `own:` + `owner.Address()` on save and on the second event rebuild |
| `pkg/parse/p2pkh.go` | `p2pkh.Decode(..., true)`, then `p2pkh:` + `pkHash.Address()` |
| `pkg/parse/origin.go`, `inscription.go` | `p2pkh.Decode(..., true)`; owner hash only, tag added later by the store |
| `pkg/parse/shrug.go` | `p2pkh.Decode(..., true)`, then `own:` + `addr.AddressString` directly |
| `pkg/sync/internalizer.go` | matches wallet derivations against `owner.Address()` |
| `pkg/types/pkhash.go` `MarshalJSON` | JSON address field, always mainnet |
| `pkg/template/cosign`, `ordlock`, `ordlock_v2`, `bsv21cosign` | `NewAddressFromPublicKeyHash(..., true)` |
| `pkg/bsv21/fee.go` | overlay fee address, `true` |

Owner routes look up `own:` + the address string the client sent (`pkg/owner/routes.go`). A testnet client querying `own:m…` will miss rows tagged `own:1…` for the same hash. Internalize has the same mismatch: the wallet's derivation map is keyed by the address it printed, the indexer compares `owner.Address()`.

### SDK address printing ignores `ctx.chain`

`createContext` defaults `chain` to `'main'`. Production paths call `.toAddress()` with no prefix, so even a test context prints mainnet:

- actions: `deriveDepositAddresses`, payments change, tokens, ordinals, collections, sync, locks, opns, cosign destinations, sweep, `resolveDestination`, identity, signing (BAP/Sigma), 1Color, registry
- wallet: `Bsv21Indexer.deriveFundAddress`, `storagePaymentAutoRetry`
- `packages/utils/src/keys.ts`, `packages/extension/src/keys.ts`
- CLI `init` / `sweep` display
- sweep-ui, wallet-server paymail destination
- templates `aip.ts` / `sigma.ts`
- wallet-desktop `send-recipient.ts` accepts only `0x00` / `0x05`; `rpc-handlers.ts` hardcodes `chain: 'main'`

Indexer *construction* in `internalizeBeef` is fine. Address *emission* is not.

### yours-wallet never passes chain

No `testnet` string in the extension. `NetWork` is only `Mainnet`.

Hardcoded `'main'` / `OneSatServices('main')`:

- `src/contexts/providers/ServiceProvider.tsx`
- `src/initWallet.ts`
- `src/background.ts` (`createContext`)
- `src/services/Keys.service.ts` (legacy sweep)
- `src/sweep-tab.tsx`
- `src/utils/tools.ts` (`network = 'mainnet'`)

Address re-encode forces `MAINNET_ADDRESS_PREFIX` (`0x00`):

- `src/services/Keys.service.ts` `retrieveKeys`
- `src/services/ChromeStorage.service.ts` old-storage migration
- `src/utils/keys.ts` `toAddress()` with no prefix

That re-encode would convert a testnet address back to mainnet on unlock.

Account identity is the address string (`selectedAccount`, chrome storage key). A prefix change is a different account. USB backup's `chain` type is the literal `'main'` and rejects anything else. Default storage remote is `https://wallet.1sat.app`.

## Phases

### 1. One address helper

Add a single helper, used everywhere an address string is emitted or compared:

```ts
toAddress(pub, chain: 'main' | 'test'): string
```

Map `'test'` → `'testnet'` (prefix `0x6f`). Do not scatter `[0x6f]` literals. Script locks stay hash-based; only the string form changes.

### 2. Thread `ctx.chain` through SDK emissions

Replace bare `.toAddress()` on the production paths listed above. `deriveFundAddress` must take network. Sigma/AIP string fields must use the same helper.

Leave tests on mainnet unless a test is specifically about prefix. Do not rewrite wallet-desktop in this phase.

### 3. yours-wallet: one chain, passed through

Network is chosen when the wallet is created and stored on the account. Not a settings toggle. Toggling would rewrite the chrome-storage account key and point an existing mainnet wallet at a dead host.

- Extend `NetWork` with testnet. Default remains mainnet.
- One getter from the current account. Pass it into `createWebWallet`, `OneSatServices`, and every `createContext`.
- `keys.ts` / `retrieveKeys` encode with that network. Stop forcing `0x00`.
- Legacy sweep and sweep-tab use the same chain.
- Testnet accounts do not use `wallet.1sat.app` as the default remote. Local storage only until a testnet storage host exists.
- USB backup: either keep rejecting non-main, or version the manifest. Do not silently write testnet keys into a mainnet stick format.

No network switcher UI in this phase. A create-wallet choice (or a dev build flag) is enough to prove the pipe.

### 4. Stack: thread `config.network` into tag emission

Do not change the stored `PKHash`. Change only the string form.

- One helper from `config.network` (`main`/`test`) to `types.Network`. Pass it into `PKHash.Address` at every tag and JSON site in the table above.
- Replace hardcoded `p2pkh.Decode(..., true)` and `NewAddressFromPublicKeyHash(..., true)` on paths that emit an address string. Decode-for-hash can stay either way; the hash does not include the prefix.
- `shrug` must not emit its own `own:` tag from `AddressString` while the store also emits `own:` from `PKHash.Address`. One writer, same prefix.
- Internalize compares against the same helper, or compares hashes instead of address strings.
- Owner HTTP lookup stays string-keyed. Clients and the indexer must agree on the prefix. No dual-index of both prefixes.

JungleBus / chaintracks / broadcaster URLs for testnet are config, not code, and are unknown. Do not hardcode a guessed host. A testnet process with today's tags would still be wrong even after the host exists.

### 5. Stand up `testnet.api.1sat.app`

Separate from the code. Blocked on: a testnet chain source (JungleBus or equivalent), chaintracks for that chain, and a host. The SDK constant already points here. Do not treat a green client build as a live testnet.

### 6. Follow-ons, not blocking

- wallet-desktop `chain: 'main'` in `rpc-handlers.ts` and the mainnet-only address check.
- CLI `init` / `sweep` display addresses.
- sweep-ui hardcoded `chain: 'main'`.

## Out of scope

- Changing mainnet address bytes or storage keys for existing yours-wallet users.
- Publishing packages.
- The unrelated `OneSatServices` / `parseOutpoint` working-tree edit.

## Open decision

Confirm phase 3 is create-time (or a dev flag), not a runtime toggle, before implementation starts.
