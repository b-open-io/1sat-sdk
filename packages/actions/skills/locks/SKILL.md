---
name: locks
description: "This skill should be used when working with time-locked BSV — locking satoshis until a specific block height, checking lock status, unlocking matured locks, or understanding the lock script. Triggers on 'lock BSV', 'time lock', 'timelock', 'block height lock', 'unlock BSV', 'matured locks', 'lock data', or 'CLTV lock'. Uses @1sat/actions locks module."
disable-model-invocation: true
---

# Timelock

Lock and unlock BSV until block heights with `@1sat/actions`.

## Actions

| Action | Description |
|--------|-------------|
| `listLocks` | List lock UTXOs (metadata/tags; print `id` per row) |
| `getLockData` | Summary totals (total / unlockable / next height) |
| `lockBsv` | Lock sats until height |
| `unlockBsv` | Unlock by `ids?` or all matured |

## List locks (preferred)

```typescript
import { listLocks, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const { outputs } = await listLocks.execute(ctx, {})

for (const o of outputs) {
  const id = o.tags?.find((t) => t.startsWith('id:'))?.slice(3)
  const until = o.tags?.find((t) => t.startsWith('until:'))?.slice(6)
  console.log(id, o.satoshis, until)
}
```

## Summary

```typescript
import { getLockData } from '@1sat/actions'

const data = await getLockData.execute(ctx, {})
// { totalLocked, unlockable, nextUnlock }
```

## Lock

```typescript
import { lockBsv } from '@1sat/actions'

await lockBsv.execute(ctx, {
  requests: [{ satoshis: 10_000, until: 900_000 }],
})
```

CLI: `locks bsv --sats <n> --until <height>` (was `locks lock --blocks`).

## Unlock

```typescript
import { unlockBsv } from '@1sat/actions'

// all matured
await unlockBsv.execute(ctx, {})

// specific ids
await unlockBsv.execute(ctx, { ids: [id1, id2] })
```

Unlocked value returns to funding (not asset tag carry).

## Storage

Basket `lock` (not `locks`).

| Tag | Meaning |
|-----|---------|
| `until:{height}` | Maturity height |
| `id:{…}` | Tracking id |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

Unlock needs `services` for current height.
