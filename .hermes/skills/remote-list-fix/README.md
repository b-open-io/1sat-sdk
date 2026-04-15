# Fix remote list to show URLs instead of storage identifiers

## Problem
`1sat remote list` was showing storage identity keys (public keys like `029fe6c9...`) instead of the actual URLs (`https://api.1sat.app/...`, `http://127.0.0.1:8082/...`).

## Root Cause
The command used `walletResult.storage.getBackupStores()` which returns storage identifiers (public keys), not the configured URLs.

## Solution
Use `walletResult.remoteClients` array which contains `StorageClient` instances with `endpointUrl` properties.

## Changes to `packages/cli/src/commands/remote.ts`

### 1. Add remoteUrls variable
```typescript
// After line 135 (const config = loadConfig())
// Add:
const remoteUrls = walletResult.remoteClients?.map((c: any) => c.endpointUrl) ?? []
```

### 2. Update JSON output
```typescript
// Line 148: Change
backups: walletResult.storage.getAllStores?.() ?? [],
// To:
backups: remoteUrls,
```

### 3. Update display logic
```typescript
// Lines 167-181: Replace the entire display block with:
if (remoteUrls.length === 0 && !config.backups?.length) {
    console.log('  No remote storages configured')
} else {
    console.log(`  ${bold('Backups:')}`)
    for (const url of remoteUrls) {
        console.log(`    ● ${url}`)
    }
}
```

## Verification
After fix:
```
1sat remote list
Active Storage: local

Backups:
  ● https://api.1sat.app/1sat/wallet
  ● http://127.0.0.1:8082/1sat/wallet
```

## Notes
- `remoteClients` is already populated when remotes are added via `remote add`
- Each `StorageClient` has an `endpointUrl` property
- No need to call `makeAvailable()` - `endpointUrl` is available immediately