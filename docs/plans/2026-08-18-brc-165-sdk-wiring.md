# Plan: BRC-165 SDK wiring (remaining)

Status: **In progress**  
Date: 2026-08-18  
BRC draft: [bsv-blockchain/BRCs#229](https://github.com/bsv-blockchain/BRCs/pull/229)

## Spec (locked)

| Layer | Law |
|-------|-----|
| Storage | Plain basket `1sat` |
| View | `p 1sat <scope>` + tags (`all` \| `collection` \| `app` \| `creator` \| `id`) |
| Spend | `p 1sat input id <key>` (BRC-164); per-action only |
| Probe | `[0, "p 1sat probe"]` (BRC-98 rest token) |

## Done

- [x] Multi-scheme modules (test-app, yours-wallet)
- [x] Spend labels + legacy parse
- [x] View scopes: reject bare; require axis tags; rewrite basket; collection/app/creator force `tagQueryMode: all`; id leaves mode
- [x] `p 1sat id` auto-allow
- [x] Ordinal dual-stamp helper on main self/list/cancel/buy paths
- [x] Probe constant → `p 1sat probe` (`P1SAT_MODULE_PROTOCOL` / `hasOneSatModule`)

## Remaining (optional)

1. ~~Core module + probe + dual-stamp~~ **Done**  
2. wallet-desktop `createAssetPermissionModules` (skipped for now)  
3. Publish packages when ready  

## Resume

Test-app exercise of module + bsv21 remittance; then publish if green.
