---
name: permission-module
description: "This skill should be used when hosting or wiring the 1Sat permission module — WalletPermissionsManager permissionModules, createAssetPermissionModules, view scopes (p 1sat all|collection|app|creator|id), spend labels, apply-on-approve, or @1sat/permission-module-ui prompts. Triggers on 'permission module', 'OneSatPermissionPrompt', 'p 1sat action', 'view scope', 'BRC-165', 'createAssetPermissionModules', or 'grouped permissions'."
disable-model-invocation: true
---

# 1Sat permission module

Gates `createAction` / `listOutputs` / `internalizeAction` for asset schemes. Register on `WalletPermissionsManager` as `permissionModules`. Crypto always uses the **base** wallet, never the gated wrapper.

## Host wiring

```typescript
import { createAssetPermissionModules } from '@1sat/permission-module'
import { OneSatPermissionPrompt } from '@1sat/permission-module-ui'

const modules = createAssetPermissionModules({
  wallet: baseWallet,
  promptHandler: (req) => showPrompt(req),
  adminOriginator,
  permissionStore,
  services,
})

new WalletPermissionsManager(baseWallet, adminOriginator, {
  permissionModules: modules,
})
```

`createAssetPermissionModules` builds one module per scheme: `1sat`, `opns`, `bsv21`, `lock`. Not BAP / BSocial / hosting / sigma.

## Mapping

| Layer | What | Examples |
|-------|------|----------|
| Storage | plain baskets | `1sat`, `opns`, `bsv21`, `lock` |
| Spend / dispatch | labels on createAction | `p <scheme> action`, `p <scheme> input id <key>` |
| View | `listOutputs.basket` grant keys | `p 1sat all\|collection\|app\|creator\|id` |

View values live in **tags** (`collection:…`, `app:…`, `creator:…`, `id:…`), not the basket name. Module rewrites the basket to the storage name.

- `collection` / `app` / `creator`: force `tagQueryMode: 'all'`
- `id`: auto-allow, leave the caller's query mode
- `p 1sat opns` / `p 1sat ordinals` are invalid scopes, not baskets

Probe protocol: `[0, 'p 1sat probe']`. New keys: `[0, 'onesat']`. Spends use whatever `protocolID` is in CI.

## Apply

After the user approves, `onRequest` runs `embellishCreateActionArgs` → `applyP1SatCreateAction` (ids, Sigma/OpNS seals, script tags including `creator:` from SIGMA, CI). `onResponse` finishes sign. Local (no module) uses the same apply in `runCreateActionPipeline`.

Actions opt in with `executeTrackedAction(..., { usePermissionModule: true, permissionScheme: '1sat' })`.

## UI

`@1sat/permission-module-ui` renders `TransactionPrompt` / basket-access prompts. Host supplies `promptHandler` and resolves `true` / `false`.
