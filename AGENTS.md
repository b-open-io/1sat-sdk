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
- `packages/types` shared type definitions
- `packages/constants` shared constants and endpoints
- `packages/utils` shared helpers (encoding/validation/metadata)
- `packages/protocols` protocol templates and script helpers (MAP, Sigma, OrdLock, ordinals)
- `packages/client` API clients and network services
- `packages/core` transaction building and high-level core flows
- `packages/actions` wallet actions
- `packages/wallet` wallet runtime and indexers
- `packages/connect` browser connection layer
- `packages/extension` extension toolkit
- `packages/react` React bindings
- `packages/sdk` aggregate SDK exports
- `examples` usage samples

## Dependency Order (High Level)
Follow this direction for new code:

`types/constants` → `utils` → `protocols` → `client` → `core` → `actions/wallet` → `sdk` → `examples`

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
