# Plan: Split Wallet into Three Packages

## Goal

Split `@1sat/wallet` into three packages to cleanly separate browser and node dependencies:

- `@1sat/wallet` — shared base (types, indexers, sync utilities, backup)
- `@1sat/wallet-browser` — browser factory + `@bsv/wallet-toolbox-mobile` re-exports
- `@1sat/wallet-node` — node factory + `@bsv/wallet-toolbox` re-exports

## Current State

`@1sat/wallet` has three entrypoints (`./`, `./browser`, `./node`) but both toolbox packages are peer dependencies, causing:
- Type conflicts requiring `as unknown as` casts
- Both packages potentially installed regardless of which entrypoint is used
- Awkward optional peer dependency configuration

## New Package Structure

### `packages/wallet` (`@1sat/wallet`)

Base package with shared code:
- `OneSatWallet` class
- All indexers (FundIndexer, LockIndexer, InscriptionIndexer, etc.)
- Address sync (AddressManager, AddressSyncManager, etc.)
- Backup utilities (FileBackupProvider, Zip, etc.)
- CWI (ChromeCWI, EventCWI, etc.)
- Signers (ReadOnlySigner)
- Re-exports from `@1sat/client` and `@1sat/types`

**No factory functions. No toolbox dependencies.**

### `packages/wallet-browser` (`@1sat/wallet-browser`)

Browser-specific:
- `createWebWallet` factory
- `fullSync` (browser variant)
- Re-exports from `@bsv/wallet-toolbox-mobile` (StorageIdb, Monitor, etc.)
- Re-exports everything from `@1sat/wallet`

**Dependencies:**
- `@1sat/wallet` (direct)
- `@bsv/wallet-toolbox-mobile` (peer)

### `packages/wallet-node` (`@1sat/wallet-node`)

Node/Bun-specific:
- `createNodeWallet` factory
- `fullSyncNode`
- Re-exports from `@bsv/wallet-toolbox` (StorageKnex, StorageSqlite, Monitor, etc.)
- Re-exports everything from `@1sat/wallet`

**Dependencies:**
- `@1sat/wallet` (direct)
- `@bsv/wallet-toolbox` (peer)
- `knex` (peer)

## Migration

### Files to move

From `packages/wallet/src/`:
- `factory/createWebWallet.ts` → `packages/wallet-browser/src/`
- `factory/fullSync.ts` → `packages/wallet-browser/src/`
- `browser.ts` → `packages/wallet-browser/src/index.ts` (merged)
- `factory/createNodeWallet.ts` → `packages/wallet-node/src/`
- `factory/fullSyncNode.ts` → `packages/wallet-node/src/fullSync.ts`
- `node.ts` → `packages/wallet-node/src/index.ts` (merged)

### Files to update

- `packages/wallet/src/index.ts` — remove factory exports, remove browser/node entrypoints
- `packages/wallet/package.json` — remove toolbox peer deps, remove browser/node exports
- `packages/sdk/package.json` — update wallet sub-exports to point to new packages

### Files to delete

- `packages/wallet/src/browser.ts`
- `packages/wallet/src/node.ts`
- `packages/wallet/src/factory/` (entire directory moves out)

## SDK Exports

Update `packages/sdk/package.json` exports:
- `./wallet` → `@1sat/wallet`
- `./wallet/browser` → `@1sat/wallet-browser`
- `./wallet/node` → `@1sat/wallet-node`

## Breaking Changes

- `@1sat/wallet/browser` → `@1sat/wallet-browser`
- `@1sat/wallet/node` → `@1sat/wallet-node`
- `createWebWallet` import path changes
- `createNodeWallet` import path changes
