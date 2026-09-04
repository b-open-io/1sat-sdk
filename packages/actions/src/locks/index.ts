/**
 * Locks Module
 *
 * Actions for time-locking BSV.
 */

import { Lock } from '@1sat/templates'
import {
	P1SAT_PROTOCOL,
	buildInputAssetLabel,
	readAssetIdTag,
} from '@1sat/types'
import {
	type CreateActionOutput,
	PublicKey,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply'
import { LOCK_BASKET } from '../constants'
import type { Action, ActionLogEntry, ActionOptions } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'

// ============================================================================
// Constants
// ============================================================================

/** Lock signing protocol — unified under 'p 1sat' so the permission module
 * sees signing requests for lock UTXOs and verifies against captured commits.
 */
const LOCK_PROTOCOL = P1SAT_PROTOCOL
const LOCK_KEY_ID = 'lock'

// ============================================================================
// Types
// ============================================================================

export interface LockBsvRequest extends ActionOptions {
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
	tx?: number[]
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/** Input for listLocks action */
export interface ListLocksInput {
	tags?: string[]
	tagQueryMode?: 'all' | 'any'
	ids?: string[]
	include?: 'locking scripts' | 'entire transactions'
	includeCustomInstructions?: boolean
	includeTags?: boolean
	includeLabels?: boolean
	limit?: number
	offset?: number
}

export interface ListLocksResult {
	outputs: WalletOutput[]
	BEEF?: import('@bsv/sdk').BEEF
	totalOutputs?: number
}

/**
 * List lock UTXOs (metadata by default).
 */
export const listLocks: Action<ListLocksInput, ListLocksResult> = {
	meta: {
		name: 'listLocks',
		description: 'List time-locked BSV UTXOs (metadata by default)',
		category: 'locks',
		inputSchema: {
			type: 'object',
			properties: {
				tags: { type: 'array', items: { type: 'string' } },
				tagQueryMode: { type: 'string', enum: ['all', 'any'] },
				ids: { type: 'array', items: { type: 'string' } },
				include: {
					type: 'string',
					enum: ['locking scripts', 'entire transactions'],
				},
				limit: { type: 'integer' },
				offset: { type: 'integer' },
			},
		},
	},
	async execute(ctx, input) {
		const tags = [...(input.tags ?? [])]
		for (const id of input.ids ?? []) {
			if (id) tags.push(id.startsWith('id:') ? id : `id:${id}`)
		}
		const filtering = tags.length > 0
		const result = await ctx.wallet.listOutputs({
			basket: LOCK_BASKET,
			...(filtering && {
				tags,
				tagQueryMode: input.tagQueryMode ?? 'any',
			}),
			...(input.include && { include: input.include }),
			includeTags: input.includeTags ?? true,
			includeCustomInstructions: input.includeCustomInstructions ?? true,
			...(input.includeLabels != null && {
				includeLabels: input.includeLabels,
			}),
			limit: input.limit ?? 100,
			offset: input.offset ?? 0,
		})
		return {
			outputs: result.outputs,
			BEEF: result.BEEF,
			totalOutputs: result.totalOutputs,
		}
	},
}

/** Input for getLockData action (no required params) */
export type GetLockDataInput = Record<string, never>

/**
 * Get lock data summary.
 * @deprecated Prefer listLocks for per-UTXO ids; kept for summary consumers.
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

		return lockData
	},
}

/** Input for lockBsv action */
export interface LockBsvInput extends ActionOptions {
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

				const lockingScript = Lock.lock(lockAddress, req.until)

				// Read the height back out of the script we just built, so the
				// tag can never drift from what the chain will actually enforce.
				const encoded = Lock.decode(lockingScript)
				if (!encoded) {
					return { error: 'lock-script-encode-failed' }
				}

				outputs.push({
					lockingScript: lockingScript.toHex(),
					satoshis: req.satoshis,
					outputDescription: `Lock ${req.satoshis} sats until block ${encoded.until}`,
					basket: LOCK_BASKET,
					tags: [`until:${encoded.until}`],
					customInstructions: JSON.stringify({
						protocolID: LOCK_PROTOCOL,
						keyID: LOCK_KEY_ID,
					}),
				})
			}

			const args = await prepareP1SatArgs(ctx, {
					description: `Lock BSV in ${requests.length} output(s)`,
					outputs,
					options: { acceptDelayedBroadcast: false },
				})
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				undefined,
				undefined,
				{
					spends: [],
					usePermissionModule: input.usePermissionModule ?? input.useOneSatModule ?? input.useModule,
					permissionScheme: 'lock',
				},
			)

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = requests.map(
					(req, i) => ({
						index: i,
						protocolID: LOCK_PROTOCOL,
						keyID: LOCK_KEY_ID,
						basket: LOCK_BASKET,
						satoshis: req.satoshis,
					}),
				)
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
				tx: result.tx,
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

/** Input for unlockBsv action */
export interface UnlockBsvInput extends ActionOptions {
	/**
	 * When set, only unlock these tracking ids (bare or id: prefix).
	 * When omitted, unlock all matured locks in the basket.
	 */
	ids?: string[]
}

/**
 * Unlock matured BSV locks.
 */
export const unlockBsv: Action<UnlockBsvInput, LockOperationResponse> = {
	meta: {
		name: 'unlockBsv',
		description:
			'Unlock matured time-locked BSV (all unlockable, or specific ids)',
		category: 'locks',
		inputSchema: {
			type: 'object',
			properties: {
				ids: {
					type: 'array',
					items: { type: 'string' },
					description: 'Optional lock ids; omit to unlock all matured',
				},
			},
		},
	},
	async execute(ctx, input = {}) {
		try {
			if (!ctx.services) return { error: 'services-required' }
			const currentHeight = await ctx.services.chaintracks.currentHeight()

			const idFilter =
				input.ids && input.ids.length > 0
					? new Set(
							input.ids.map((id) => (id.startsWith('id:') ? id.slice(3) : id)),
						)
					: null

			const listResult = await ctx.wallet.listOutputs({
				basket: LOCK_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 10000,
				...(idFilter && {
					tags: [...idFilter].map((id) => `id:${id}`),
					tagQueryMode: 'any' as const,
				}),
			})

			const maturedLocks: Array<{
				output: WalletOutput
				until: number
				protocolID: [0 | 1 | 2, string]
				keyID: string
			}> = []

			for (const o of listResult.outputs) {
				if (idFilter) {
					const rid = readAssetIdTag(o.tags)
					if (!rid || !idFilter.has(rid)) continue
				}
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

			const maxUntil = Math.max(...maturedLocks.map((l) => l.until))

			let inputBEEF = listResult.BEEF
			if (!inputBEEF || (inputBEEF as number[]).length === 0) {
				if (!ctx.services) return { error: 'no-beef-available' }
				console.warn(
					'[unlockBsv] BEEF not returned by listOutputs, falling back to service lookup',
				)
				const txids = [
					...new Set(maturedLocks.map((l) => l.output.outpoint.split('.')[0])),
				]
				const beef = await ctx.services.getBeefForTxid(txids[0])
				for (let i = 1; i < txids.length; i++) {
					beef.mergeBeef(await ctx.services.getBeefForTxid(txids[i]))
				}
				inputBEEF = beef.toBinary()
			}

			const inputLabels = maturedLocks
				.map((l) => readAssetIdTag(l.output.tags))
				.filter((id): id is string => Boolean(id))
				.map((id) => buildInputAssetLabel(LOCK_BASKET, id))
			const args = await prepareP1SatArgs(ctx, {
					description: `Unlock ${maturedLocks.length} lock(s)`,
					inputBEEF,
					...(inputLabels.length > 0 && { labels: inputLabels }),
					inputs: maturedLocks.map((l) => ({
						outpoint: l.output.outpoint,
						inputDescription: 'Locked BSV',
						unlockingScriptLength: 1205,
						sequenceNumber: 0,
					})),
					outputs: [],
					lockTime: maxUntil,
				})
			const spends = maturedLocks
				.map((l) => {
					const id = readAssetIdTag(l.output.tags)
					if (!id || !l.output.customInstructions) return null
					return {
						basket: LOCK_BASKET,
						id,
						outpoint: l.output.outpoint.replace('_', '.'),
						customInstructions: l.output.customInstructions,
					}
				})
				.filter((x): x is NonNullable<typeof x> => !!x)
			if (spends.length === 0) {
				return { error: 'locks-missing-id-or-ci' }
			}
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				undefined,
				inputBEEF as number[],
				undefined,
				{
					spends,
					usePermissionModule: input.usePermissionModule ?? input.useOneSatModule ?? input.useModule,
					permissionScheme: 'lock',
				},
			)

			if (ctx.debug && ctx.log && result.txid) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'unlockBsv',
					input: { lockCount: maturedLocks.length },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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

			return result
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
export const locksActions = [listLocks, getLockData, lockBsv, unlockBsv]
