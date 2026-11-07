#!/usr/bin/env bun
/**
 * The admin sequence on a fresh exchange (local or yours), through a headless wallet:
 * claim -> default terms -> discovery on -> enable a token (admin, free) or set a listing price.
 *   OPENEX_ORIGIN=http://localhost:8100 WIF=<wif> bun admin-setup.ts [<tokenId> | --price <sats>]
 * The first wallet to claim becomes the admin; a second claim is refused.
 */
import { createClient } from "@dcasegr/amm-client";
import { exchangeOrigin, loadWallet } from "./headless-wallet.ts";

if (!process.env.WIF) throw new Error("set WIF");
const arg = process.argv[2];
const w = await loadWallet({ wif: process.env.WIF, dir: `.data/${process.env.WIF.slice(0, 8)}` });
const client = createClient({ origin: exchangeOrigin(), wallet: w.wallet });
try {
  const before = await client.claimStatus();
  if (!before.claimant) console.log("claimExchange ->", await client.claimExchange());
  else if (before.claimant !== w.identityKey) throw new Error(`claimed by ${before.claimant}; start again in a fresh SKEIN_HOME`);
  // Terms BEFORE any enable: a token enabled with no terms has no validator and refuses deploys.
  // TermsInput names (lpBps, validatorBps) differ from the wire's (lpFeeBps, validatorFeeBps).
  await client.setDefaultTerms({ lpBps: 35, validatorBps: 10, commissionBps: 5, minLegSats: 100_000 });
  console.log("defaults", JSON.stringify(await client.defaults()));
  await client.setDiscovery(true); // deploys must be indexed by discovery
  console.log("discovery", JSON.stringify(await client.discoveryState()));
  if (arg === "--price") {
    await client.setEnablePrice(Number(process.argv[3])); // null turns paid listing off
    console.log("enablePriceSats set");
  } else if (arg) {
    console.log("enableToken ->", await client.enableToken(arg)); // deploy BEEF from wallet or discovery
    console.log("terms", JSON.stringify(await client.validatorTerms(arg)));
  }
} finally {
  await w.destroy();
}
