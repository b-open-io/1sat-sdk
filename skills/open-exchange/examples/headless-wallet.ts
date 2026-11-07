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
