# Storage Fee Repricer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in background task to `1sat serve monitor` that periodically fetches the BSV/USD exchange rate and updates `server.accounts.satsPerUnit` in `~/.1sat/cli/config.json` so operators can price storage in USD. The fleet of parallel `serve wallet` processes pick up the new price via a per-request loader with a TTL cache.

**Architecture:**
- A `WalletMonitorTask` registered on the Monitor in `1sat serve monitor` (single process per box, even with N wallet processes).
- Task reads rate from a pluggable `RateProvider` (only WhatsOnChain shipped), computes new sats via a pure function with bounds, and writes via `setConfigPath` (disk only).
- Wallet servers no longer hold a static pricing object. The middleware deps expose a `getConfig()` callable instead. The CLI implementations passes a loader that re-reads `~/.1sat/cli/config.json` with a 60s TTL cache.
- On rate fetch failure: log and keep serving the last successfully-written price.

**Tech Stack:** TypeScript, Bun, `bun:test`, `@bsv/wallet-toolbox` Monitor, WhatsOnChain HTTP API.

---

## Deployment Context (verified)

On `ovh-n0001` today:

- 1× `bunx @1sat/cli serve monitor`
- 4× `bunx @1sat/cli serve wallet`
- 1× `bunx @1sat/cli serve messagebox`
- All processes share `~/.1sat/cli/config.json`. Same box, same user.

Implication: a single repricer in the monitor is enough. Wallet processes need a way to see the change without restart. The disk-loader-with-cache approach does that with one small file read per minute per process.

## Settled Design Decisions

1. **Lives in `@1sat/cli`**, registered only when `mode === 'monitor'` or `mode === 'all'`.
2. **Opt-in** via `server.accounts.enabled` AND `server.accounts.repricer.enabled`.
3. **No `maxSats` ceiling.** `maxMovePct = 25` is enough — a real crash gets ratcheted in 25% steps.
4. **60s TTL** on the wallet-server's pricing reload.
5. **Pluggable rate provider** via interface; only WhatsOnChain in v1.
6. **Failure mode**: keep the last known price; log; no escalation.
7. **`wallet-server` deps change**: `config: AccountsConfig` → `getConfig: () => AccountsConfig`. Wallet-server still owns the `AccountsConfig` type. The CLI satisfies the contract by supplying a TTL-cached disk reader.

---

## File Structure

**New files:**
- `packages/cli/src/repricer/types.ts`
- `packages/cli/src/repricer/whatsOnChain.ts`
- `packages/cli/src/repricer/providers.ts`
- `packages/cli/src/repricer/computeReprice.ts`
- `packages/cli/src/repricer/buildPriceUpdateTask.ts`
- `packages/cli/src/repricer/configLoader.ts` — TTL-cached disk reader for `AccountsConfig`
- `packages/cli/src/repricer/index.ts`
- `packages/cli/test/repricer.computeReprice.test.ts`
- `packages/cli/test/repricer.whatsOnChain.test.ts`
- `packages/cli/test/repricer.priceUpdateTask.test.ts`
- `packages/cli/test/repricer.configLoader.test.ts`

**Modified files:**
- `packages/wallet-server/src/accounts/types.ts` — add `AccountsConfigProvider` type
- `packages/wallet-server/src/accounts/middleware.ts` — `deps.config` → `deps.getConfig()`
- `packages/wallet-server/src/accounts/paymentRoute.ts` — same
- `packages/wallet-server/src/createWalletServer.ts` — `accounts.config` → `accounts.getConfig`
- `packages/wallet-server/test/createWalletServer.test.ts` (and any others passing `accounts.config`)
- `packages/cli/src/config.ts` — add `RepricerConfig`
- `packages/cli/src/commands/serve.ts` — supply `getConfig` loader; register task in monitor modes

---

## Task 0: Verify CLI test scaffolding

The CLI package has no existing `test/` directory.

- [ ] Run `cat /Users/davidcase/Source/1sat/1sat-sdk/packages/cli/package.json | grep -A 5 '"scripts"'`. If a `test` script using `bun test` is absent, add it:

```json
"test": "bun test"
```

- [ ] Run `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test` and confirm it runs (even "no tests found" is fine).

- [ ] Commit only if `package.json` changed:

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
git add packages/cli/package.json
git commit -m "chore(cli): add bun test script"
```

---

## Task 1: Change wallet-server middleware deps to use a loader

This is the biggest contract change. Land it first so the rest is plumbing.

**Files:**
- Modify: `packages/wallet-server/src/accounts/types.ts` (add new export)
- Modify: `packages/wallet-server/src/accounts/middleware.ts` (interface + readers)
- Modify: `packages/wallet-server/src/accounts/paymentRoute.ts` (interface + readers)
- Modify: `packages/wallet-server/src/createWalletServer.ts` (pass-through)
- Modify: `packages/wallet-server/test/createWalletServer.test.ts` (and any other tests passing `accounts.config`)

- [ ] **Step 1: Add the `AccountsConfigProvider` type**

Append to `packages/wallet-server/src/accounts/types.ts`:

```ts
/**
 * Pricing/capacity contract for the accounts layer. Wallet-server reads
 * config through this function on every billing check so deployments can
 * provide live values (e.g. file-watched, TTL-cached, or static).
 */
export type AccountsConfigProvider = () => AccountsConfig
```

- [ ] **Step 2: Update `AccountsMiddlewareDeps` in middleware.ts**

Find the `AccountsMiddlewareDeps` interface in `packages/wallet-server/src/accounts/middleware.ts`. Replace its `config: AccountsConfig` field with:

```ts
	getConfig: AccountsConfigProvider
```

Add the import:

```ts
import type {
	AccountsConfig,
	AccountsConfigProvider,
	IdentityKey,
	NextPaymentDerivation,
} from './types'
```

- [ ] **Step 3: Update every middleware reader**

In `middleware.ts`, replace every `deps.config.X` with a single fetch at the top of each handler that reads it:

```ts
const config = deps.getConfig()
// ...then use config.satsPerUnit, config.baselineBytes, etc.
```

Confirm via grep that no `deps.config.` reference remains:

```bash
grep -n "deps.config\." /Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-server/src/accounts/middleware.ts
```

Expected output: nothing.

- [ ] **Step 4: Repeat for `paymentRoute.ts`**

Same pattern: replace the `config: AccountsConfig` field on the `deps` parameter with `getConfig: AccountsConfigProvider`, and call `const config = deps.getConfig()` at the top of each handler.

Confirm via grep:

```bash
grep -n "deps.config\." /Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-server/src/accounts/paymentRoute.ts
```

Expected: nothing.

- [ ] **Step 5: Update `createWalletServer.ts`**

In `packages/wallet-server/src/createWalletServer.ts`, locate the `config.accounts` access (around line 87-95) and replace:

```ts
const accountsDeps: AccountsMiddlewareDeps | undefined = config.accounts
	? {
			getConfig: config.accounts.getConfig,
			walletStorage: config.storage,
			wallet,
			serverIdentityKey,
			currentBlock: config.accounts.currentBlock,
		}
	: undefined
```

Update the `mountPaymentRoute` call to pass `getConfig: accountsDeps.getConfig` instead of `config: accountsDeps.config`.

Find the `accounts` option type on `createWalletServer`'s public `config` parameter (look for `accounts?:` in the same file) and change the inner `config: AccountsConfig` field to `getConfig: AccountsConfigProvider`. Add the type import as needed.

- [ ] **Step 6: Update wallet-server tests**

```bash
grep -rln "accounts.*config:\|accounts:.*{.*config:" /Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-server/test/
```

For each match, change the test setup from `accounts: { config: { ... }, currentBlock: ... }` to `accounts: { getConfig: () => ({ ... }), currentBlock: ... }`.

- [ ] **Step 7: Build + test wallet-server**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@bsv/wallet-server' build && bun run --filter '@bsv/wallet-server' test
```

(Use the actual package name from `packages/wallet-server/package.json` if different.) Expected: clean build, all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
git add packages/wallet-server/
git commit -m "feat(wallet-server): swap static accounts config for getConfig provider"
```

---

## Task 2: Add `RepricerConfig` to CLI config schema

**Files:**
- Modify: `packages/cli/src/config.ts`

- [ ] **Step 1: Add the interface**

Insert above `ServerAccountsConfig` in `packages/cli/src/config.ts`:

```ts
export interface RepricerConfig {
	/** Master toggle. Defaults to false. */
	enabled?: boolean
	/** Target price per `purchaseUnitBytes` chunk, in USD. */
	targetUsd?: number
	/** Interval between rate checks in ms. Defaults to 900000 (15 min). */
	intervalMs?: number
	/** Rate provider name. Defaults to "whatsonchain". */
	provider?: string
	/** Max percent change allowed per update. Larger moves are skipped. Defaults to 25. */
	maxMovePct?: number
	/** Lower bound for `satsPerUnit`. Defaults to 1. */
	minSats?: number
}
```

- [ ] **Step 2: Embed under `ServerAccountsConfig`**

Add as the last field of `ServerAccountsConfig`:

```ts
	/** Optional auto-repricer. When enabled, updates `satsPerUnit` from a live BSV/USD rate. */
	repricer?: RepricerConfig
```

- [ ] **Step 3: Build CLI**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
git add packages/cli/src/config.ts
git commit -m "feat(cli): add repricer config schema"
```

---

## Task 3: Repricer types and `RateProvider` interface

**Files:**
- Create: `packages/cli/src/repricer/types.ts`

- [ ] **Step 1: Write the types file**

```ts
export interface BsvUsdQuote {
	bsvUsd: number
	timestamp: number
	source: string
}

export interface RateProvider {
	readonly name: string
	getBsvUsd(): Promise<BsvUsdQuote>
}

export interface RepricerBounds {
	/** Reject moves larger than this percent. */
	maxMovePct: number
	/** Floor for the new sats value. */
	minSats: number
}

export interface ComputeRepriceInput {
	targetUsd: number
	bsvUsd: number
	currentSats: number
	bounds: RepricerBounds
}

export type ComputeRepriceResult =
	| { status: 'ok'; newSats: number }
	| { status: 'skipped'; reason: string }
```

- [ ] **Step 2: Build**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
git add packages/cli/src/repricer/types.ts
git commit -m "feat(cli): add repricer types and RateProvider interface"
```

---

## Task 4: `computeReprice` pure function

**Files:**
- Create: `packages/cli/src/repricer/computeReprice.ts`
- Create: `packages/cli/test/repricer.computeReprice.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/repricer.computeReprice.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { computeReprice } from '../src/repricer/computeReprice'
import type { RepricerBounds } from '../src/repricer/types'

const DEFAULT_BOUNDS: RepricerBounds = { maxMovePct: 25, minSats: 1 }

describe('computeReprice', () => {
	test('$1 target at $50/BSV → 2_000_000 sats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 2_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r).toEqual({ status: 'ok', newSats: 2_000_000 })
	})

	test('rounds to nearest integer sats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 30,
			currentSats: 3_333_333,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('ok')
	})

	test('skips when move exceeds maxMovePct', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 1_000_000, // would compute 2_000_000, +100%
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
		if (r.status === 'skipped') expect(r.reason).toMatch(/maxMovePct/)
	})

	test('skips when below minSats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 1000, // computes 100_000
			currentSats: 100_000,
			bounds: { maxMovePct: 100, minSats: 200_000 },
		})
		expect(r.status).toBe('skipped')
	})

	test('rejects non-positive bsvUsd', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 0,
			currentSats: 1_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
	})

	test('rejects non-positive targetUsd', () => {
		const r = computeReprice({
			targetUsd: 0,
			bsvUsd: 50,
			currentSats: 1_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
	})

	test('accepts no-op (same value)', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 2_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r).toEqual({ status: 'ok', newSats: 2_000_000 })
	})
})
```

- [ ] **Step 2: Verify tests fail**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test
```

Expected: module-not-found.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/repricer/computeReprice.ts`:

```ts
import type { ComputeRepriceInput, ComputeRepriceResult } from './types'

const SATS_PER_BSV = 100_000_000

export function computeReprice(
	input: ComputeRepriceInput,
): ComputeRepriceResult {
	const { targetUsd, bsvUsd, currentSats, bounds } = input

	if (!(targetUsd > 0)) return { status: 'skipped', reason: 'targetUsd must be > 0' }
	if (!(bsvUsd > 0)) return { status: 'skipped', reason: 'bsvUsd must be > 0' }
	if (!(currentSats > 0))
		return { status: 'skipped', reason: 'currentSats must be > 0' }

	const newSats = Math.round((targetUsd / bsvUsd) * SATS_PER_BSV)

	if (newSats < bounds.minSats) {
		return {
			status: 'skipped',
			reason: `computed ${newSats} is below minSats ${bounds.minSats}`,
		}
	}

	const movePct = (Math.abs(newSats - currentSats) / currentSats) * 100
	if (movePct > bounds.maxMovePct) {
		return {
			status: 'skipped',
			reason: `move ${movePct.toFixed(2)}% exceeds maxMovePct ${bounds.maxMovePct}`,
		}
	}

	return { status: 'ok', newSats }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test
```

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
bun run lint
git add packages/cli/src/repricer/computeReprice.ts packages/cli/test/repricer.computeReprice.test.ts
git commit -m "feat(cli): add computeReprice pure pricing function"
```

---

## Task 5: WhatsOnChain rate provider

**Files:**
- Create: `packages/cli/src/repricer/whatsOnChain.ts`
- Create: `packages/cli/test/repricer.whatsOnChain.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/repricer.whatsOnChain.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { createWhatsOnChainProvider } from '../src/repricer/whatsOnChain'

const realFetch = globalThis.fetch

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
	globalThis.fetch = (async () => ({
		ok: response.ok,
		status: response.status ?? (response.ok ? 200 : 500),
		json: async () => response.body,
		text: async () => JSON.stringify(response.body),
	})) as unknown as typeof globalThis.fetch
}

describe('createWhatsOnChainProvider', () => {
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test('parses a valid response', async () => {
		mockFetch({ ok: true, body: { currency: 'USD', rate: 47.12, time: 1715000000 } })
		const provider = createWhatsOnChainProvider({ chain: 'main' })
		const q = await provider.getBsvUsd()
		expect(q.source).toBe('whatsonchain')
		expect(q.bsvUsd).toBe(47.12)
	})

	test('throws on non-ok status', async () => {
		mockFetch({ ok: false, status: 503, body: 'down' })
		await expect(
			createWhatsOnChainProvider({ chain: 'main' }).getBsvUsd(),
		).rejects.toThrow(/503/)
	})

	test('throws on malformed payload', async () => {
		mockFetch({ ok: true, body: { currency: 'USD' } })
		await expect(
			createWhatsOnChainProvider({ chain: 'main' }).getBsvUsd(),
		).rejects.toThrow(/rate/)
	})

	test('uses testnet URL when chain=test', async () => {
		let captured = ''
		globalThis.fetch = (async (url: string) => {
			captured = url
			return {
				ok: true,
				status: 200,
				json: async () => ({ currency: 'USD', rate: 1, time: 1 }),
				text: async () => '',
			}
		}) as unknown as typeof globalThis.fetch
		await createWhatsOnChainProvider({ chain: 'test' }).getBsvUsd()
		expect(captured).toContain('/test/')
	})
})
```

- [ ] **Step 2: Verify they fail**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test
```

- [ ] **Step 3: Write the implementation**

`packages/cli/src/repricer/whatsOnChain.ts`:

```ts
import type { BsvUsdQuote, RateProvider } from './types'

export interface WhatsOnChainOptions {
	chain: 'main' | 'test'
	/** Override base URL (testing). */
	baseUrl?: string
}

export function createWhatsOnChainProvider(
	options: WhatsOnChainOptions,
): RateProvider {
	const base = options.baseUrl ?? 'https://api.whatsonchain.com/v1/bsv'
	const url = `${base}/${options.chain}/exchangerate`

	return {
		name: 'whatsonchain',
		async getBsvUsd(): Promise<BsvUsdQuote> {
			const res = await fetch(url)
			if (!res.ok) {
				throw new Error(
					`whatsonchain: ${res.status} ${await res.text().catch(() => '')}`,
				)
			}
			const body = (await res.json()) as { rate?: number; time?: number }
			if (typeof body.rate !== 'number' || !(body.rate > 0)) {
				throw new Error('whatsonchain: missing or invalid "rate" in response')
			}
			return {
				bsvUsd: body.rate,
				timestamp: typeof body.time === 'number' ? body.time * 1000 : Date.now(),
				source: 'whatsonchain',
			}
		},
	}
}
```

- [ ] **Step 4: Verify tests pass + commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test && bun run lint
git add packages/cli/src/repricer/whatsOnChain.ts packages/cli/test/repricer.whatsOnChain.test.ts
git commit -m "feat(cli): add WhatsOnChain rate provider"
```

---

## Task 6: Provider registry

**Files:**
- Create: `packages/cli/src/repricer/providers.ts`

- [ ] **Step 1: Write the registry**

```ts
import type { RateProvider } from './types'
import { createWhatsOnChainProvider } from './whatsOnChain'

export interface ResolveProviderOptions {
	chain: 'main' | 'test'
}

export function resolveRateProvider(
	name: string,
	options: ResolveProviderOptions,
): RateProvider {
	switch (name) {
		case 'whatsonchain':
			return createWhatsOnChainProvider({ chain: options.chain })
		default:
			throw new Error(`Unknown rate provider "${name}". Supported: whatsonchain.`)
	}
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' build
git add packages/cli/src/repricer/providers.ts
git commit -m "feat(cli): add rate provider registry"
```

---

## Task 7: TTL-cached config loader

This is what the wallet servers will use to satisfy the `getConfig` contract. Each `serve wallet` process re-reads `~/.1sat/cli/config.json` from disk no more often than every 60 seconds. On read failure, returns the last good value.

**Files:**
- Create: `packages/cli/src/repricer/configLoader.ts`
- Create: `packages/cli/test/repricer.configLoader.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/repricer.configLoader.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createAccountsConfigLoader } from '../src/repricer/configLoader'
import type { AccountsConfig } from '@bsv/wallet-server' // adjust to actual import path

function fakeBase(): AccountsConfig {
	return {
		enabled: true,
		baselineBytes: 1_073_741_824,
		purchaseUnitBytes: 1_073_741_824,
		satsPerUnit: 1_000_000,
		durationBlocks: 4383,
		freeIdentityKeys: [],
	}
}

describe('createAccountsConfigLoader', () => {
	test('reads fresh on first call', () => {
		let reads = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => 1000,
		})
		const cfg = loader()
		expect(cfg.satsPerUnit).toBe(1_000_000)
		expect(reads).toBe(1)
	})

	test('returns cached within TTL', () => {
		let reads = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => 1000,
		})
		loader()
		loader()
		loader()
		expect(reads).toBe(1)
	})

	test('refreshes after TTL', () => {
		let reads = 0
		let t = 1000
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => t,
		})
		loader()
		t = 60_999
		loader()
		expect(reads).toBe(1)
		t = 61_001
		loader()
		expect(reads).toBe(2)
	})

	test('serves last good value when read throws', () => {
		let calls = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 1,
			read: () => {
				calls++
				if (calls === 1) return fakeBase()
				throw new Error('disk gone')
			},
			now: () => calls * 100,
		})
		const first = loader()
		const second = loader()
		expect(second.satsPerUnit).toBe(first.satsPerUnit)
	})
})
```

- [ ] **Step 2: Verify they fail**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test
```

- [ ] **Step 3: Write the implementation**

`packages/cli/src/repricer/configLoader.ts`:

```ts
import type { AccountsConfig, AccountsConfigProvider } from '@bsv/wallet-server'
// If wallet-server doesn't re-export these from its package entrypoint, import
// from its accounts path: '@bsv/wallet-server/dist/accounts/types' or update its
// public exports. The first import that compiles wins; prefer the package entry.

export interface AccountsConfigLoaderOptions {
	ttlMs: number
	read: () => AccountsConfig
	/** Override clock (testing). */
	now?: () => number
}

/**
 * Build an `AccountsConfigProvider` that re-reads its source no more often
 * than `ttlMs`. If `read` throws after the first success, the last good
 * value is returned and the failure is silently absorbed (caller is the
 * billing middleware; we never want to fail a billing check because the
 * disk hiccupped).
 */
export function createAccountsConfigLoader(
	options: AccountsConfigLoaderOptions,
): AccountsConfigProvider {
	const now = options.now ?? (() => Date.now())
	let cached: AccountsConfig | undefined
	let cachedAt = 0

	return () => {
		const t = now()
		if (cached && t - cachedAt < options.ttlMs) return cached
		try {
			cached = options.read()
			cachedAt = t
			return cached
		} catch (err) {
			if (cached) return cached
			throw err
		}
	}
}
```

- [ ] **Step 4: Verify tests pass + commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test && bun run lint
git add packages/cli/src/repricer/configLoader.ts packages/cli/test/repricer.configLoader.test.ts
git commit -m "feat(cli): add TTL-cached AccountsConfig loader"
```

---

## Task 8: Build the price-update monitor task

The task fetches the rate, computes a new price, and persists. No in-memory pricing state — disk is the source of truth.

**Files:**
- Create: `packages/cli/src/repricer/buildPriceUpdateTask.ts`
- Create: `packages/cli/test/repricer.priceUpdateTask.test.ts`
- Create: `packages/cli/src/repricer/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/repricer.priceUpdateTask.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildPriceUpdateTask } from '../src/repricer/buildPriceUpdateTask'
import type { BsvUsdQuote, RateProvider } from '../src/repricer/types'

function fakeProvider(quotes: BsvUsdQuote[] | Error): RateProvider {
	let i = 0
	return {
		name: 'fake',
		async getBsvUsd() {
			if (quotes instanceof Error) throw quotes
			return quotes[Math.min(i++, quotes.length - 1)]
		},
	}
}

const Q = (bsvUsd: number): BsvUsdQuote => ({
	bsvUsd,
	timestamp: 0,
	source: 'fake',
})

describe('buildPriceUpdateTask', () => {
	test('trigger respects intervalMs', () => {
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 2_000_000,
			onPersist: async () => {},
		})
		task.lastRunMsecsSinceEpoch = 1000
		expect(task.trigger(1500)).toEqual({ run: false })
		expect(task.trigger(2000)).toEqual({ run: true })
	})

	test('runTask persists new value', async () => {
		let persisted: number | undefined
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_900_000,
			onPersist: async (sats) => {
				persisted = sats
			},
		})
		await task.runTask()
		expect(persisted).toBe(2_000_000)
	})

	test('runTask does not persist when compute skips', async () => {
		let persisted = false
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 10, minSats: 1 }, // 1M → 2M is +100%, skipped
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {
				persisted = true
			},
		})
		const msg = await task.runTask()
		expect(persisted).toBe(false)
		expect(msg).toMatch(/skip|maxMovePct/i)
	})

	test('rate fetch failure does not throw', async () => {
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider(new Error('boom')),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		const msg = await task.runTask()
		expect(msg).toMatch(/boom|failed/i)
	})

	test('trigger is no-op when targetUsd is 0', () => {
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 0,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		task.lastRunMsecsSinceEpoch = 0
		expect(task.trigger(Date.now())).toEqual({ run: false })
	})

	test('task name is "PriceUpdate"', () => {
		const task = buildPriceUpdateTask({
			monitor: {} as any,
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		expect(task.name).toBe('PriceUpdate')
	})
})
```

- [ ] **Step 2: Verify they fail**

- [ ] **Step 3: Write the implementation**

`packages/cli/src/repricer/buildPriceUpdateTask.ts`:

```ts
import { computeReprice } from './computeReprice'
import type { RateProvider, RepricerBounds } from './types'

export interface PriceUpdateTaskOptions {
	monitor: any
	rateProvider: RateProvider
	/** Interval between successful tick attempts. */
	intervalMs: number
	/** USD target per purchase unit. Task no-ops when this is 0. */
	targetUsd: number
	bounds: RepricerBounds
	/** Read current `satsPerUnit` (typically from disk via the same loader the servers use). */
	readCurrentSats: () => number
	/** Persist the new `satsPerUnit` value. Wraps `setConfigPath('server.accounts.satsPerUnit', sats)`. */
	onPersist: (newSats: number) => Promise<void>
}

export function buildPriceUpdateTask(options: PriceUpdateTaskOptions): any {
	const {
		monitor,
		rateProvider,
		intervalMs,
		targetUsd,
		bounds,
		readCurrentSats,
		onPersist,
	} = options

	return {
		monitor,
		storage: monitor.storage,
		name: 'PriceUpdate',
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(now: number): { run: boolean } {
			if (!(targetUsd > 0)) return { run: false }
			if (now - this.lastRunMsecsSinceEpoch < intervalMs) return { run: false }
			return { run: true }
		},
		async runTask(): Promise<string> {
			let quote
			try {
				quote = await rateProvider.getBsvUsd()
			} catch (err) {
				return `rate fetch failed: ${(err as Error).message}`
			}

			const currentSats = readCurrentSats()
			const result = computeReprice({
				targetUsd,
				bsvUsd: quote.bsvUsd,
				currentSats,
				bounds,
			})

			if (result.status === 'skipped') return `skipped: ${result.reason}`

			try {
				await onPersist(result.newSats)
			} catch (err) {
				return `persist failed: ${(err as Error).message}`
			}
			return `${currentSats} → ${result.newSats} sats/unit @ $${quote.bsvUsd}/BSV`
		},
	}
}
```

- [ ] **Step 4: Create public index**

`packages/cli/src/repricer/index.ts`:

```ts
export { buildPriceUpdateTask } from './buildPriceUpdateTask'
export type { PriceUpdateTaskOptions } from './buildPriceUpdateTask'
export { computeReprice } from './computeReprice'
export { createAccountsConfigLoader } from './configLoader'
export type { AccountsConfigLoaderOptions } from './configLoader'
export { resolveRateProvider } from './providers'
export { createWhatsOnChainProvider } from './whatsOnChain'
export type {
	BsvUsdQuote,
	ComputeRepriceInput,
	ComputeRepriceResult,
	RateProvider,
	RepricerBounds,
} from './types'
```

- [ ] **Step 5: Verify tests pass + commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' test && bun run lint
git add packages/cli/src/repricer/buildPriceUpdateTask.ts packages/cli/src/repricer/index.ts packages/cli/test/repricer.priceUpdateTask.test.ts
git commit -m "feat(cli): add PriceUpdate monitor task"
```

---

## Task 9: Wire `getConfig` loader into every `serve` mode

Every `serve` mode that builds accounts (wallet, all) needs to supply a `getConfig` loader instead of a static object. The disk-read source is `loadConfig()` from the CLI's existing config module.

**Files:**
- Modify: `packages/cli/src/commands/serve.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/cli/src/commands/serve.ts`:

```ts
import { loadConfig, setConfigPath } from '../config'
import {
	buildPriceUpdateTask,
	createAccountsConfigLoader,
	resolveRateProvider,
} from '../repricer'
```

(Merge into the existing `'../config'` import line.)

- [ ] **Step 2: Replace static accounts object with loader in `buildAccountsForServer`**

In `buildAccountsForServer` (around line 313), replace the returned `walletServerAccounts` to use `getConfig`:

```ts
async function buildAccountsForServer(
	resolved: ResolvedServe,
	walletResult: NodeWalletResult,
): Promise<AccountsRuntime | undefined> {
	if (resolved.activeRemote) return undefined

	const getConfig = createAccountsConfigLoader({
		ttlMs: 60_000,
		read: () => {
			const fresh = loadConfig()
			const a = fresh.server?.accounts
			return {
				enabled: a?.enabled ?? false,
				baselineBytes: a?.baselineBytes ?? DEFAULT_BASELINE_BYTES,
				purchaseUnitBytes: a?.purchaseUnitBytes ?? DEFAULT_PURCHASE_UNIT_BYTES,
				satsPerUnit: a?.satsPerUnit ?? DEFAULT_SATS_PER_UNIT,
				durationBlocks: a?.durationBlocks ?? DEFAULT_DURATION_BLOCKS,
				freeIdentityKeys: a?.freeIdentityKeys ?? [],
			}
		},
	})

	return {
		walletServerAccounts: {
			getConfig,
			currentBlock: () => walletResult.services.chaintracks.currentHeight(),
		},
	}
}
```

- [ ] **Step 3: Register the repricer task in monitor modes**

In `runWithStorage`, find the block that fires `walletResult.monitor.startTasks()`. Before that line, add:

```ts
if (mode !== 'wallet') {
	const accountsCfg = resolved.accounts
	const r = accountsCfg.repricer
	if (
		accountsCfg.enabled &&
		r?.enabled &&
		typeof r.targetUsd === 'number' &&
		r.targetUsd > 0
	) {
		walletResult.monitor.addTask(
			buildPriceUpdateTask({
				monitor: walletResult.monitor,
				rateProvider: resolveRateProvider(r.provider ?? 'whatsonchain', {
					chain: resolved.chain,
				}),
				intervalMs: r.intervalMs ?? 15 * 60 * 1000,
				targetUsd: r.targetUsd,
				bounds: {
					maxMovePct: r.maxMovePct ?? 25,
					minSats: r.minSats ?? 1,
				},
				readCurrentSats: () =>
					loadConfig().server?.accounts?.satsPerUnit ?? DEFAULT_SATS_PER_UNIT,
				onPersist: async (sats) => {
					setConfigPath('server.accounts.satsPerUnit', sats)
				},
			}),
		)
		console.log(
			`[repricer] enabled — $${r.targetUsd}/unit every ${Math.round(
				(r.intervalMs ?? 900_000) / 1000,
			)}s via ${r.provider ?? 'whatsonchain'}`,
		)
	}
}
```

This registers only when (a) the running mode includes the monitor, AND (b) accounts are enabled, AND (c) the operator opted into the repricer. The wallet-only mode skips it because no monitor exists.

- [ ] **Step 4: Update `ResolvedAccounts` typing**

Find the `ResolvedAccounts` interface in the same file and add the optional `repricer` field if not already there:

```ts
repricer?: {
	enabled?: boolean
	targetUsd?: number
	intervalMs?: number
	provider?: string
	maxMovePct?: number
	minSats?: number
}
```

Update `resolveAccounts` to pass `repricer: accounts?.repricer` straight through (no defaults — the defaults are applied at task-construction time above).

- [ ] **Step 5: Build, test, lint**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/cli' build && bun run --filter '@1sat/cli' test && bun run lint
```

- [ ] **Step 6: Commit**

```bash
cd /Users/davidcase/Source/1sat/1sat-sdk
git add packages/cli/src/commands/serve.ts
git commit -m "feat(cli): wire getConfig loader and price update task into serve"
```

---

## Task 10: Manual smoke test

Read-only verification against a scratch deployment. Do not point at production.

- [ ] **Step 1: Prepare a test box / VM / docker container with its own `~/.1sat/cli/`. Run:**

```bash
1sat config set server.accounts.enabled true
1sat config set server.accounts.satsPerUnit 2000000
1sat config set server.accounts.repricer.enabled true
1sat config set server.accounts.repricer.targetUsd 1.00
1sat config set server.accounts.repricer.intervalMs 60000
1sat config set server.accounts.repricer.maxMovePct 1000
```

- [ ] **Step 2: Start a monitor and a wallet process in separate terminals**

```bash
1sat serve monitor    # terminal 1
1sat serve wallet     # terminal 2
```

Confirm terminal 1 logs `[repricer] enabled — ...`.

- [ ] **Step 3: Wait ~1 minute. Confirm:**

- Monitor logs a `PriceUpdate` task line: `<old> → <new> sats/unit @ $X/BSV`.
- `cat ~/.1sat/cli/config.json | jq .server.accounts.satsPerUnit` shows the new value.

- [ ] **Step 4: Within ~60s of the disk write, confirm the wallet process serves the new price.**

```bash
curl -s http://localhost:8100/account/status | jq .pricing.satsPerUnit   # or use AuthFetch
```

(May require an authenticated client; alternatively inspect server logs or wire a temporary debug log into the wallet process.)

- [ ] **Step 5: Simulate provider failure — block `api.whatsonchain.com` at DNS or firewall level. Restart monitor.**

Expected: task logs `rate fetch failed: ...` periodically. `satsPerUnit` on disk and on the wire stays unchanged.

- [ ] **Step 6: Clean up.**

(No commit.)

---

## Task 11: Final validation

- [ ] `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run build` — clean across all packages
- [ ] `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run lint` — clean
- [ ] `cd /Users/davidcase/Source/1sat/1sat-sdk && bun test` — all packages pass

---

## Out of Scope

- Multi-currency
- Aggregate / multi-source rate
- Rate smoothing or moving averages
- Push notifications between processes (file + TTL is enough)
- Graceful shutdown (decoupled from this work)
- Web UI for setting target
- Per-user / per-identity pricing tiers
- Telemetry beyond Monitor's existing task logs

## Risks

1. **Provider outage.** Price stays at last good value. No alerting in v1.
2. **Up to 60s of stale pricing per wallet process** between a successful rewrite and the next disk read. Acceptable given a 15-min repricing cadence.
3. **Concurrent config writes.** An operator running `1sat config set server.accounts.satsPerUnit X` while the repricer is active will be overwritten on the next tick. Document; no mitigation.
4. **Wallet-server API change.** `accounts.config` → `accounts.getConfig` is a breaking change to `@bsv/wallet-server`'s public surface. Coordinate with anyone else calling `createWalletServer` directly.
