# AGENTS

Agent instructions for the `1sat-sdk` monorepo.

## Goals
- Keep package boundaries clean and dependency direction stable.
- Preserve browser/node runtime compatibility.
- Prefer small, focused changes with validation.

## Tooling and Commands
Always use Bun and workspace scripts.

- `bun dev` run watch/dev scripts across workspaces
- `bun run build` build all packages/examples
- `bun run lint` Biome check
- `bun run lint:fix` Biome auto-fix
- `bun test` run tests
- `bun run --filter '@1sat/<package>' build` build one package
- `bun run --filter '@1sat/<package>' dev` watch one package

## Monorepo Layout
- `packages/types` shared type definitions and constants
- `packages/utils` shared helpers (encoding/validation/metadata)
- `packages/client` API clients and network services
- `packages/core` transaction building, protocol implementations (MAP, Sigma, OrdLock, ordinals), and high-level core flows
- `packages/actions` wallet actions
- `packages/wallet` wallet runtime and indexers
- `packages/connect` browser connection layer
- `packages/extension` extension toolkit
- `packages/react` React bindings
- `packages/sdk` aggregate SDK exports
- `examples` usage samples

## Dependency Order (High Level)
Follow this direction for new code:

`types` → `utils` → `client` → `core` → `actions/wallet` → `sdk` → `examples`

Additional constraints:
- `connect` is browser-focused and should remain independent from core wallet logic.
- `react` depends on `connect` only.
- `sdk` is an export aggregator; avoid adding business logic there.

## Protocol Context
Primary domain: 1Sat + BSV protocols (ordinals, BSV21 tokens, MAP, Sigma, OrdLock listings, ORDFS content).

## Coding Conventions
- Use Bun for all scripts and package operations.
- Use Biome for linting/formatting.
- Do not use `Buffer` or browser polyfills for conversions; use `@bsv/sdk` utils.
- Do not use dynamic imports inside methods.
- Do not use star imports (`import * as ...`).
- Keep runtime-specific entrypoints separate (`browser` vs `node`) where applicable.
- Prefer explicit named exports from package entrypoints.

## Action Conventions (packages/actions)
- **All actions** must use `createTrackedAction` instead of raw `wallet.createAction`. This adds ID tags to basketed outputs for targeted lookups.
- **Actions spending wallet-owned inputs** must make `inputBEEF` optional with `resolveBeef` fallback. The helper looks up BEEF via the output's ID tag.
- **Actions spending external inputs** (e.g. purchasing a listing from another user) require `inputBEEF` — the caller's wallet has no BEEF for outputs it doesn't own.
- **All two-phase actions** (signAndProcess: false) must use `completeSignedAction` for signing. It handles BEEF merge, script verification, signAction, and abort on failure.
- **Template methods** (`OrdLock.cancelWithWallet`, `Lock.unlockWithWallet`) must be used for contract unlocking instead of manual signature construction. They handle sighash byte appending correctly.

## Working Rules for Agents
- Edit the smallest set of files required.
- Avoid cross-package deep imports; import through package entrypoints.
- If you add a public API:
  - update the package `src/index.ts`
  - update `package.json` `exports` when needed
  - update README/examples if behavior changed
- Keep temporary artifacts out of commits (`dist`, scratch files, debug scripts).

## Validation Checklist
Run after meaningful changes:

1. `bun run lint`
2. `bun run build`
3. `bun test` (when tests exist or behavior changed)

For package-scoped changes, run targeted builds first, then run full repo checks before finalizing.
