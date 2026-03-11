# P2 Testing Progress

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

### Lock/unlock cycle
- lockBsv: tested, working
- unlockBsv: tested, working (txid ae87131b...d5e3e8)
- unlockingScriptLength bumped 1202→1205 for DER variability

### MCP tool consolidation
- `wallet_sendToAddress` → `wallet_sendBsv` (implemented, not yet tested)
  - Multiple recipients, address or paymail, BSV or USD amounts
  - Old sendToAddress.ts deleted

### inscriptions/index.ts
- Added bare `origin` tag to inscription outputs (not yet published)

## Not Yet Tested

### Payments
- `wallet_sendBsv` — implemented but needs MCP restart + publish to test

### Ordinals
- createOrdinals (inscribe)
- transferOrdinals
- listOrdinal
- cancelListing
- purchaseOrdinal

### Tokens
- sendBsv21
- purchaseBsv21

### OPNS
- registerOpns
- deregisterOpns

### Sweep
- sweepBsv
- sweepOrdinals
- sweepBsv21

## Current Versions
- `@1sat/actions@0.0.38`
- `@bopen-io/templates@1.2.1`
- bsv-mcp has `@1sat/actions@0.0.38`
