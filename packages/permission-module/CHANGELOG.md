# Changelog

## Unreleased

### Changed
- `createAction` finish passes the approved args' basketed 1-sat outputs to the unlock pipeline as OrdLock v2 delivery targets, so a v2 purchase is refused at signing unless the listed satoshi reaches one of them.

## 0.0.60

### Changed
- Picks up `@1sat/actions@0.0.208`.

## 0.0.59

### Changed
- Picks up `@1sat/actions@0.0.207` for counterparty ordinal and OpNS delivery metadata.

## 0.0.58

### Changed
- Picks up `@1sat/actions@0.0.206` and `@1sat/wallet@0.0.106`.
