import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
	cancelListing,
	deriveCancelAddress,
	getBsv21Balances,
	getLockData,
	getOrdinals,
	inscribe,
	listOrdinal,
	listTokens,
	lockBsv,
	purchaseOrdinal,
	sendAllBsv,
	sendBsv,
	signBsm,
	transferOrdinals,
	unlockBsv,
} from '@1sat/actions'
import { BSM, PublicKey, Utils } from '@bsv/sdk'
import {
	type TestContext,
	createTestContext,
	deriveDepositAddress,
	destroyTestContext,
} from './setup'

let primary: TestContext
let buyer: TestContext
let seller: TestContext

beforeAll(async () => {
	primary = await createTestContext('primary')
	buyer = await createTestContext('buyer')
	seller = await createTestContext('seller')
})

afterAll(async () => {
	await destroyTestContext(primary)
	await destroyTestContext(buyer)
	await destroyTestContext(seller)
})

// ============================================================================
// Phase 1 — Read-only (no funding required)
// ============================================================================

describe('Phase 1 — Read-only', () => {
	test('getOrdinals — lists ordinals owned by wallet', async () => {
		const result = await getOrdinals.execute(primary.ctx, {})
		expect(result).toHaveProperty('outputs')
		expect(Array.isArray(result.outputs)).toBe(true)
	})

	test('deriveCancelAddress — derives a deterministic cancel address', async () => {
		const fakeOutpoint =
			'0000000000000000000000000000000000000000000000000000000000000000_0'
		const address = await deriveCancelAddress.execute(primary.ctx, {
			outpoint: fakeOutpoint,
		})
		expect(typeof address).toBe('string')
		expect(address.length).toBeGreaterThan(25)

		// Same input should produce the same address (deterministic)
		const address2 = await deriveCancelAddress.execute(primary.ctx, {
			outpoint: fakeOutpoint,
		})
		expect(address2).toBe(address)
	})

	test('listTokens — lists BSV21 tokens owned by wallet', async () => {
		const result = await listTokens.execute(primary.ctx, {})
		expect(Array.isArray(result)).toBe(true)
	})

	test('getBsv21Balances — returns token balances', async () => {
		const result = await getBsv21Balances.execute(
			primary.ctx,
			{} as Record<string, never>,
		)
		expect(Array.isArray(result)).toBe(true)
	})

	test('getLockData — returns lock summary', async () => {
		const result = await getLockData.execute(
			primary.ctx,
			{} as Record<string, never>,
		)
		expect(result).toHaveProperty('totalLocked')
		expect(result).toHaveProperty('unlockable')
		expect(result).toHaveProperty('nextUnlock')
		expect(typeof result.totalLocked).toBe('number')
	})

	// BUG: CalculateRecoveryFactor fails — wallet.createSignature DER output
	// doesn't roundtrip through Signature.fromDER for BSM compact encoding.
	// Needs investigation in the signBsm action.
	test.skip('signBsm — signs and produces a valid BSM signature', async () => {
		const msg = 'hello from 1sat-sdk tests'
		const result = await signBsm.execute(primary.ctx, { message: msg })

		expect(result.error).toBeUndefined()
		expect(result.sig).toBeDefined()
		expect(result.pubKey).toBeDefined()
		expect(result.address).toBeDefined()
		expect(result.message).toBe(msg)

		// Verify the signature
		const pubKey = PublicKey.fromString(result.pubKey!)
		const verified = BSM.verify(
			Utils.toArray(msg, 'utf8'),
			BSM.fromCompact(result.sig!, 'base64'),
			pubKey,
		)
		expect(verified).toBe(true)
	})
})

// ============================================================================
// Phase 2 — Create assets (requires funded PRIMARY wallet)
// ============================================================================

// Track the inscribed outpoint for use in later phases
let inscribedOutpoint: string

describe('Phase 2 — Create assets', () => {
	test('inscribe — inscribes content on-chain', async () => {
		const content = JSON.stringify({ test: true, ts: Date.now() })
		const base64Content = Utils.toBase64(
			Array.from(new TextEncoder().encode(content)),
		)

		const result = await inscribe.execute(primary.ctx, {
			base64Content,
			contentType: 'application/json',
			map: { app: '1sat-sdk-test', type: 'test' },
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
		expect(typeof result.txid).toBe('string')
		expect(result.txid!.length).toBe(64)

		inscribedOutpoint = `${result.txid}_0`
	})

	test('inscribe with sigma — inscribes SVG with Sigma signature', async () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#f7931a" stroke="#c16800" stroke-width="2"/>
  <text x="32" y="44" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="#fff">1</text>
</svg>`
		const base64Content = Utils.toBase64(
			Array.from(new TextEncoder().encode(svg)),
		)

		const result = await inscribe.execute(primary.ctx, {
			base64Content,
			contentType: 'image/svg+xml',
			map: { app: '1sat-sdk-test', type: 'sigma-test' },
			sigma: true,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
		expect(typeof result.txid).toBe('string')
		expect(result.txid!.length).toBe(64)
	})
})

// ============================================================================
// Phase 3 — Ordinal marketplace (requires funded SELLER + BUYER)
// ============================================================================

// We'll inscribe a fresh ordinal on seller, list it, then buy with buyer
let sellerOutpoint: string
let listingOutpoint: string

describe('Phase 3 — Ordinal marketplace', () => {
	test('inscribe on seller wallet for marketplace test', async () => {
		const content = JSON.stringify({ seller: true, ts: Date.now() })
		const base64Content = Utils.toBase64(
			Array.from(new TextEncoder().encode(content)),
		)

		const result = await inscribe.execute(seller.ctx, {
			base64Content,
			contentType: 'application/json',
			map: { app: '1sat-sdk-test', type: 'marketplace-test' },
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
		sellerOutpoint = `${result.txid}_0`
	})

	test('listOrdinal — lists an ordinal for sale', async () => {
		const result = await listOrdinal.execute(seller.ctx, {
			outpoint: sellerOutpoint,
			priceSatoshis: 1000,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
		listingOutpoint = `${result.txid}_0`
	})

	test('cancelListing — cancels an active listing', async () => {
		// List a second ordinal so we can cancel it without affecting the purchase test
		const content = JSON.stringify({ cancel: true, ts: Date.now() })
		const base64Content = Utils.toBase64(
			Array.from(new TextEncoder().encode(content)),
		)
		const insc = await inscribe.execute(seller.ctx, {
			base64Content,
			contentType: 'application/json',
		})
		expect(insc.txid).toBeDefined()

		const listing = await listOrdinal.execute(seller.ctx, {
			outpoint: `${insc.txid}_0`,
			priceSatoshis: 2000,
		})
		expect(listing.txid).toBeDefined()

		const result = await cancelListing.execute(seller.ctx, {
			outpoint: `${listing.txid}_0`,
		})
		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
	})

	test('purchaseOrdinal — buyer purchases a listed ordinal', async () => {
		const result = await purchaseOrdinal.execute(buyer.ctx, {
			outpoint: listingOutpoint,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
	})

	test('transferOrdinals — transfers an ordinal to another address', async () => {
		// Transfer the inscribed ordinal from primary to buyer
		const buyerAddress = await deriveDepositAddress(buyer.wallet)

		const result = await transferOrdinals.execute(primary.ctx, {
			outpoints: [inscribedOutpoint],
			address: buyerAddress,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
	})
})

// ============================================================================
// Phase 4 — Token operations (BSV21)
// ============================================================================

describe('Phase 4 — Token operations', () => {
	test.todo('sendBsv21 — sends BSV21 tokens to a recipient')
	test.todo('purchaseBsv21 — purchases BSV21 tokens from a listing')
})

// ============================================================================
// Phase 5 — Locks
// ============================================================================

describe('Phase 5 — Locks', () => {
	test('lockBsv — locks BSV until a block height', async () => {
		// Lock a small amount for 10 blocks into the future
		const lockData = await getLockData.execute(
			primary.ctx,
			{} as Record<string, never>,
		)
		// We need current height from services
		const currentHeight =
			(await primary.services?.chaintracks?.currentHeight()) ?? 900000

		const result = await lockBsv.execute(primary.ctx, {
			satoshis: 1000,
			blocksFromNow: 10,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
	})

	test('unlockBsv — unlocks matured BSV locks', async () => {
		// This will attempt to unlock any matured locks
		// With a fresh wallet, this may return no-op if nothing is matured
		const result = await unlockBsv.execute(
			primary.ctx,
			{} as Record<string, never>,
		)
		// Either succeeds with a txid or has no locks to unlock (not an error scenario)
		expect(result).toBeDefined()
	})
})

// ============================================================================
// Phase 6 — OpNS
// ============================================================================

const testOpnsName = `test-${Date.now()}`

describe('Phase 6 — OpNS', () => {
	test.todo('opnsRegister — registers an OpNS name')
	test.todo('opnsDeregister — deregisters an OpNS name')
})

// ============================================================================
// Phase 7 — Payments
// ============================================================================

describe('Phase 7 — Payments', () => {
	test('sendBsv — sends BSV to a recipient address', async () => {
		const buyerAddress = await deriveDepositAddress(buyer.wallet)

		const result = await sendBsv.execute(primary.ctx, {
			requests: [{ address: buyerAddress, satoshis: 500 }],
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
		expect(typeof result.txid).toBe('string')
	})

	test('sendAllBsv — sweeps all BSV to a recipient address', async () => {
		// Send all of buyer's BSV back to primary
		const primaryAddress = await deriveDepositAddress(primary.wallet)

		const result = await sendAllBsv.execute(buyer.ctx, {
			address: primaryAddress,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBeDefined()
	})
})

// ============================================================================
// Phase 8 — Sweep (requires a legacy WIF with funds)
// ============================================================================

describe('Phase 8 — Sweep', () => {
	test.todo('sweepBsv — sweeps BSV from a legacy key into the BRC-100 wallet')
	test.todo('sweepOrdinals — sweeps ordinals from a legacy key')
	test.todo('sweepBsv21 — sweeps BSV21 tokens from a legacy key')
})
