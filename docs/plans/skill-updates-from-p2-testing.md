# Skill Updates from P2 Testing

Gaps identified during lock/unlock testing that need to be applied to skills and other two-phase actions.

## 1. Skills to Update

### 1sat-skills/timelock (SKILL.md)
- Document `completeSignedAction` helper as the standard way to finalize unlock
- Show the signing callback pattern with `Lock.unlockWithWallet`
- Note: `unlockingScriptLength: 1202`, `sequenceNumber: 0`
- Remove any references to manual signAction/abortAction handling

### 1sat-skills/transaction-building (SKILL.md)
- Add `completeSignedAction` as the standard completion pattern for all two-phase actions
- Document the signableTransaction BEEF stripping issue and the BEEF merge fix
- Show the signing callback pattern
- Update any raw signAction examples to use the helper

### bsv-skills/wallet-brc100 (SKILL.md)
- Document that `makeSignableTransactionBeef` strips merkle proofs (uses `mergeRawTx`)
- Explain the BEEF merge pattern: `Beef.fromBinary(inputBEEF)` → `mergeRawTx(unsignedTx)` → `findAtomicTransaction`
- Note that `Beef` is exported from `@bsv/sdk`
- Document `abortAction` scope: works on `nosend`, `unsigned`, `unprocessed` only
- Document server-side processAction verification behavior

## 2. Actions to Wire Up with completeSignedAction

All 13 two-phase actions need to use `completeSignedAction` instead of raw signAction calls:

### tokens/index.ts
- `sendBsv21` (line ~526)
- `purchaseBsv21` (line ~775)

### ordinals/index.ts
- `transferOrdinals` (line ~625)
- `listOrdinal` (line ~743)
- `cancelListing` (line ~879)
- `purchaseOrdinal` (line ~1122)

### opns/index.ts
- `registerOpns` (line ~111)
- `deregisterOpns` (line ~225)

### sweep/index.ts
- `sweepBsv` (line ~218/284)
- `sweepOrdinals` (line ~497/550)
- `sweepBsv21` (line ~799)
- Plus one more at line ~970

### inscriptions/index.ts
- `inscribe` sigma anchor (line ~146)

## 3. Current State

- `completeSignedAction` helper: written, exported, tested in `unlockBsv`
- `@1sat/actions@0.0.36`: published with helper + unlockBsv wired up
- `@bopen-io/templates@1.2.1`: sighash byte fix in `Lock.unlockWithWallet`
- `unlockBsv`: NOT YET TESTED end-to-end (awaiting MCP restart + test)
- Lock output `407920f8...b96d.1`: 2000 sats, until block 939791, spendable (aborted stuck tx)

## 4. Uncommitted Changes

### 1sat-sdk (packages/actions)
- `src/utils/completeSignedAction.ts` (new file)
- `src/locks/index.ts` (refactored to use helper)
- `src/index.ts` (exports helper)
- `package.json` (version 0.0.36)
- Need git commit + push

### bsv-mcp
- `package.json` has `@1sat/actions@0.0.36`
- Not committed

### ts-templates
- Already committed and pushed (v1.2.1)
