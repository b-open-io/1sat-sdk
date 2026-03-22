# Changelog

## 0.0.62

### Added
- `registry` module — shared infrastructure for building on-chain registry packages
- `buildPackageOutputs(files, metadata, privateKey)` — builds ordinal inscription outputs with ord-fs/json manifests, MAP metadata, and AIP signatures
- `detectContentType(filePath)` — MIME type detection from file extensions
- `PackageFile`, `PackageMapMetadata`, `PackageTxOutput`, `PackageTxResult`, `PackageBroadcastResult` types
- `REGISTRY_TYPES` constant with all registry types including `registry:font` (new)
- `RegistryType`, `REGISTRY_TYPE_SET`, `MANIFEST_CONTENT_TYPE` exports
- Supports nested `ord-fs/json` subdirectory manifests for packages with directory structure
- `PackageMapMetadata.app` is generic `string` — works for any publisher (clawnet, theme-token, etc.)
- Index signature on `PackageMapMetadata` for extra MAP fields (e.g. `font.family`, `font.variable`)

### Changed
- Renamed internal `registry.ts` to `action-registry.ts` to free `src/registry/` for the new module

## 0.0.53

### Changed
- Migrated template imports from `@bopen-io/templates` to `@1sat/templates`
- Internal deps now use workspace:* for consistent types across monorepo
