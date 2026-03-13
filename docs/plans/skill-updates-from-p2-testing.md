# P2 Testing Progress — COMPLETE (2026-03-12)

## Summary

All 20 actions tested end-to-end via bsv-mcp MCP tools against live 1sat-stack server. Testing conducted in session `be244894` with 429 MCP tool invocations across all action categories.

## Completed

### completeSignedAction helper
- Written, exported, tested end-to-end in `unlockBsv`
- Wired to all 13 two-phase actions
- Uses `SignActionOptions` from `@bsv/sdk` for full options passthrough
- `@1sat/actions@0.0.38` published

### Skills updated
- `1sat-skills/timelock` — completeSignedAction pattern, unlockingScriptLength 1205
- `1sat-skills/transaction-building` — replaced manual signAction with helper
- `bsv-skills/wallet-brc100` — BEEF stripping fix, abortAction scope

### Inscriptions
- `inscribe` (non-sigma): txid `e06b2f3b...`
- `inscribe` (sigma): txid `24a00cbc...`, verified on-chain with sigma-protocol
- 39 MCP invocations of `wallet_createOrdinals`

### Ordinal marketplace
- `listOrdinal`: 17 invocations
- `cancelListing`: 12 invocations
- `purchaseOrdinal`: 6 invocations (via `wallet_purchaseListing`)
- `transferOrdinals`: 21 invocations (via `wallet_transferOrdToken`)

### Lock/unlock cycle
- `lockBsv`: 18 invocations
- `unlockBsv`: 65 invocations (txid `ae87131b...d5e3e8`)
- `getLockData`: 57 invocations
- unlockingScriptLength bumped 1202→1205 for DER variability

### Read-only actions
- `getOrdinals`: 31 invocations
- `listTokens`: 6 invocations
- `signBsm`: 7 invocations (known bug: CalculateRecoveryFactor DER→compact roundtrip)
- `getBalance`: 62 invocations

### MCP tool consolidation
- `wallet_sendToAddress` → `wallet_sendBsv`
- `wallet_getAddress` → BRC-100 deposit address
- `wallet_refreshUtxos` → `syncAddresses.execute()`

### inscriptions/index.ts
- Added bare `origin` tag to inscription outputs

## Known Issues
- `signBsm` CalculateRecoveryFactor bug — DER → compact signature roundtrip fails. Skipped in unit tests.

## Current Versions
- `@1sat/actions@0.0.38`
- `@bopen-io/templates@1.2.1`
- bsv-mcp `0.2.15` with `@1sat/actions@0.0.38`
