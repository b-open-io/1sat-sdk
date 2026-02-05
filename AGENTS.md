# AGENTS

## Commands
- `bun dev`
- `bun run build`
- `bun run lint`
- `bun run lint:fix`
- `bun test`

## Monorepo layout
- `packages/types` shared types
- `packages/constants` shared constants
- `packages/utils` shared helpers
- `packages/protocols` script templates (MAP, Sigma, OrdLock, ordinals)
- `packages/core` transaction builder
- `packages/client` API clients
- `packages/actions` wallet actions (renamed from skills)
- `packages/wallet` wallet runtime (indexers, address-sync, backup, cwi, factory)
- `packages/connect` browser connect layer
- `packages/extension` extension toolkit
- `packages/react` React integration
- `packages/sdk` aggregated exports
- `examples` sample apps

## Dependency order (high level)
`types/constants` → `utils/protocols` → `core/client` → `actions/wallet` → `sdk` → `examples`

## Protocol context
1Sat + BSV protocols: ordinals, BSV21 tokens, MAP, Sigma, OrdLock listings, ORDFS content.

## Conventions
- Always use Bun
- Use Biome for linting/formatting
- No Buffer or polyfill; use `@bsv/sdk` Utils for conversions
- No dynamic imports inside methods
- No star imports

## Testing
- `bun run lint`
- `bun run build`
- `bun test` (when tests exist)
