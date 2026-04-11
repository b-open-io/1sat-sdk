# Changelog

## 0.0.19

### Fixed
- Picks up `@1sat/actions@0.0.82` — AIP signed-message fix (trailing `|` separator now included). Affects any sweep flow that produces BAP identity or profile transactions.

## 0.0.10

### Fixed
- Updated @1sat/actions to 0.0.69 — sweep ordinals now tags name from ORDFS metadata, origin handling for inscriptions

## 0.0.9

### Fixed
- Updated @1sat/actions dependency to 0.0.68 which fixes signAction abort protection and sweep signing flow
