# Session handoff — accounts / capacity gate

Two prompts below: one to include when calling `/compact`, one to kick
off the next session after compaction.

---

## Prompt to include in the /compact call

> Preserve these, even if compressed aggressively:
>
> - **Architectural decisions that were hard-won:** why we use 507 not 402
>   for wallet-storage self-billing (BRC-0121 auto-retry deadlocks against
>   `WalletStorageManager`'s non-reentrant writer lock when the payment-
>   building `wallet.createAction` re-enters the same manager);
>   refund-credit pricing model supersedes a staggered-expiry one;
>   Monitor lives in the factory (not per-wrapper) with a BackupSync task
>   that only fires on local-active.
> - **Deployment state:** mss1 wallet-server is on commit `5429842`, running
>   with `accounts.enabled=true`, `baselineBytes=5120`, `purchaseUnitBytes=5120`,
>   `satsPerUnit=5`, `durationBlocks=10`. David's local CLI has
>   `activeRemote=http://mss1:8100/`, usage ≈ 10 KB, deficit ≈ 4.9 KB.
> - **Open work list:** (1) factory-level wrap around
>   `wallet.createAction/signAction/processAction` that catches the 507,
>   tops up via a local-active payment path, retries the original; (2) CLI
>   `1sat remote topup`; (3) per-remote fund/disconnect policy +
>   `onStorageFunded`/`onStorageDisconnected` callbacks; (4) StoragePg
>   provider mirroring StorageBunSqlite with accounts tables.
> - **File pointers:** `docs/plans/2026-04-20-accounts-capacity-gate.md` is
>   the canonical plan. `packages/wallet-server/src/accounts/middleware.ts`
>   has the 507 gate + `/account/payment` handler.
> - **The rule I should follow:** do not narrate or suggest we "pause for
>   the night." Report, propose, or ask — no projected fatigue.
>
> Drop: specific stack traces, debug console.error traces we added/removed,
> abandoned approaches (knex-based accounts tables, `@bsv/payment-express-middleware`
> integration, separate accounts file), intermediate build errors.

---

## Prompt to run after compaction

> Continuing the `@1sat/wallet-server` accounts / capacity gate feature.
> The plan doc at `docs/plans/2026-04-20-accounts-capacity-gate.md`
> describes what shipped and what's next. Read it first.
>
> State at handoff:
>
> - Server side is live on mss1 (commit `5429842`). 507 gate on billable
>   RPCs when over capacity; `POST /account/payment` accepts a BRC-29
>   payment and records capacity. `WalletServerClient.postPayment` wraps it.
> - Client side has no auto-retry yet. Writes against an over-capacity
>   remote error out with `network error 507 507`, which is the correct
>   post-fix-deadlock behavior — not a bug, just unfinished UX.
> - mss1 test preset: `baselineBytes=5120`, `purchaseUnitBytes=5120`,
>   `satsPerUnit=5`, `durationBlocks=10`. My local CLI has
>   `activeRemote=http://mss1:8100/` and is currently over capacity
>   (~4.9 KB deficit).
>
> Remaining work the user and I agreed on:
>
> 1. **Factory auto-retry.** Wrap `wallet.createAction/signAction/processAction`
>    at the `@1sat/wallet` factory level. On 507 from the active remote:
>    build a BRC-29 payment (dedicated payment wallet with local-only
>    storage, OR flip active to local while no lock is held), call
>    `WalletServerClient.postPayment`, retry the original call.
> 2. **Per-remote policy.** Factory accepts
>    `remotePolicy?: 'fund' | 'disconnect'` default and
>    `remotePolicies?: Record<url, policy>` override, plus
>    `onStorageFunded` / `onStorageDisconnected` callbacks.
> 3. **CLI `1sat remote topup`.** Explicit manual top-up command.
> 4. **Postgres provider.** Native `StoragePg` that mirrors
>    `StorageBunSqlite`, accounts tables included in its migrations.
>
> Confirm which of these to tackle first before writing code. Do NOT
> sprint. The previous session went down a few rabbit holes that would
> have been avoided by asking first.
