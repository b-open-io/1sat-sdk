# Continuation Prompt: CWI Unification

Paste this into a new session to continue execution.

---

## Context

We're unifying all CWI (BRC-100 WalletInterface) creation into `@1sat/wallet/cwi` in the 1sat-sdk monorepo. The full plan is at `1sat-sdk/docs/plans/CWI_UNIFICATION.md`. Read it first.

## What's already done

- `createWebCWI()` exists at `packages/wallet/src/cwi/web.ts` — creates a WalletInterface backed by iframe/postMessage to a remote web wallet. It builds, but has a known bug: it sends `cwi_`-prefixed method names instead of plain names, making it incompatible with the 1sat-website bridge.
- `createEventCWI()` and `createChromeCWI()` exist and work (used by yours-wallet).
- `createCWI(transport)` factory exists at `packages/wallet/src/cwi/factory.ts`.
- `CWIEventName` enum at `packages/wallet/src/cwi/types.ts` has the `cwi_` prefixed values.

## What to do — execute in order

### Step 1: Update CWIEventName to plain method names

In `packages/wallet/src/cwi/types.ts`, change every enum value from `cwi_X` to `X`:
- `cwi_createAction` → `createAction`
- `cwi_getPublicKey` → `getPublicKey`
- etc. for all 25 methods

This single change fixes `createWebCWI()` (it now sends plain names compatible with the 1sat-website bridge) and updates yours-wallet automatically (it uses the enum values, not string literals).

### Step 2: Build and verify

- `bun run --filter '@1sat/wallet' build` — must pass
- `bun run build` — full monorepo build must pass
- Check that `createWebCWI()` would send plain method names by tracing: factory.ts maps `wallet.getPublicKey(args)` → `transport(CWIEventName.GET_PUBLIC_KEY, args)` → which is now `transport('getPublicKey', args)`.

### Step 3: Rebuild yours-wallet

In `../yours-wallet`:
- `bun install` then `bun run build`
- The background.ts switch cases use `CWIEventName.GET_PUBLIC_KEY` etc. — the enum values changed but the enum keys didn't, so the code compiles without changes. The extension now speaks plain method names on the wire.
- Verify build succeeds.

### Step 4: Remove EmbedTransport from @1sat/connect

In `packages/connect/src/transport.ts`, remove the `EmbedTransport` class and `createEmbedTransport` factory function. Update `packages/connect/src/index.ts` to remove those exports. `RedirectTransport` and `AutoTransport` stay for now.

If `AutoTransport` references `EmbedTransport`, it will need to be updated or marked as needing future work. Check before deleting.

### Step 5: Build everything

- `bun run build` — full monorepo
- `bun run lint` — check for issues

## Key files to read

- `1sat-sdk/docs/plans/CWI_UNIFICATION.md` — the full plan
- `1sat-sdk/packages/wallet/src/cwi/types.ts` — CWIEventName enum (change this)
- `1sat-sdk/packages/wallet/src/cwi/factory.ts` — createCWI factory (maps enum to WalletInterface methods)
- `1sat-sdk/packages/wallet/src/cwi/web.ts` — createWebCWI (iframe transport)
- `1sat-sdk/packages/wallet/src/cwi/event.ts` — createEventCWI (extension transport)
- `1sat-sdk/packages/wallet/src/cwi/chrome.ts` — createChromeCWI (extension popup transport)
- `1sat-sdk/packages/connect/src/transport.ts` — EmbedTransport to remove
- `yours-wallet/src/background.ts` — service worker (uses CWIEventName enum)
- `1sat-website/lib/cwi/bridge.ts` — CWIBridge (validates plain method names)

## Important constraints

- Use `bun` for all package operations
- Do not break @1sat/connect's public API beyond removing EmbedTransport
- Do not modify 1sat-website — the bridge/relay are the wallet host side and stay as-is
- Do not add event support to the factory — deferred pending BRC-100 extension proposal
- `AutoTransport` in connect references `EmbedTransport` — handle this dependency when removing EmbedTransport
- Review all changes with me before committing
