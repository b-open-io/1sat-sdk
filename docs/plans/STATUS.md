# Project Plans

| Plan | Status | Description |
|------|--------|-------------|
| [BRC alignment](./2026-08-05-brc-alignment.md) | **Draft** | 147 interop + SDK module: plain baskets, `p 1sat action/input` labels, tags/CI, collections |
| [P1SAT id-first actions](./2026-07-23-p1sat-id-first-actions.md) | **Draft** | id: on all P1SAT basket UTXOs; spends by id; list tags default; consumer updates |
| [CLI id-first wiring](./2026-07-23-cli-id-first-wiring.md) | **Draft** | Wire 1sat CLI to id-first actions; walkthrough in progress |
| [P1SAT permissions](./2026-07-25-p1sat-permissions.md) | **Architecture locked** | Action/module/apply split; intent matrix; OpNS publish canonical |
| [P1SAT permission UI wiring](./2026-07-25-p1sat-permission-ui-wiring.md) | **In progress** | Phase 0 done; Phase 1 view model + UI chrome next · [mockups](./mockups/p1sat-permissions.pen) |
| [P1SAT permission prompts](./2026-07-23-p1sat-permission-prompts.md) | **Archived inventory** | Historical only → see 2026-07-25-p1sat-permissions.md |
| [Permission test harness](./2026-07-25-permission-test-harness.md) | **In progress** | test-app + agent-browser; flow results, fixes applied, harness gotchas |
| [Permission module verification](./2026-07-26-permission-module-verification.md) | **Plan** | Optional services on the module; trust computed live, never stored |
| [Host pack / Paymail](./2026-07-21-hosted-paymail.md) | **In Progress** | Design locked; multi-process impl in trees; ts-stack #297; unify + cutover left |
| [MAP Templates Migration](./2026-03-02-map-templates-migration.md) | **COMPLETE** | SDK-side changes done, Go deferred |
| [CWI Unification](./CWI_UNIFICATION.md) | **COMPLETE** | Method names unified, EmbedTransport removed |
| [CWI/OneSat Separation](./2026-03-06-cwi-onesat-separation.md) | **COMPLETE** | Superseded by CWI Unification |
| [WPM & Message Box](./2026-03-11-wpm-messagebox.md) | **In Progress** | WPM in MCP done, OPNS reverted; message box integration next |

## Completed Work (2026-03-06)

### CWI Unification — @1sat/wallet
- `CWIEventName` values changed from `cwi_` prefix to plain method names
- `createWebCWI()` now compatible with 1sat-website bridge/relay
- `OneSatWallet` dead code class removed (was pulling server-side deps into browser bundles)
- Published: `@1sat/wallet@0.0.15` (CWI names), `@1sat/wallet@0.0.17` (OneSatWallet removed)

### CWI Unification — @1sat/connect
- `EmbedTransport` and `createEmbedTransport` removed from exports
- `AutoTransport`, `RedirectTransport` retained (deferred)
- Published: `@1sat/connect@0.0.9`

### 1sat-website — wallet-remote migration
- Swapped `@1sat/wallet-browser` → `@1sat/wallet-remote` across 6 files
- `createWebWallet` → `createRemoteWallet` with remote storage URL
- Monitor removed (remote wallet server handles monitoring)
- Legacy balance surfaced from GorillaPool funding UTXOs
- Sweep BSV button wired to `sweepBsv` from `@1sat/actions`
- Build passes (Turbopack, no module-not-found errors)
- Changes unstaged on `omega` branch

## Completed Plans (Earlier)

| Plan | Status | Description |
|------|--------|-------------|
| MAP Templates Migration | **COMPLETE** | SDK changes done in prior session |

## Status Legend

- **Not Started**: Plan created, work not begun
- **In Progress**: Active development
- **BLOCKED**: Waiting on dependency or issue resolution
- **COMPLETE**: Work finished and verified
