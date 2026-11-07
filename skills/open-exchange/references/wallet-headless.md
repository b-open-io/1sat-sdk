# A headless wallet for the Open Exchange

Run a BRC-100 wallet in Bun with the 1Color module, no browser. This is the recipe the
load-test harness used this week to deploy, list, open pools, swap and recover on testnet.
`examples/headless-wallet.ts` is the same code as below; `examples/package.json` the same
dependencies.

## The pieces, and why

1. **Toolbox wallet**: `createNodeWallet` from `@1sat/wallet-node` with
   `storage: {provider: "bun-sqlite", filename}`, `chain: "test"`. Services default to
   `https://testnet.api.1sat.app` for chain test (`ONESAT_API_URL` overrides).
2. **Hex shim** (b-open-io/1sat-sdk#99): bun-sqlite storage returns `lockingScript` /
   `unlockingScript` from `listOutputs` / `listActions` as `Uint8Array`, but BRC-100 says hex.
   The client matches `lockingScript` with a regex, so raw rows look empty and a swap stops
   `fees`. Wrap the wallet in a Proxy that hex-normalizes those results.
3. **The REAL color module** `ColorPermissionModule` (from `@bsv/color-permission-module`,
   aliased to `@bopen-io/color-permission-module@0.2.2`): constructed with the RAW (normalized)
   toolbox wallet, never the manager; `requestTokenAccess: async () => true` (consent
   auto-approved); `provider` = a `ColorOverlayProvider` against the exchange host.
4. **Permissions manager**: `LocalWalletPermissionsManager` from `@1sat/wallet`, with
   `permissionModules: { ...passThrough, color }`. The manager routes every `p <scheme>` label
   to `permissionModules[scheme]` and throws "Unsupported P-module scheme" otherwise, so register
   pass-throughs for `PERMISSION_SCHEME_IDS` (`@1sat/types`) so plain 1sat actions still work.
5. **Admin originator**: call the manager with one fixed originator on every method (a Proxy).
   The manager lets its admin originator past every grant. Hand this proxy to `createClient`
   and to `createContext` (`@1sat/actions`).

## The three package overrides (required)

Put them in BOTH `dependencies` and `overrides`, then confirm one copy each:

```bash
find node_modules -path '*/@1sat/actions/package.json' -o -path '*/color-permission-module/package.json' -o -path '*/wallet-toolbox-client/package.json'
```

- `@1sat/actions` `0.1.5`: ONE copy. `@dcasegr/amm-client` pins it exactly; a second copy
  nests and splits the module's state.
- `@bsv/color-permission-module` → `npm:@bopen-io/color-permission-module@0.2.2`: ONE copy, the
  fork Yours runs. The client peers `^0.1`.
- `@bsv/wallet-toolbox-client` → `npm:@bopen-io/wallet-toolbox-client@2.15.3`: upstream's spend
  check rejects inputs the module adds to an action (staging, Move back, pool flows). The fork
  accepts them.

```json
{
  "name": "open-exchange-examples",
  "private": true,
  "type": "module",
  "dependencies": {
    "@1sat/actions": "0.1.5",
    "@1sat/templates": "0.1.1",
    "@1sat/types": "0.1.1",
    "@1sat/wallet": "0.1.2",
    "@1sat/wallet-node": "0.1.2",
    "@bsv/color-permission-module": "npm:@bopen-io/color-permission-module@0.2.2",
    "@bsv/sdk": "4.0.1",
    "@bsv/wallet-toolbox": "2.15.3",
    "@bsv/wallet-toolbox-client": "npm:@bopen-io/wallet-toolbox-client@2.15.3",
    "@dcasegr/amm-client": "0.44.3",
    "@dcasegr/amm-engine": "0.44.3"
  },
  "overrides": {
    "@1sat/actions": "0.1.5",
    "@bsv/color-permission-module": "npm:@bopen-io/color-permission-module@0.2.2",
    "@bsv/wallet-toolbox-client": "npm:@bopen-io/wallet-toolbox-client@2.15.3"
  }
}
```

## The code

```ts
/**
 * A headless BRC-100 wallet that can trade on an Open Exchange: a toolbox wallet in Bun
 * (bun-sqlite, chain test) wrapped in a permissions manager called as an admin originator, with
 * the REAL 1Color module mounted under `color` and pass-through modules for the 1sat schemes.
 * See references/wallet-headless.md for why each piece is here.
 *
 *   import { loadWallet } from "./headless-wallet.ts";
 *   const w = await loadWallet({ wif: process.env.WIF!, dir: ".data/alice" });
 *   // w.wallet is the WalletInterface to hand to createClient; w.ctx is the @1sat/actions context
 *   await w.destroy();
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createContext, type OneSatContext } from "@1sat/actions";
import { PERMISSION_SCHEME_IDS } from "@1sat/types";
import { InMemoryPermissionStore, LocalWalletPermissionsManager } from "@1sat/wallet";
import { createNodeWallet, type NodeWalletResult } from "@1sat/wallet-node";
import { type ColorOverlayProvider, ColorPermissionModule } from "@bsv/color-permission-module";
import { type LookupAnswer, PrivateKey, type STEAK, Utils, type WalletInterface } from "@bsv/sdk";

export const CHAIN = "test" as const;
/** Any fixed string: the manager lets this originator past every grant (consent auto-approved). */
export const ADMIN_ORIGINATOR = "openex.headless";

export function exchangeOrigin(): string {
  return (process.env.OPENEX_ORIGIN || "https://testnet.openex.dev").replace(/\/+$/, "");
}

// ---- the 1Color overlay provider, against the exchange host -------------------------------

async function colorLookup(
  host: string,
  type: "color-spendability" | "color-admission",
  assetId: string,
  outpoints: string[],
): Promise<LookupAnswer> {
  const res = await fetch(`${host}/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service: `ls_color_${assetId}`,
      query: { type, version: 1, assetId, topic: `tm_color_${assetId}`, outpoints },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${host}/lookup (${type} ${assetId}): ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as LookupAnswer;
}

export function openexColorProvider(host: string = exchangeOrigin()): ColorOverlayProvider {
  return {
    spendability: (assetId, outpoints) => colorLookup(host, "color-spendability", assetId, outpoints),
    admission: (assetId, outpoints) => colorLookup(host, "color-admission", assetId, outpoints),
    async submit(topics, beef, offChainValues) {
      if (offChainValues?.length) throw new Error("offChainValues submits are not supported");
      const res = await fetch(`${host}/submit`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-topics": JSON.stringify(topics) },
        body: new Uint8Array(beef),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`POST ${host}/submit (${topics.join(",")}): ${res.status} ${text.slice(0, 300)}`);
      return JSON.parse(text) as STEAK;
    },
  };
}

// ---- the hex shim (b-open-io/1sat-sdk#99) ------------------------------------------------

/** bun-sqlite listOutputs/listActions return scripts as Uint8Array; BRC-100 says hex strings. */
function hexScripts(row: Record<string, unknown> | undefined): void {
  if (!row) return;
  for (const k of ["lockingScript", "unlockingScript"]) {
    const v = row[k];
    if (v instanceof Uint8Array || Array.isArray(v)) row[k] = Utils.toHex(Array.from(v as ArrayLike<number>));
  }
}

function normalizeListResult(r: unknown): unknown {
  const res = r as {
    outputs?: Record<string, unknown>[];
    actions?: { outputs?: Record<string, unknown>[]; inputs?: Record<string, unknown>[] }[];
  };
  for (const o of res?.outputs ?? []) hexScripts(o);
  for (const a of res?.actions ?? []) {
    for (const o of a.outputs ?? []) hexScripts(o);
    for (const i of a.inputs ?? []) hexScripts(i);
  }
  return r;
}

const isList = (p: PropertyKey) => p === "listOutputs" || p === "listActions";

/** `wallet` with listOutputs/listActions scripts hex-normalized; every argument forwarded unchanged. */
function normalizeScripts<W extends WalletInterface>(wallet: W): W {
  return new Proxy(wallet, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...a: unknown[]) => {
        const out = (value as (...x: unknown[]) => unknown).apply(target, a);
        return isList(property) ? Promise.resolve(out).then(normalizeListResult) : out;
      };
    },
  });
}

/** `manager` with the admin originator passed on every call. */
function withAdminOriginator(manager: WalletInterface): WalletInterface {
  return new Proxy(manager, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (args: unknown) => {
        const out = (value as (a: unknown, o: string) => unknown).call(target, args, ADMIN_ORIGINATOR);
        return isList(property) ? Promise.resolve(out).then(normalizeListResult) : out;
      };
    },
  });
}

/** Pass-through modules for the schemes @1sat/actions labels with, so plain sends keep working. */
const passThroughModules = Object.fromEntries(
  PERMISSION_SCHEME_IDS.map((scheme) => [
    scheme,
    { onRequest: async (req: { args: object }) => ({ args: req.args }), onResponse: async (res: unknown) => res },
  ]),
);

export interface HeadlessWallet {
  identityKey: string;
  /** The manager as the admin originator: hand THIS to createClient and @1sat/actions. */
  wallet: WalletInterface;
  ctx: OneSatContext;
  node: NodeWalletResult;
  destroy: () => Promise<void>;
}

export async function loadWallet(o: { wif: string; dir: string; monitor?: boolean }): Promise<HeadlessWallet> {
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  const key = PrivateKey.fromWif(o.wif);
  const identityKey = key.toPublicKey().toString();
  const node = await createNodeWallet({
    privateKey: o.wif,
    chain: CHAIN,
    storageIdentityKey: `openex-${identityKey.slice(0, 16)}`,
    storage: { provider: "bun-sqlite", filename: join(o.dir, "wallet.db") },
    skipInitialMonitor: !o.monitor,
  });
  const raw = normalizeScripts(node.wallet);
  // The module holds the RAW (normalized) toolbox wallet, never the manager.
  const color = new ColorPermissionModule({
    wallet: raw,
    provider: openexColorProvider(),
    requestTokenAccess: async () => true,
  });
  const manager = new LocalWalletPermissionsManager(
    raw,
    ADMIN_ORIGINATOR,
    { permissionModules: { ...passThroughModules, color } },
    { store: new InMemoryPermissionStore() },
  );
  const wallet = withAdminOriginator(manager);
  const ctx = createContext(wallet, { services: node.services, chain: CHAIN, dataDir: o.dir });
  return {
    identityKey,
    wallet,
    ctx,
    node,
    destroy: async () => {
      color.dispose();
      await node.destroy();
    },
  };
}

/** A fresh testnet WIF, for a new wallet. Store it yourself (mode 0600). */
export const newWif = () => PrivateKey.fromRandom().toWif();
```

## Funding a testnet wallet (verified)

```ts
import { deriveDepositAddresses, syncAddresses } from "@1sat/actions";
import { FUNDING_BASKET } from "@1sat/types";

const { derivations } = await deriveDepositAddresses.execute(w.ctx, { count: 1 });
console.log("send testnet BSV to", derivations[0].address);

// The 1sat testnet indexer credits a plain send in about a minute. Poll the owner balance:
//   GET https://testnet.api.1sat.app/1sat/owner/<address>/balance  -> {balance, count}
// Then sweep the deposit into wallet storage:
const r = await syncAddresses.execute(w.ctx, {});              // {processed, failed, lastScore}
const spendable = await w.wallet.listOutputs({ basket: FUNDING_BASKET, limit: 10000 });
```

`client.walletSats()` gives the spendable sats the exchange client sees. To fan out to many
wallets, send ONE createAction with a P2PKH output per deposit address
(`new P2PKH().lock(address).toHex()`), then wait for the indexer and sweep each.

## Notes

- One wallet runs one swap at a time (the client enforces it). For parallel load, run one
  process per wallet.
- `monitor: true` starts the toolbox monitor (proof checking, rebroadcast). The harness ran
  swaps with it off; turn it on for long-lived wallets.
- The toolbox and services print to `console.*`; redirect them if stdout must stay clean.
- Keep WIFs out of the repo; store key files mode 0600.
