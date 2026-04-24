# CRIT-5 driver probe — bun:sqlite boolean binding

**Date:** 2026-04-22
**Outcome:** NON-ISSUE. No code fix required.

## Why this was probed

The entity-surface audit flagged a potential critical bug: `StorageReaderWriter.validateEntityForInsert` mutates `entity[df] = value ? 1 : 0` for every boolean field, **after** snapshotting `v = { ...entity }`. Because the snapshot predates the coercion, `v[df]` still holds the original JS boolean. BunSqlite's `insertRow` binds `v`, so if `bun:sqlite` rejects or mis-handles a bound JS boolean, every insert into any table with a boolean column would fail or corrupt.

The audit could not verify which side of the fence `bun:sqlite` sits on. Probe written to settle it.

## Probe

`/tmp/crit5-bool-probe.ts` (ephemeral; not committed). Binds `true`, `false`, `1`, `0`, `"true"`, `"false"`, `null` into an `INTEGER` column of an in-memory SQLite table; reads back each value.

## Results

| Bound value | Stored value | Outcome |
|---|---|---|
| `true` | `1` | coerced to integer |
| `false` | `0` | coerced to integer |
| `1` | `1` | passthrough |
| `0` | `0` | passthrough |
| `"true"` | `"true"` | stored as TEXT |
| `"false"` | `"false"` | stored as TEXT |
| `null` | `null` | passthrough |

## Interpretation

`bun:sqlite` internally calls `value === true ? 1 : (value === false ? 0 : value)` (or an equivalent numeric coercion) before handing the bind to SQLite. Boolean `true` and `false` produce the exact same stored integer as explicit `1` and `0`.

The "mutate `entity[df]` but bind from `v[df]`" bug the audit was worried about is silent — both paths reach SQLite as `1`/`0` integers regardless of whether the mutation propagated to `v`.

## Decision

- CRIT-5 → **NON-ISSUE**. Plan entry updated. Task #19 (conditional canon fix) will not land.
- No change to `StorageReaderWriter.validateEntityForInsert` or `validateEntityForInsert` override in BunSqlite.
- If a future driver is introduced that is stricter about boolean binding, the canon fix remains a one-line change we can apply at that time.

## Note on round-trip

Reads already normalize back to boolean via `validateEntity`'s `booleanFields` argument. Stored `1` → JS `true`, stored `0` → JS `false`. Full write/read symmetry is preserved.
