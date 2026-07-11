/**
 * Unit tests for prepareCosignBsv21Transfer + finalizeCosignBsv21Transfer.
 *
 * These exercise the two-phase cosigner-action protocol with a mock wallet
 * that simulates createAction(signAndProcess: false) → signableTransaction
 * and signAction(reference, spends) → final tx + BEEF, plus a mock
 * OneSatServices that simulates overlay submission.
 *
 * Round-trip verification of the full cosign script unlock against the @bsv/sdk
 * Spend interpreter is covered in @1sat/templates' cosign.test.ts; here we
 * focus on the action orchestration: session store, sighash plumbing,
 * recipient payload construction, and burn-output handling.
 */

import { describe, expect, test } from 'bun:test'
import { BSV21, Cosign } from '@1sat/templates'
import {
	Beef,
	type CreateActionArgs,
	type CreateActionResult,
	LockingScript,
	PrivateKey,
	PublicKey,
	Script,
	type SignActionArgs,
	type SignActionResult,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	finalizeCosignBsv21Transfer,
	InMemoryCosignSessionStore,
	prepareCosignBsv21Transfer,
} from '../src/cosign'

const TOKEN_ID = `${'a'.repeat(64)}_0`

// ============================================================================
// Mock wallet
// ============================================================================

interface MockWalletState {
	identityKey: PrivateKey
	pendingActions: Map<
		string,
		{ tx: Transaction; outputs: number[][]; inputs: number[][] }
	>
}

function makeMockWallet(identityKey: PrivateKey): WalletInterface {
	const state: MockWalletState = {
		identityKey,
		pendingActions: new Map(),
	}
	const cosignerPubHex = Utils.toHex(
		identityKey.toPublicKey().encode(true) as number[],
	)

	const wallet: Partial<WalletInterface> = {
		getPublicKey: async (args: {
			identityKey?: boolean
			protocolID?: [number, string]
			keyID?: string
			counterparty?: string | 'self' | 'anyone'
			forSelf?: boolean
		}) => {
			if (args.identityKey) {
				return { publicKey: cosignerPubHex }
			}
			// BRC-29 derivation: derive a sub-pubkey deterministically from
			// (counterparty, keyID) to give each session/recipient a distinct
			// destination address.
			const seed = `${args.counterparty}|${args.keyID}|${args.forSelf}`
			const seedBytes = Utils.toArray(seed, 'utf8')
			const expanded = [
				...seedBytes,
				...new Array(Math.max(0, 32 - seedBytes.length)).fill(0),
			].slice(0, 32)
			const derivedPriv = PrivateKey.fromString(Utils.toHex(expanded), 16)
			return {
				publicKey: Utils.toHex(
					derivedPriv.toPublicKey().encode(true) as number[],
				),
			}
		},

		createSignature: async (args: {
			hashToDirectlySign?: number[]
		}): Promise<{ signature: number[] }> => {
			const hash = args.hashToDirectlySign as number[]
			const sig = identityKey.sign(hash)
			return { signature: Array.from(sig.toDER()) }
		},

		createAction: async (
			args: CreateActionArgs,
		): Promise<CreateActionResult> => {
			// Simulate building a tx from the supplied externals + outputs.
			// Add one synthetic funding input + one synthetic change output
			// so the test exercises the "wallet adds stuff" path.
			const tx = new Transaction()

			// Add the externally-provided token inputs.
			for (const inp of args.inputs ?? []) {
				const [srcTxid, voutStr] = (inp.outpoint as string).split('.')
				const vout = Number.parseInt(voutStr, 10)
				tx.addInput({
					sourceTXID: srcTxid,
					sourceOutputIndex: vout,
					unlockingScript: new UnlockingScript(),
					sequence: 0xffffffff,
				})
			}

			// Add a fake funding input owned by the mock wallet.
			tx.addInput({
				sourceTXID: '0'.repeat(64),
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})

			// Add the user-defined outputs.
			for (const out of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(out.lockingScript),
					satoshis: out.satoshis,
				})
			}

			// Add a fake wallet-change output so SIGHASH_ALL covers more than
			// just the user-defined outputs.
			const changePub = identityKey.toPublicKey()
			tx.addOutput({
				lockingScript: new LockingScript(), // simplified — not a real P2PKH
				satoshis: 100,
			})

			// Wire source transactions into inputs from the supplied inputBEEF
			// so sighash computation can find them.
			if (args.inputBEEF) {
				const beef = Beef.fromBinary(Array.from(args.inputBEEF))
				for (const inp of tx.inputs) {
					if (!inp.sourceTransaction && inp.sourceTXID) {
						const btx = beef.findTxid(inp.sourceTXID)
						if (btx?.tx) inp.sourceTransaction = btx.tx
					}
				}
			}

			const reference = `ref-${Math.random().toString(36).slice(2)}`

			// Build a signable BEEF — atomic-style pointing at this unsigned tx.
			const beefObj = new Beef()
			// Merge any source txs we have.
			for (const inp of tx.inputs) {
				if (inp.sourceTransaction) beefObj.mergeTransaction(inp.sourceTransaction)
			}
			beefObj.mergeTransaction(tx)
			const txid = tx.id('hex')
			const beefBinary = beefObj.toBinaryAtomic(txid)

			state.pendingActions.set(reference, {
				tx,
				outputs: [],
				inputs: [],
			})

			return {
				signableTransaction: { reference, tx: beefBinary },
			}
		},

		signAction: async (args: SignActionArgs): Promise<SignActionResult> => {
			const pending = state.pendingActions.get(args.reference)
			if (!pending) throw new Error(`unknown reference ${args.reference}`)

			// Apply unlocking scripts from spends.
			for (const [idxStr, spend] of Object.entries(args.spends ?? {})) {
				const idx = Number(idxStr)
				pending.tx.inputs[idx].unlockingScript = Script.fromHex(
					spend.unlockingScript ?? '',
				) as UnlockingScript
			}

			// Pretend funding inputs are signed too (mock just leaves them empty).
			const txid = pending.tx.id('hex')
			const beef = new Beef()
			for (const inp of pending.tx.inputs) {
				if (inp.sourceTransaction) beef.mergeTransaction(inp.sourceTransaction)
			}
			beef.mergeTransaction(pending.tx)

			state.pendingActions.delete(args.reference)

			return {
				txid,
				tx: beef.toBinaryAtomic(txid),
			}
		},
	}

	return wallet as WalletInterface
}

// ============================================================================
// Mock services
// ============================================================================

function makeMockServices(overlayStatus = 'ADMITTED') {
	return {
		overlay: {
			submitBsv21: async () => ({ status: overlayStatus }),
		},
	} as unknown as import('@1sat/client').OneSatServices
}

// ============================================================================
// Synthetic source-tx helper
// ============================================================================

function buildSourceTxWithCosignBsv21(
	tokenId: string,
	amount: bigint,
	ownerAddress: string,
	cosignerPubHex: string,
): Transaction {
	const inscription = BSV21.transfer(tokenId, amount)
	const cosignSuffix = Cosign.lock(ownerAddress, cosignerPubHex)
	const lockingScript = inscription.lock(cosignSuffix)
	const tx = new Transaction()
	tx.addInput({
		sourceTXID: '0'.repeat(64),
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	tx.addOutput({ lockingScript, satoshis: 1 })
	return tx
}

// ============================================================================
// Tests
// ============================================================================

describe('prepareCosignBsv21Transfer', () => {
	test('rejects when no destinations or burns supplied', async () => {
		const wallet = makeMockWallet(PrivateKey.fromRandom())
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()
		await expect(
			prepareCosignBsv21Transfer({
				wallet,
				services,
				tokenId: TOKEN_ID,
				tokenInputs: [{ outpoint: `${'a'.repeat(64)}.0` }],
				inputBEEF: [],
				destinations: [],
				senderIdentityKey: 'aa',
				sessionStore,
			}),
		).rejects.toThrow('at least one destination, multisigDestination, or burn')
	})

	test('rejects when no token inputs', async () => {
		const wallet = makeMockWallet(PrivateKey.fromRandom())
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()
		await expect(
			prepareCosignBsv21Transfer({
				wallet,
				services,
				tokenId: TOKEN_ID,
				tokenInputs: [],
				inputBEEF: [],
				destinations: [{ recipientIdentityKey: 'rr', amount: '1' }],
				senderIdentityKey: 'aa',
				sessionStore,
			}),
		).rejects.toThrow('tokenInput required')
	})

	test('rejects when source UTXO is not cosign-wrapped', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		// Build a plain (non-cosign) source tx with a P2PKH output
		const plainTx = new Transaction()
		plainTx.addInput({
			sourceTXID: '0'.repeat(64),
			sourceOutputIndex: 0,
			unlockingScript: new UnlockingScript(),
			sequence: 0xffffffff,
		})
		plainTx.addOutput({ lockingScript: new LockingScript(), satoshis: 1 })
		const beef = new Beef()
		beef.mergeTransaction(plainTx)
		const inputBEEF = beef.toBinary()

		await expect(
			prepareCosignBsv21Transfer({
				wallet,
				services,
				tokenId: TOKEN_ID,
				tokenInputs: [{ outpoint: `${plainTx.id('hex')}.0` }],
				inputBEEF: Array.from(inputBEEF),
				destinations: [
					{ recipientIdentityKey: 'rr'.repeat(33), amount: '1' },
				],
				senderIdentityKey: 'aa',
				sessionStore,
			}),
		).rejects.toThrow('not cosign-wrapped')
	})

	test('rejects when source UTXO cosigner pubkey does not match the wallet', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const wrongCosignerKey = PrivateKey.fromRandom()
		const ownerKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey) // wallet is *this* cosigner
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		// Build a source tx whose cosign suffix names the WRONG cosigner.
		const wrongCosignerHex = Utils.toHex(
			wrongCosignerKey.toPublicKey().encode(true) as number[],
		)
		const sourceTx = buildSourceTxWithCosignBsv21(
			TOKEN_ID,
			100n,
			ownerKey.toPublicKey().toAddress(),
			wrongCosignerHex,
		)
		const beef = new Beef()
		beef.mergeTransaction(sourceTx)
		const inputBEEF = beef.toBinary()

		await expect(
			prepareCosignBsv21Transfer({
				wallet,
				services,
				tokenId: TOKEN_ID,
				tokenInputs: [{ outpoint: `${sourceTx.id('hex')}.0` }],
				inputBEEF: Array.from(inputBEEF),
				destinations: [
					{ recipientIdentityKey: 'rr'.repeat(33), amount: '50' },
				],
				senderIdentityKey: 'aa',
				sessionStore,
			}),
		).rejects.toThrow('does not match this cosigner')
	})

	test('happy path: returns sessionId, signable BEEF, and one sighash per cosign input', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const ownerKey = PrivateKey.fromRandom()
		const recipientKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		const cosignerPubHex = Utils.toHex(
			cosignerKey.toPublicKey().encode(true) as number[],
		)
		const sourceTx = buildSourceTxWithCosignBsv21(
			TOKEN_ID,
			100n,
			ownerKey.toPublicKey().toAddress(),
			cosignerPubHex,
		)
		const beef = new Beef()
		beef.mergeTransaction(sourceTx)
		const inputBEEF = beef.toBinary()

		const recipientPub = Utils.toHex(
			recipientKey.toPublicKey().encode(true) as number[],
		)
		const result = await prepareCosignBsv21Transfer({
			wallet,
			services,
			tokenId: TOKEN_ID,
			tokenInputs: [{ outpoint: `${sourceTx.id('hex')}.0` }],
			inputBEEF: Array.from(inputBEEF),
			destinations: [{ recipientIdentityKey: recipientPub, amount: '50' }],
			senderIdentityKey: Utils.toHex(
				ownerKey.toPublicKey().encode(true) as number[],
			),
			sessionStore,
		})

		expect(typeof result.sessionId).toBe('string')
		expect(result.sessionId.length).toBeGreaterThan(0)
		expect(Array.isArray(result.signableBeef)).toBe(true)
		expect(result.signableBeef.length).toBeGreaterThan(0)
		expect(result.sighashes.length).toBe(1)
		expect(result.sighashes[0].sighashHex.length).toBe(64) // 32-byte hex

		const session = await sessionStore.load(result.sessionId)
		expect(session).not.toBeNull()
		expect(session?.tokenId).toBe(TOKEN_ID)
		expect(session?.cosignerInputs.length).toBe(1)
		expect(session?.destinations.length).toBe(1)
		expect(session?.destinations[0].recipientIdentityKey).toBe(recipientPub)
	})

	test('burn output: produces an op=burn output and zero destinations', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const ownerKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		const cosignerPubHex = Utils.toHex(
			cosignerKey.toPublicKey().encode(true) as number[],
		)
		const sourceTx = buildSourceTxWithCosignBsv21(
			TOKEN_ID,
			100n,
			ownerKey.toPublicKey().toAddress(),
			cosignerPubHex,
		)
		const beef = new Beef()
		beef.mergeTransaction(sourceTx)
		const inputBEEF = beef.toBinary()

		const result = await prepareCosignBsv21Transfer({
			wallet,
			services,
			tokenId: TOKEN_ID,
			tokenInputs: [{ outpoint: `${sourceTx.id('hex')}.0` }],
			inputBEEF: Array.from(inputBEEF),
			destinations: [],
			burns: [{ amount: '100' }],
			senderIdentityKey: 'aa',
			sessionStore,
		})

		const session = await sessionStore.load(result.sessionId)
		expect(session).not.toBeNull()
		expect(session?.destinations.length).toBe(0)
		expect(session?.burns.length).toBe(1)
		expect(session?.burns[0].amount).toBe('100')
	})
})

describe('finalizeCosignBsv21Transfer', () => {
	test('round-trip: prepare → finalize returns txid + per-recipient payloads', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const ownerKey = PrivateKey.fromRandom()
		const recipientKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices('ADMITTED')
		const sessionStore = new InMemoryCosignSessionStore()

		const cosignerPubHex = Utils.toHex(
			cosignerKey.toPublicKey().encode(true) as number[],
		)
		const ownerPubHex = Utils.toHex(
			ownerKey.toPublicKey().encode(true) as number[],
		)
		const recipientPub = Utils.toHex(
			recipientKey.toPublicKey().encode(true) as number[],
		)
		const sourceTx = buildSourceTxWithCosignBsv21(
			TOKEN_ID,
			100n,
			ownerKey.toPublicKey().toAddress(),
			cosignerPubHex,
		)
		const beef = new Beef()
		beef.mergeTransaction(sourceTx)
		const inputBEEF = Array.from(beef.toBinary())

		const prepared = await prepareCosignBsv21Transfer({
			wallet,
			services,
			tokenId: TOKEN_ID,
			tokenInputs: [{ outpoint: `${sourceTx.id('hex')}.0` }],
			inputBEEF,
			destinations: [{ recipientIdentityKey: recipientPub, amount: '50' }],
			senderIdentityKey: ownerPubHex,
			sessionStore,
		})

		// Owner signs each sighash with the owner key (sighash is single-SHA256;
		// caller passes that directly as hashToDirectlySign).
		const ownerSigs = prepared.sighashes.map((sh) => {
			const sigDER = ownerKey.sign(Utils.toArray(sh.sighashHex, 'hex')).toDER()
			return {
				inputIndex: sh.inputIndex,
				sigHex: Utils.toHex(Array.from(sigDER)),
				ownerPubkeyHex: ownerPubHex,
			}
		})

		const finalized = await finalizeCosignBsv21Transfer({
			wallet,
			services,
			sessionId: prepared.sessionId,
			ownerSigs,
			sessionStore,
		})

		expect(typeof finalized.txid).toBe('string')
		expect(finalized.txid.length).toBe(64)
		expect(finalized.overlayStatus).toBe('ADMITTED')
		expect(finalized.recipients.length).toBe(1)
		expect(finalized.recipients[0].identityKey).toBe(recipientPub)
		expect(finalized.recipients[0].vout).toBe(0)

		const ci = JSON.parse(finalized.recipients[0].customInstructions)
		expect(ci.protocolID).toEqual([0, 'p 1sat'])
		expect(ci.keyID).toBe(prepared.sessionId)
		expect(ci.counterparty).toBe(cosignerPubHex)
		expect(ci.tokenId).toBe(TOKEN_ID)
		expect(ci.type).toBe('cosign-bsv21')

		// Session should be cleaned up after finalize.
		const stale = await sessionStore.load(prepared.sessionId)
		expect(stale).toBeNull()
	})

	test('rejects when missing owner sig for a cosign input', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const ownerKey = PrivateKey.fromRandom()
		const recipientKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		const cosignerPubHex = Utils.toHex(
			cosignerKey.toPublicKey().encode(true) as number[],
		)
		const ownerPubHex = Utils.toHex(
			ownerKey.toPublicKey().encode(true) as number[],
		)
		const recipientPub = Utils.toHex(
			recipientKey.toPublicKey().encode(true) as number[],
		)
		const sourceTx = buildSourceTxWithCosignBsv21(
			TOKEN_ID,
			100n,
			ownerKey.toPublicKey().toAddress(),
			cosignerPubHex,
		)
		const beef = new Beef()
		beef.mergeTransaction(sourceTx)
		const inputBEEF = Array.from(beef.toBinary())

		const prepared = await prepareCosignBsv21Transfer({
			wallet,
			services,
			tokenId: TOKEN_ID,
			tokenInputs: [{ outpoint: `${sourceTx.id('hex')}.0` }],
			inputBEEF,
			destinations: [{ recipientIdentityKey: recipientPub, amount: '50' }],
			senderIdentityKey: ownerPubHex,
			sessionStore,
		})

		await expect(
			finalizeCosignBsv21Transfer({
				wallet,
				services,
				sessionId: prepared.sessionId,
				ownerSigs: [], // empty
				sessionStore,
			}),
		).rejects.toThrow('missing ownerSig')
	})

	test('rejects unknown sessionId', async () => {
		const cosignerKey = PrivateKey.fromRandom()
		const wallet = makeMockWallet(cosignerKey)
		const services = makeMockServices()
		const sessionStore = new InMemoryCosignSessionStore()

		await expect(
			finalizeCosignBsv21Transfer({
				wallet,
				services,
				sessionId: 'does-not-exist',
				ownerSigs: [],
				sessionStore,
			}),
		).rejects.toThrow('unknown sessionId')
	})
})
