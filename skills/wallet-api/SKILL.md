---
name: wallet-api
description: "This skill should be used when an application or agent needs to drive the 1Sat CLI wallet over HTTP — running `1sat serve wallet-api`, the app-facing BRC-100 endpoint on 127.0.0.1:3321, and managing what each app may do with `1sat permissions list/grant/revoke`. Triggers on 'wallet API', 'BRC-100 endpoint', 'serve wallet-api', '1sat permissions', 'permission denied for', 'permissions grant', 'grant a permission', 'port 3321', 'HTTPWalletJSON', 'Origin header required', 'dApp connectivity', 'agent wallet access', or 'wallet access for an app'. Covers the deny-by-default permission model and the grant-and-retry loop. Uses @1sat/cli, @1sat/wallet and @1sat/wallet-server."
---

# Wallet API (BRC-100 app endpoint)

`1sat serve wallet-api` exposes the CLI's wallet as the BRC-100 method surface over HTTP JSON on `127.0.0.1:3321`, so applications and agents can drive the wallet: `POST /<walletMethod>` with a JSON body, get a JSON result back.

## This is not `1sat serve wallet`

Two different servers, commonly confused:

| Command | What it speaks | Who talks to it |
|---------|----------------|-----------------|
| `1sat serve wallet-api` | **App-facing BRC-100** — `createAction`, `getPublicKey`, `listOutputs`, … the 28 `WalletInterface` methods | dApps, agents, anything on `HTTPWalletJSON` |
| `1sat serve wallet` | **wallet-toolbox *storage*** — the RPC a wallet uses to persist and fetch its own records | Another wallet's storage layer |

`1sat serve wallet` moves opaque storage records; it has no permission model, no app origins and no notion of "an app asking for something". If the goal is "let this program use my wallet", it is `wallet-api`. Everything below is about `wallet-api` only.

## Starting it

```bash
1sat serve wallet-api
```

```
[wallet-api] BRC-100 app endpoint on http://127.0.0.1:3321
[wallet-api] permission grants: /home/you/.1sat/data/permissions-main.json
[wallet-api] ungranted requests are denied; the error names the `1sat permissions grant` command that allows them
```

- Serves **only** the app endpoint — no storage server, no accounts layer, no monitor.
- Wallet, chain, storage and keys come from the same `~/.1sat/cli/config.json` as every other `1sat` command; there is one wallet on disk and this is a second way in.
- Host/port: `server.dapp.host` / `server.dapp.port` in the config, or `ONESAT_DAPP_PORT`. Defaults `127.0.0.1:3321` — the port BRC-100 clients already probe.
- Grants live in `<dataDir>/permissions-<chain>.json` (mode 0600), written atomically; the path is printed at startup.

Routing: `POST /<method>` for any of the 28 BRC-100 methods (`createAction`, `signAction`, `abortAction`, `listActions`, `internalizeAction`, `listOutputs`, `relinquishOutput`, `getPublicKey`, `revealCounterpartyKeyLinkage`, `revealSpecificKeyLinkage`, `encrypt`, `decrypt`, `createHmac`, `verifyHmac`, `createSignature`, `verifySignature`, `acquireCertificate`, `listCertificates`, `proveCertificate`, `relinquishCertificate`, `discoverByIdentityKey`, `discoverByAttributes`, `isAuthenticated`, `waitForAuthentication`, `getHeight`, `getHeaderForHeight`, `getNetwork`, `getVersion`). `isAuthenticated`, `waitForAuthentication`, `getHeight`, `getNetwork` and `getVersion` take no body. Unknown paths and non-`POST` requests are 404; `OPTIONS` is 204. Any wallet error, including a permission denial, comes back as `400 {"error": "…"}` with the message relayed unchanged, so an app can print it verbatim.

## How an app is identified

**The `Origin` header, and nothing else.**

A browser sets `Origin` itself and page scripts cannot change it, so it is the one caller identity this server can rely on. The header value is reduced to its host (`http://gib` → `gib`, `https://bitplan.dev:443` → `bitplan.dev`) and that string is the app's identity in the grant store.

- `Originator` and `X-1Sat-Origin` are **ignored**. They are ordinary headers any page can forge.
- No `Origin` at all, or the opaque value `null`, is refused: `400 Origin header required`.

Node clients on `@bsv/sdk`'s `HTTPWalletJSON` already do the right thing — the substrate requires an `originator` outside the browser and sends `Origin: http://<originator>` (it also sends `Originator`, which this server disregards). Its default `baseUrl` is already `http://localhost:3321`:

```ts
import { HTTPWalletJSON } from '@bsv/sdk'

const wallet = new HTTPWalletJSON('gib') // → Origin: http://gib
await wallet.getPublicKey({ identityKey: true })
```

A non-browser client that is not using that substrate sets the header the same way: `Origin: http://<your-app-name>`.

> **Go SDK clients will not work unmodified.** The Go SDK's HTTP wallet client sends `Originator` rather than `Origin`, which this endpoint ignores — every call comes back `400 Origin header required`. Add an `Origin: http://<app>` header to the client's requests.

## The permission model

Every call goes through a `LocalWalletPermissionsManager` wrapped around the CLI wallet. **Anything the grant store does not already hold is denied immediately.**

There are no prompts, no auto-approve, no interactive flag and no "allow once". This endpoint exists for agents and automation, which have no terminal to answer on; a person who wants to be asked runs a graphical wallet such as BSV Desktop. Protocol use, basket access, certificate disclosure, spending and a BRC-73 grouped (app manifest) request are all handled the same way: refused on the spot.

The refusal is the interface. Instead of a bare "Permission denied.", the denial names the exact command that would allow the call:

```
permission denied for gib: run `1sat permissions grant gib --protocol "identity key retrieval" --level 1` and retry
```

That message is the body of the `400`, so it surfaces in the app being driven — whoever (or whatever) is at the keyboard reads the failure and acts on it. A grouped manifest request lists one command per permission it asked for. When the server was started on testnet the suggestion carries the flag: `1sat --chain test permissions grant …`.

Grants are read from the JSON file on **every** check, so a grant written while the server is running takes effect on the app's next call. No restart.

## The grant-and-retry loop

A call stops at its **first** missing permission. A first run therefore takes several rounds: run the app, read the denial, run the command it names, run the app again. That is the designed loop, not a bug.

Worked example — the `gib` tool publishing a repository through this endpoint needed five grants, in this order:

```bash
# 1. It asked who the wallet is: getPublicKey({ identityKey: true })
1sat permissions grant gib --protocol "identity key retrieval" --level 1

# 2. Its createAction labelled the action "gib push"
1sat permissions grant gib --label "gib push"

# 3. The action spends, so it needs a monthly budget (see below)
1sat permissions grant gib --spending 50000

# 4. Its own protocol, for the data it signs/encrypts
1sat permissions grant gib --protocol "gib branch" --level 1

# 5. The basket the outputs land in
1sat permissions grant gib --basket gib
```

Five runs, five denials, five grants, then it worked. Nothing there is guessed: each command was copied out of the denial that preceded it.

To skip the rounds for an app whose needs are known, put several selectors in one call — each selector writes its own grant:

```bash
1sat permissions grant gib \
  --protocol "gib branch" --level 1 \
  --basket gib \
  --spending 50000
```

(`--protocol` and `--label` are mutually exclusive in one invocation, since both write a protocol grant.)

## `1sat permissions`

Operates directly on the JSON grant store: **no wallet key, no unlock, no password**, and it neither needs nor cares whether the server is running. `--chain test` selects the testnet store.

```bash
1sat permissions list                 # every grant, grouped by app origin
1sat permissions list gib             # one app
1sat permissions grant <origin> …     # write grants
1sat permissions revoke <origin> …    # remove grants
1sat permissions revoke gib --all     # forget the app entirely
```

`list` prints each grant one per line with its expiry and reason, then the total and the store path. `--json` gives machine-readable output on all three.

### Selectors

The same set is accepted by `grant` and `revoke`:

| Selector | Meaning |
|----------|---------|
| `--protocol <name> --level <0\|1\|2>` | Protocol access. `--level` is required with `--protocol`. |
| `--counterparty <hex\|self\|anyone>` | Counterparty for a level 0/2 protocol (default `self`). **Ignored at level 1** — level-1 keys are counterparty-less, so a level-1 grant never carries one. |
| `--basket <name>` | Basket access. |
| `--label <name>` | An action label. Stored as the level-1 protocol `action label <name>`; `--level` and `--counterparty` do not apply. |
| `--certificate <type> --fields <a,b>` | Certificate disclosure. `--fields` is required and is a comma-separated list; the fields are sorted into the key, so ordering does not matter. |
| `--counterparty <verifier>` (or `--verifier`) | With `--certificate`: the verifier the fields may be revealed to. |
| `--privileged` | The privileged variant of a protocol or certificate grant. A separate grant from the non-privileged one. |
| `--spending <satoshis>` | Monthly spending cap; a positive whole number. |

Grants written by `permissions grant` never expire (`expiry: 0`). `revoke` reports any selector that matched no grant, along with the `grant` command that would create it.

The origin is normalized the same way the server normalizes the `Origin` header — lowercased, scheme and default port stripped — so `gib`, `http://gib` and `HTTP://GIB/` all name the same app.

### Spending grants are monthly caps

`--spending` is **not** a per-payment ceiling. It is a monthly budget: on every spend the manager sums this origin's month-to-date spend from the labelled action history and allows the payment only if `spent + this payment <= cap`. The grant itself holds no running total, so the cap cannot be re-consumed by repeating a payment of the same size.

The amount suggested in a denial is the amount of the payment that triggered it — enough for roughly that one payment, not a considered budget. Pick a real monthly figure instead of pasting the suggestion, or expect to raise it. Re-granting with a new amount replaces the cap (the grant key is just `(origin, spending)`).

## The admin originator

The CLI's own commands do not bypass the manager — they go *through* one, as the internal admin originator `1sat-cli.internal`:

- Every permission check is bypassed for it, so `1sat wallet send` and friends never need grants.
- Metadata is still decrypted on the way back, which is why `1sat wallet actions` shows readable descriptions.

That originator is for in-process code only. The router normalizes each request's origin and rejects any request that matches it — `400 Origin is reserved for the wallet itself` — before the call reaches the wallet, so an app cannot claim it by setting a header.

## Metadata encryption

Transaction descriptions and custom instructions are encrypted at rest by default on **both** paths — whether an app wrote them through this endpoint or a `1sat` command wrote them itself. Reads go back through a permissions manager, which decrypts them.

Records written before encryption was turned on still read as plaintext: decryption is attempted unconditionally and a value that was never encrypted is returned unchanged.

`1sat serve wallet` (the storage interface) never interprets these fields — it passes the records through opaquely, and the wallet at the far end decrypts with its own manager.

## Troubleshooting

**`Origin header required` (400)**
The request arrived with no `Origin`, or with `Origin: null`. Set `Origin: http://<your-app>`. Setting `Originator` or `X-1Sat-Origin` instead will not help — they are ignored. This is the usual symptom of a Go SDK client, or of `curl` without `-H 'Origin: …'`.

**`permission denied for <app>: run …` (400)**
Working as designed. Run the command in the message, then retry the same call — the running server picks the grant up immediately. Expect to do this a few times on an app's first run, since only the first missing permission of a call is reported. If the message names an origin you did not expect, check what the client puts in `Origin`; `1sat permissions list` shows what has been granted to which origin.

**`Origin is reserved for the wallet itself` (400)**
The request's origin normalized to `1sat-cli.internal`. Pick a different app name.

**`Unsupported P-module scheme`**
Fixed on `master`: the CLI's admin manager now registers pass-through permission modules for every scheme in `PERMISSION_SCHEME_IDS`. Actions that spend a basket asset always carry a `p <scheme> input id <id>` label, and the manager throws this when the scheme has no module registered. If it appears, the build predates that fix — update the CLI.

**`Unsupported permission store version N in <path>`**
The grant file is from a different format version. Move it aside and re-grant.

**503 / wallet locked**
The router answers `503 {"error":"Wallet is locked"}` when the served wallet reports itself not ready. `1sat serve wallet-api` unlocks the key at startup and does not report readiness, so it fails at startup instead of serving 503s — a 503 from port 3321 means something else is listening there (for example a desktop wallet's own endpoint).

**Nothing reaches the wallet on a denial**
By design: the manager refuses before the underlying wallet is called, so a denied `createAction` creates nothing.

## Related

- `packages/cli/skills/cli` — the rest of the `1sat` command surface, including `1sat serve` storage modes.
- `packages/connect/skills/dapp-connect` — connecting a browser dApp to a wallet (extension / desktop / Sigma) rather than to this endpoint.
- `packages/permission-module/skills/permission-module` — the WPM permission modules and view scopes a graphical wallet prompts with.
