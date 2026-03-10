/**
 * Locks Module
 *
 * Actions for time-locking BSV.
 */

import {
	Beef,
	type CreateActionOutput,
	Hash,
	PublicKey,
	Script,
	Transaction,
	TransactionSignature,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import {
	LOCK_BASKET,
	LOCK_PREFIX,
	LOCK_SUFFIX,
	MIN_UNLOCK_SATS,
} from '../constants'
import type { Action, ActionLogEntry } from '../types'

// ============================================================================
// Constants
// ============================================================================

const LOCK_PROTOCOL: [0 | 1 | 2, string] = [1, 'locks']
const LOCK_KEY_ID = 'lock'

// ============================================================================
// Types
// ============================================================================

export interface LockBsvRequest {
	/** Amount in satoshis to lock */
	satoshis: number
	/** Block height until which to lock */
	until: number
}

export interface LockData {
	/** Total locked satoshis */
	totalLocked: number
	/** Unlockable satoshis (matured locks) */
	unlockable: number
	/** Next unlock block height */
	nextUnlock: number
}

export interface LockOperationResponse {
	txid?: string
	rawtx?: string
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildLockScript(address: string, until: number): Script {
	const pkh = Utils.fromBase58Check(address).data as number[]
	return new Script()
		.writeScript(Script.fromHex(LOCK_PREFIX))
		.writeBin(pkh)
		.writeNumber(until)
		.writeScript(Script.fromHex(LOCK_SUFFIX))
}

// ============================================================================
// Actions
// ============================================================================

/** Input for getLockData action (no required params) */
export type GetLockDataInput = Record<string, never>

/**
 * Get lock data summary.
 */
export const getLockData: Action<GetLockDataInput, LockData> = {
	meta: {
		name: 'getLockData',
		description:
			'Get summary of time-locked BSV (total, unlockable, next unlock height)',
		category: 'locks',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const lockData: LockData = { totalLocked: 0, unlockable: 0, nextUnlock: 0 }

		if (!ctx.services) return lockData
		const currentHeight = await ctx.services.chaintracks.currentHeight()

		const result = await ctx.wallet.listOutputs({
			basket: LOCK_BASKET,
			includeTags: true,
			limit: 10000,
		})
		const outputs = result.outputs

		for (const o of outputs) {
			const untilTag = o.tags?.find((t) => t.startsWith('until:'))
			if (!untilTag) continue

			const until = Number.parseInt(untilTag.slice(6), 10)
			lockData.totalLocked += o.satoshis

			if (until <= currentHeight) {
				lockData.unlockable += o.satoshis
			} else if (!lockData.nextUnlock || until < lockData.nextUnlock) {
				lockData.nextUnlock = until
			}
		}

		if (lockData.unlockable < MIN_UNLOCK_SATS * outputs.length) {
			lockData.unlockable = 0
		}

		return lockData
	},
}

/** Input for lockBsv action */
export interface LockBsvInput {
	requests: LockBsvRequest[]
}

/**
 * Lock BSV until a block height.
 */
export const lockBsv: Action<LockBsvInput, LockOperationResponse> = {
	meta: {
		name: 'lockBsv',
		description: 'Lock BSV until a specific block height',
		category: 'locks',
		inputSchema: {
			type: 'object',
			properties: {
				requests: {
					type: 'array',
					description: 'Array of lock requests',
					items: {
						type: 'object',
						properties: {
							satoshis: {
								type: 'integer',
								description: 'Amount in satoshis to lock',
							},
							until: {
								type: 'integer',
								description: 'Block height until which to lock',
							},
						},
						required: ['satoshis', 'until'],
					},
				},
			},
			required: ['requests'],
		},
	},
	async execute(ctx, input) {
		try {
			const { requests } = input
			if (!requests || requests.length === 0) {
				return { error: 'no-lock-requests' }
			}

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: LOCK_PROTOCOL,
				keyID: LOCK_KEY_ID,
				counterparty: 'self',
				forSelf: true,
			})
			const lockAddress = PublicKey.fromString(publicKey).toAddress()

			const outputs: CreateActionOutput[] = []
			for (const req of requests) {
				if (req.satoshis <= 0) return { error: 'invalid-satoshis' }
				if (req.until <= 0) return { error: 'invalid-block-height' }

				const lockingScript = buildLockScript(lockAddress, req.until)
				outputs.push({
					lockingScript: lockingScript.toHex(),
					satoshis: req.satoshis,
					outputDescription: `Lock ${req.satoshis} sats until block ${req.until}`,
					basket: LOCK_BASKET,
					tags: [`until:${req.until}`],
					customInstructions: JSON.stringify({
						protocolID: LOCK_PROTOCOL,
						keyID: LOCK_KEY_ID,
					}),
				})
			}

			const result = await ctx.wallet.createAction({
				description: `Lock BSV in ${requests.length} output(s)`,
				outputs,
				options: { signAndProcess: true, acceptDelayedBroadcast: false },
			})

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = requests.map((req, i) => ({
					index: i,
					protocolID: LOCK_PROTOCOL,
					keyID: LOCK_KEY_ID,
					basket: LOCK_BASKET,
					satoshis: req.satoshis,
				}))
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'lockBsv',
					input: { requests },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: logOutputs,
				})
			}

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
			}
		} catch (error) {
			console.error('[lockBsv]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'lockBsv',
					input: { requests: input.requests },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/** Input for unlockBsv action (no required params) */
export type UnlockBsvInput = Record<string, never>

/**
 * Unlock matured BSV locks.
 */
export const unlockBsv: Action<UnlockBsvInput, LockOperationResponse> = {
	meta: {
		name: 'unlockBsv',
		description: 'Unlock all matured time-locked BSV',
		category: 'locks',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		try {
			if (!ctx.services) return { error: 'services-required' }
			const currentHeight = await ctx.services.chaintracks.currentHeight()

			const result = await ctx.wallet.listOutputs({
				basket: LOCK_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 10000,
			})

			const maturedLocks: Array<{
				output: WalletOutput
				until: number
				protocolID: [0 | 1 | 2, string]
				keyID: string
			}> = []

			for (const o of result.outputs) {
				const untilTag = o.tags?.find((t) => t.startsWith('until:'))
				if (!untilTag) continue

				const until = Number.parseInt(untilTag.slice(6), 10)

				let protocolID = LOCK_PROTOCOL
				let keyID = LOCK_KEY_ID
				if (o.customInstructions) {
					const instructions = JSON.parse(o.customInstructions)
					protocolID = instructions.protocolID ?? LOCK_PROTOCOL
					keyID = instructions.keyID ?? LOCK_KEY_ID
				}

				if (until <= currentHeight) {
					maturedLocks.push({ output: o, until, protocolID, keyID })
				}
			}

			if (maturedLocks.length === 0) {
				return { error: 'no-matured-locks' }
			}

			const totalSats = maturedLocks.reduce(
				(sum, l) => sum + l.output.satoshis,
				0,
			)
			if (totalSats < MIN_UNLOCK_SATS * maturedLocks.length) {
				return { error: 'insufficient-unlock-amount' }
			}

			const maxUntil = Math.max(...maturedLocks.map((l) => l.until))

			let inputBEEF = result.BEEF
			if (!inputBEEF || (inputBEEF as number[]).length === 0) {
				if (!ctx.services) return { error: 'no-beef-available' }
				console.warn('[unlockBsv] BEEF not returned by listOutputs, falling back to service lookup')
				const txids = [
					...new Set(
						maturedLocks.map((l) => l.output.outpoint.split('.')[0]),
					),
				]
				const beef = await ctx.services.getBeefForTxid(txids[0])
				for (let i = 1; i < txids.length; i++) {
					beef.mergeBeef(await ctx.services.getBeefForTxid(txids[i]))
				}
				inputBEEF = beef.toBinary()
			}

			const createResult = await ctx.wallet.createAction({
				description: `Unlock ${maturedLocks.length} lock(s)`,
				inputBEEF,
				inputs: maturedLocks.map((l) => ({
					outpoint: l.output.outpoint,
					inputDescription: 'Locked BSV',
					unlockingScriptLength: 180,
					sequenceNumber: 0,
				})),
				outputs: [],
				lockTime: maxUntil,
				options: { signAndProcess: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

			const spends: Record<number, { unlockingScript: string }> = {}

			for (let i = 0; i < maturedLocks.length; i++) {
				const lock = maturedLocks[i]
				const input = tx.inputs[i]
				if (!input.sourceTXID || !input.sourceTransaction) {
					return { error: 'missing-lock-data' }
				}
				const lockingScript = input.sourceTransaction.outputs[input.sourceOutputIndex].lockingScript

				const preimage = TransactionSignature.format({
					sourceTXID: input.sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: lock.output.satoshis,
					transactionVersion: tx.version,
					otherInputs: tx.inputs.filter((_, idx) => idx !== i),
					outputs: tx.outputs,
					inputIndex: i,
					subscript: lockingScript,
					inputSequence: 0,
					lockTime: tx.lockTime,
					scope:
						TransactionSignature.SIGHASH_ALL |
						TransactionSignature.SIGHASH_ANYONECANPAY |
						TransactionSignature.SIGHASH_FORKID,
				})

				const sighash = Hash.sha256(Hash.sha256(preimage))

				const { signature } = await ctx.wallet.createSignature({
					protocolID: lock.protocolID,
					keyID: lock.keyID,
					counterparty: 'self',
					hashToDirectlySign: Array.from(sighash),
				})

				const { publicKey } = await ctx.wallet.getPublicKey({
					protocolID: lock.protocolID,
					keyID: lock.keyID,
					counterparty: 'self',
					forSelf: true,
				})

				const unlockingScript = new Script()
					.writeBin(signature)
					.writeBin(Utils.toArray(publicKey, 'hex'))
					.writeBin(Array.from(preimage))

				spends[i] = { unlockingScript: unlockingScript.toHex() }
			}

			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends,
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'unlockBsv',
					input: { lockCount: maturedLocks.length },
					txid: signResult.txid,
					rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
					outputs: maturedLocks.map((l, i) => ({
						index: i,
						protocolID: l.protocolID,
						keyID: l.keyID,
						customInstructions: l.output.customInstructions,
						basket: LOCK_BASKET,
						satoshis: l.output.satoshis,
					})),
				})
			}

			return {
				txid: signResult.txid,
				rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[unlockBsv]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'unlockBsv',
					input: {},
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All lock actions for registry */
export const locksActions = [getLockData, lockBsv, unlockBsv]
