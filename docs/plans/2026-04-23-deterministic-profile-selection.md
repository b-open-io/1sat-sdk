# Deterministic BAP Profile Selection

**Date:** 2026-04-23
**Scope:** `@1sat/actions` — `src/identity/index.ts`

## Problem

`getProfile` in `packages/actions/src/identity/index.ts` is non-deterministic when multiple `type:alias` outputs exist in the `bap` basket. It calls `listOutputs(...).outputs[0]` with no sort — picks whatever the storage layer returns first — then relinquishes the rest. If the "first" happens to be stale, the real current profile gets discarded.

Multiple alias outputs accumulate from remote-storage sync (history preserved by the backend), concurrent updates from multiple wallet instances, and partial failures mid-update.

Existing nearby signals don't help:
- `created_at` on `TableTransaction` is local insertion time, not chain time — sync overwrites it.
- `listOutputs` / `listActions` sort by local auto-increment keys (`outputId` / `transactionId`), also set at sync time.
- `TableProvenTx.height` exists but is not exposed or sortable via `listOutputs` / `listActions`.
- BAP ALIAS on-chain protocol doesn't carry a sequence number (only ID/ATTEST/REVOKE do — see `packages/templates/src/bitcom/bap.ts:108-116`).
- BRC-114 "action time from/to" labels (`wallet-toolbox/src/utility/brc114ActionTimeLabels.ts`) filter by `created_at` — same broken column.

Only tag values survive sync intact.

## Approach

1. **Write a `publishedAt:<unix-ms>` tag on every new ALIAS output.** Publisher's wall clock. Lives in the tag, so it survives sync.
2. **`getProfile` does a two-pass selection using the existing `id:<hex>` tag:**
   - Pass 1 — tag-only scan (no locking scripts). Sort candidates by `publishedAt`. Grab the winner's `id:` tag.
   - Pass 2 — exact fetch by `['type:alias', 'id:<winner>']` with `tagQueryMode: 'all'` and locking script.
   - Decode the script. Relinquish losers.

The `id:<hex>` tag is already stamped by [createTrackedAction](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/utils/createTrackedAction.ts#L26-L35) on every basketed output — unique per action, perfect for targeted lookup. `publishedAt:<ms>` is the sort key only.

Future option (not in this plan): replace `publishedAt` values with block heights via a backfill once `wallet-toolbox` exposes `provenTx.height` on `listOutputs`. The selection logic doesn't need to change — it sorts by the numeric part of whatever is in the tag.

## Legacy records

Aliases published before this fix have no `publishedAt:` tag. Treat missing tag as "oldest possible" — the first post-fix update wins. Self-heals on first update.

If all candidates lack `publishedAt:`, behavior falls back to the current non-deterministic `outputs[0]`. This is not worse than today for legacy-only accounts.

## Files

- **Modify:** `packages/actions/src/identity/index.ts` — `updateProfile` + `getProfile`
- **Create:** `packages/actions/src/identity/pickNewestAlias.ts` — pure helper for sort + winner selection (unit-testable without a wallet)
- **Create:** `packages/actions/test/pickNewestAlias.test.ts` — unit tests for the helper

No public API changes. `ProfileResponse` shape unchanged.

---

## Tasks

### Task 1 — Extract the sort/pick helper

Pure function over `WalletOutput[]` with tag strings. No wallet dependency. Fully unit-testable.

**Files:**
- Create: `packages/actions/src/identity/pickNewestAlias.ts`

- [ ] **Step 1.1 — Create helper module**

File: `packages/actions/src/identity/pickNewestAlias.ts`

```ts
import type { WalletOutput } from '@bsv/sdk'

export interface AliasCandidate {
	outpoint: string
	id: string | null
	publishedAt: number | null
}

const PUBLISHED_AT_PREFIX = 'publishedAt:'
const ID_PREFIX = 'id:'

function parseCandidate(output: WalletOutput): AliasCandidate {
	let id: string | null = null
	let publishedAt: number | null = null

	for (const tag of output.tags ?? []) {
		if (tag.startsWith(PUBLISHED_AT_PREFIX)) {
			const raw = tag.slice(PUBLISHED_AT_PREFIX.length)
			const n = Number(raw)
			if (Number.isFinite(n)) publishedAt = n
		} else if (tag.startsWith(ID_PREFIX)) {
			id = tag.slice(ID_PREFIX.length)
		}
	}

	return { outpoint: output.outpoint, id, publishedAt }
}

/**
 * Given a set of `type:alias` outputs, pick the newest by `publishedAt:<ms>` tag.
 *
 * Tie-breaks on outpoint lexicographically (deterministic across wallets).
 *
 * Candidates without a `publishedAt:` tag are treated as older than any tagged
 * candidate. If no candidate has a `publishedAt:` tag, returns the first by
 * outpoint lex order.
 *
 * Returns null if the input is empty.
 */
export function pickNewestAlias(
	outputs: WalletOutput[],
): { winner: AliasCandidate; losers: AliasCandidate[] } | null {
	if (outputs.length === 0) return null

	const candidates = outputs.map(parseCandidate)

	candidates.sort((a, b) => {
		const aAt = a.publishedAt
		const bAt = b.publishedAt
		if (aAt !== null && bAt !== null) {
			if (aAt !== bAt) return bAt - aAt
		} else if (aAt !== null) {
			return -1
		} else if (bAt !== null) {
			return 1
		}
		return a.outpoint < b.outpoint ? -1 : a.outpoint > b.outpoint ? 1 : 0
	})

	const [winner, ...losers] = candidates
	return { winner, losers }
}
```

- [ ] **Step 1.2 — Commit**

```bash
git add packages/actions/src/identity/pickNewestAlias.ts
git commit -m "feat(actions): add pickNewestAlias helper for deterministic profile selection"
```

---

### Task 2 — Unit tests for the helper

**Files:**
- Create: `packages/actions/test/pickNewestAlias.test.ts`

- [ ] **Step 2.1 — Write the tests**

File: `packages/actions/test/pickNewestAlias.test.ts`

```ts
import { describe, expect, test } from 'bun:test'
import type { WalletOutput } from '@bsv/sdk'
import { pickNewestAlias } from '../src/identity/pickNewestAlias'

function out(outpoint: string, tags: string[]): WalletOutput {
	return { satoshis: 0, spendable: true, outpoint, tags }
}

describe('pickNewestAlias', () => {
	test('returns null for empty input', () => {
		expect(pickNewestAlias([])).toBeNull()
	})

	test('picks the highest publishedAt', () => {
		const a = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])
		const b = out('bbbb.0', ['type:alias', 'id:B', 'publishedAt:3000'])
		const c = out('cccc.0', ['type:alias', 'id:C', 'publishedAt:2000'])

		const result = pickNewestAlias([a, b, c])
		expect(result).not.toBeNull()
		expect(result!.winner.id).toBe('B')
		expect(result!.winner.publishedAt).toBe(3000)
		expect(result!.losers.map((l) => l.id)).toEqual(['C', 'A'])
	})

	test('untagged candidates rank below any tagged candidate', () => {
		const tagged = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:500'])
		const untagged = out('bbbb.0', ['type:alias', 'id:B'])

		const result = pickNewestAlias([untagged, tagged])
		expect(result!.winner.id).toBe('A')
		expect(result!.losers[0].id).toBe('B')
	})

	test('falls back to lexicographic outpoint when no tags have publishedAt', () => {
		const a = out('bbbb.0', ['type:alias', 'id:B'])
		const b = out('aaaa.0', ['type:alias', 'id:A'])

		const result = pickNewestAlias([a, b])
		expect(result!.winner.id).toBe('A')
		expect(result!.winner.outpoint).toBe('aaaa.0')
	})

	test('ties on publishedAt break on outpoint', () => {
		const a = out('bbbb.0', ['type:alias', 'id:B', 'publishedAt:1000'])
		const b = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])

		const result = pickNewestAlias([a, b])
		expect(result!.winner.id).toBe('A')
	})

	test('malformed publishedAt values are ignored', () => {
		const good = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])
		const bad = out('bbbb.0', ['type:alias', 'id:B', 'publishedAt:not-a-number'])

		const result = pickNewestAlias([good, bad])
		expect(result!.winner.id).toBe('A')
	})

	test('missing id tag does not crash', () => {
		const o = out('aaaa.0', ['type:alias', 'publishedAt:1000'])
		const result = pickNewestAlias([o])
		expect(result!.winner.id).toBeNull()
		expect(result!.winner.publishedAt).toBe(1000)
	})
})
```

- [ ] **Step 2.2 — Run the tests (must pass)**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
bun test packages/actions/test/pickNewestAlias.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 2.3 — Commit**

```bash
git add packages/actions/test/pickNewestAlias.test.ts
git commit -m "test(actions): cover pickNewestAlias sort and tie-break behavior"
```

---

### Task 3 — Tag new ALIAS outputs with `publishedAt:`

**Files:**
- Modify: `packages/actions/src/identity/index.ts` (updateProfile body)

- [ ] **Step 3.1 — Edit the alias output tags in `updateProfile`**

In `updateProfile.execute` at `packages/actions/src/identity/index.ts:459-531`, add a `publishedAt:` tag computed at the top of the handler (same timestamp for both the ID and ALIAS cases, so they're readable as a pair if needed later).

Replace the block starting at [line 460](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/identity/index.ts#L460):

```ts
		try {
			const existingId = await resolveBapId(ctx)
			const bapId = existingId ?? (await computeBapId(ctx))
```

with:

```ts
		try {
			const publishedAt = Date.now()
			const publishedAtTag = `publishedAt:${publishedAt}`

			const existingId = await resolveBapId(ctx)
			const bapId = existingId ?? (await computeBapId(ctx))
```

Then update both ALIAS output `tags` arrays. At [line 519](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/identity/index.ts#L519) (first-publish branch):

```ts
					tags: ['type:alias', `bapId:${bapId}`],
```

becomes:

```ts
					tags: ['type:alias', `bapId:${bapId}`, publishedAtTag],
```

And at [line 529](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/identity/index.ts#L529) (update-existing branch):

```ts
					tags: ['type:alias', `bapId:${bapId}`],
```

becomes:

```ts
					tags: ['type:alias', `bapId:${bapId}`, publishedAtTag],
```

Do **not** add the tag to the ID output — sequencing for IDs already uses `seq:N` and there's no gap there.

- [ ] **Step 3.2 — Verify the file still type-checks**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
bun run --filter '@1sat/actions' build
```

Expected: build succeeds.

- [ ] **Step 3.3 — Commit**

```bash
git add packages/actions/src/identity/index.ts
git commit -m "feat(actions): tag ALIAS outputs with publishedAt for deterministic selection"
```

---

### Task 4 — Rewrite `getProfile` with two-pass selection

**Files:**
- Modify: `packages/actions/src/identity/index.ts` (getProfile body)

- [ ] **Step 4.1 — Replace `getProfile.execute`**

Replace the `execute` body in `getProfile` at [lines 587-631](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/identity/index.ts#L587-L631):

```ts
		async execute(ctx) {
			try {
				const result = await ctx.wallet.listOutputs({
					basket: BAP_BASKET,
					tags: ['type:alias'],
					include: 'locking scripts',
					includeTags: true,
					limit: 100,
				})

				if (!result.outputs.length) {
					return { error: 'no-profile: no alias output in wallet' }
				}

				const primary = result.outputs[0]
				const lockingScript = Script.fromHex(primary.lockingScript ?? '')

				const bitcom = BitCom.decode(lockingScript)
				if (!bitcom) {
					return { error: 'malformed-alias: no bitcom structure found' }
				}

				const bap = BAP.decode(bitcom)
				if (!bap) {
					return { error: 'malformed-alias: no BAP protocol found in bitcom' }
				}

				const bapId = bap.idKey ?? ''
				const profile = bap.profile as Record<string, unknown>

				for (const dup of result.outputs.slice(1)) {
					await ctx.wallet.relinquishOutput({
						basket: BAP_BASKET,
						output: dup.outpoint,
					})
				}

				return { bapId, profile }
			} catch (error) {
				console.error('[getProfile]', error)
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
```

with:

```ts
		async execute(ctx) {
			try {
				// Pass 1 — cheap, tags-only scan to rank candidates
				const scan = await ctx.wallet.listOutputs({
					basket: BAP_BASKET,
					tags: ['type:alias'],
					includeTags: true,
					limit: 10000,
				})

				const picked = pickNewestAlias(scan.outputs)
				if (!picked) {
					return { error: 'no-profile: no alias output in wallet' }
				}

				// Pass 2 — fetch just the winner's locking script.
				// Prefer exact id:<hex> match; fall back to scanning with scripts
				// if the winner lacks an id tag (legacy sync data).
				let winnerOutput: { lockingScript?: string } | undefined
				if (picked.winner.id) {
					const byId = await ctx.wallet.listOutputs({
						basket: BAP_BASKET,
						tags: ['type:alias', `id:${picked.winner.id}`],
						tagQueryMode: 'all',
						include: 'locking scripts',
						limit: 1,
					})
					winnerOutput = byId.outputs[0]
				} else {
					const fallback = await ctx.wallet.listOutputs({
						basket: BAP_BASKET,
						tags: ['type:alias'],
						include: 'locking scripts',
						limit: 10000,
					})
					winnerOutput = fallback.outputs.find(
						(o) => o.outpoint === picked.winner.outpoint,
					)
				}

				if (!winnerOutput?.lockingScript) {
					return { error: 'malformed-alias: winner output has no locking script' }
				}

				const lockingScript = Script.fromHex(winnerOutput.lockingScript)

				const bitcom = BitCom.decode(lockingScript)
				if (!bitcom) {
					return { error: 'malformed-alias: no bitcom structure found' }
				}

				const bap = BAP.decode(bitcom)
				if (!bap) {
					return { error: 'malformed-alias: no BAP protocol found in bitcom' }
				}

				const bapId = bap.idKey ?? ''
				const profile = bap.profile as Record<string, unknown>

				for (const loser of picked.losers) {
					await ctx.wallet.relinquishOutput({
						basket: BAP_BASKET,
						output: loser.outpoint,
					})
				}

				return { bapId, profile }
			} catch (error) {
				console.error('[getProfile]', error)
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
```

- [ ] **Step 4.2 — Add the import**

At the top of `packages/actions/src/identity/index.ts`, add below the existing local import at [line 29](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/identity/index.ts#L29):

```ts
import { pickNewestAlias } from './pickNewestAlias'
```

- [ ] **Step 4.3 — Build and lint**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
bun run lint packages/actions
bun run --filter '@1sat/actions' build
```

Expected: both succeed.

- [ ] **Step 4.4 — Run the helper tests again (regression check)**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
bun test packages/actions/test/pickNewestAlias.test.ts
```

Expected: all 7 tests still pass.

- [ ] **Step 4.5 — Commit**

```bash
git add packages/actions/src/identity/index.ts
git commit -m "refactor(actions): getProfile picks newest alias deterministically"
```

---

### Task 5 — Manual integration smoke test

Automated integration tests are out of scope — `packages/actions/test/actions.test.ts` runs against real remote-wallet test contexts and has no identity coverage today. Verify manually against a test wallet before handing off.

- [ ] **Step 5.1 — Via MCP bsv-mcp tools against the PRIMARY test wallet:**

1. Call `updateProfile` twice with different profile data, a few seconds apart.
2. Call `getProfile` — confirm it returns the **second** profile's data.
3. Inspect the basket (via `listOutputs` or admin data explorer) and confirm only one `type:alias` output remains after the second `updateProfile` relinquishes the prior one, and it carries a `publishedAt:<ms>` tag.
4. Simulate the multi-record case: clear the PRIMARY wallet cache so a fresh sync pulls history — or manually inject a stale alias output via the admin explorer — and confirm `getProfile` returns the newer one regardless of listOutputs order.

- [ ] **Step 5.2 — Document findings in the PR description**

Capture the three scenarios above with outpoints and returned `profile` payloads.

---

## Self-review

**Spec coverage:**
- Deterministic newest-pick across synced records → Tasks 1, 4 (helper + two-pass selection)
- Sort signal that survives sync → Task 3 (`publishedAt:<ms>` tag)
- Targeted fetch without scanning all scripts → Task 4 (uses `id:<hex>` tag stamped by existing [createTrackedAction](/Users/davidcase/Source/1sat/1sat-sdk/packages/actions/src/utils/createTrackedAction.ts#L26-L35))
- Legacy (no `publishedAt:`) self-heals → Task 1 helper sort rules + Task 4 fallback branch
- Future block-height swap is non-breaking → documented in Approach

**Placeholder scan:** none. Every step has exact code or an exact command.

**Type consistency:** `AliasCandidate`, `pickNewestAlias` shape used identically in helper, tests, and getProfile. Tag prefixes (`publishedAt:`, `id:`, `type:alias`, `bapId:`) match existing conventions in `updateProfile` and `createTrackedAction`.
