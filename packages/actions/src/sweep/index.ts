/**
 * Sweep Module
 *
 * Functions for sweeping assets from external wallets into a BRC-100 wallet.
 */

import { BSV21, OrdLock } from '@1sat/templates'
import type { IndexedOutput } from '@1sat/types'
import type { OrdfsMetadata } from '@1sat/types'
import { formatOutpoint, parseOutpoint } from '@1sat/utils'
import {
	type CreateActionOutput,
	P2PKH,
	type PrivateKey,
	PublicKey,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { BSV21_BASKET, BSV21_PROTOCOL, ONESAT_PROTOCOL } from '../constants'
import { resolveOrdinalTags } from '../ordinals'
import type { Action, ActionLogEntry, OneSatContext } from '../types'
import {
	createTrackedAction,
	executeTrackedAction,
} from '../utils/createTrackedAction'
import type {
	SweepBsv21Request,
	SweepBsv21Response,
	SweepBsvRequest,
	SweepBsvResponse,
	SweepInput,
	SweepOrdinalsRequest,
	SweepOrdinalsResponse,
} from './types'

export * from './types'

/**
 * Prepare sweep inputs from IndexedOutput objects by fetching locking scripts.
 * This extracts locking scripts from the raw transactions in BEEF format.
 */
export async function prepareSweepInputs(
	ctx: OneSatContext,
	utxos: IndexedOutput[],
): Promise<SweepInput[]> {
	if (!ctx.services) {
		throw new Error('Services required for prepareSweepInputs')
	}

	// Group UTXOs by txid to minimize BEEF fetches
	const byTxid = new Map<string, { vout: number; utxo: IndexedOutput }[]>()
	for (const utxo of utxos) {
		const { txid, vout } = parseOutpoint(utxo.outpoint)
		const existing = byTxid.get(txid) ?? []
		existing.push({ vout, utxo })
		byTxid.set(txid, existing)
	}

	const results: SweepInput[] = []

	// Fetch BEEF for each txid and extract locking scripts
	for (const [txid, outputs] of byTxid) {
		const beef = await ctx.services.getBeefForTxid(txid)
		const beefTx = beef.findTxid(txid)

		if (!beefTx?.tx) {
			throw new Error(`Transaction ${txid} not found in BEEF`)
		}

		for (const { vout, utxo } of outputs) {
			const output = beefTx.tx.outputs[vout]
			if (!output) {
				throw new Error(`Output ${vout} not found in transaction ${txid}`)
			}

			results.push({
				outpoint: utxo.outpoint,
				satoshis: utxo.satoshis ?? output.satoshis ?? 0,
				lockingScript: output.lockingScript?.toHex() ?? '',
			})
		}
	}

	return results
}

/** Build a map of SDK-formatted outpoint → PrivateKey from parallel arrays */
function buildKeyMap(
	inputs: { outpoint: string }[],
	keys: PrivateKey[],
): Map<string, PrivateKey> {
	const map = new Map<string, PrivateKey>()
	for (let i = 0; i < inputs.length; i++) {
		const { txid, vout } = parseOutpoint(inputs[i].outpoint)
		map.set(formatOutpoint(txid, vout), keys[i])
	}
	return map
}

/** Build a map of SDK-formatted outpoint → source output info */
function buildSourceMap(
	inputs: { outpoint: string; satoshis: number; lockingScript: string }[],
): Map<string, { script: Script; satoshis: number }> {
	const map = new Map<string, { script: Script; satoshis: number }>()
	for (const input of inputs) {
		const { txid, vout } = parseOutpoint(input.outpoint)
		map.set(formatOutpoint(txid, vout), {
			script: Script.fromHex(input.lockingScript),
			satoshis: input.satoshis,
		})
	}
	return map
}

/**
 * Sweep BSV from external inputs into the destination wallet.
 *
 * If amount is specified, only that amount is swept and the remainder
 * is returned to the source address. If amount is omitted, all input
 * value is swept (minus fees).
 */
export const sweepBsv: Action<SweepBsvRequest, SweepBsvResponse> = {
	meta: {
		name: 'sweepBsv',
		description:
			'Sweep BSV from external wallet (via WIF) into the connected wallet',
		category: 'sweep',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				inputs: {
					type: 'array',
					description: 'UTXOs to sweep (use prepareSweepInputs to build these)',
					items: {
						type: 'object',
						properties: {
							outpoint: { type: 'string', description: 'Outpoint (txid_vout)' },
							satoshis: { type: 'integer', description: 'Satoshis in output' },
							lockingScript: {
								type: 'string',
								description: 'Locking script hex',
							},
						},
						required: ['outpoint', 'satoshis', 'lockingScript'],
					},
				},
				wif: {
					type: 'string',
					description: 'WIF private key controlling the inputs',
				},
				amount: {
					type: 'integer',
					description:
						'Amount to sweep (satoshis). If omitted, sweeps all input value.',
				},
			},
			required: ['inputs', 'wif'],
		},
	},

	async execute(ctx, request): Promise<SweepBsvResponse> {
		if (!ctx.services) {
			return { error: 'services-required' }
		}

		try {
			const { inputs, keys, amount } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

			const keyMap = buildKeyMap(inputs, keys)
			const sourceMap = buildSourceMap(inputs)
			const sourceAddress = keys[0].toPublicKey().toAddress()

			// Calculate totals
			const inputTotal = inputs.reduce((sum, i) => sum + i.satoshis, 0)

			// Validate amount if specified
			if (amount !== undefined) {
				if (amount <= 0) {
					return { error: 'invalid-amount' }
				}
				if (amount > inputTotal) {
					return { error: 'insufficient-funds' }
				}
			}

			// Fetch BEEF for all input transactions and merge them
			const txids = [
				...new Set(inputs.map((i) => parseOutpoint(i.outpoint).txid)),
			]

			console.log(`[sweep] Fetching BEEF for ${txids.length} transactions`)

			// Get first BEEF, then merge others into it
			const firstBeef = await ctx.services.getBeefForTxid(txids[0])
			for (let i = 1; i < txids.length; i++) {
				const additionalBeef = await ctx.services.getBeefForTxid(txids[i])
				firstBeef.mergeBeef(additionalBeef)
			}

			console.log(
				`[sweep] Merged BEEF valid=${firstBeef.isValid()}, txs=${firstBeef.txs.length}`,
			)
			console.log(`[sweep] BEEF structure:\n${firstBeef.toLogString()}`)

			// Build input descriptors (we'll sign after getting the final transaction)
			const inputDescriptors = inputs.map((input) => {
				const { txid, vout } = parseOutpoint(input.outpoint)
				return {
					outpoint: formatOutpoint(txid, vout),
					inputDescription: 'Sweep input',
					unlockingScriptLength: 108, // P2PKH unlocking script length
					sequenceNumber: 0xffffffff,
				}
			})

			const beefData = firstBeef.toBinary()

			// Build outputs array
			const outputs: CreateActionOutput[] = []

			// If amount specified, create return output for the difference
			if (amount !== undefined) {
				const returnAmount = inputTotal - amount
				if (returnAmount > 0) {
					outputs.push({
						lockingScript: new P2PKH().lock(sourceAddress).toHex(),
						satoshis: returnAmount,
						outputDescription: 'Return to source',
					})
				}
			}
			// If no amount specified, no outputs - wallet creates change for everything

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: amount
						? `Sweep ${amount} sats`
						: `Sweep ${inputTotal} sats`,
					inputBEEF: beefData,
					inputs: inputDescriptors,
					outputs,
				},
				undefined,
				beefData as number[],
				async (tx) => {
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						const key = keyMap.get(inputOutpoint)
						const source = sourceMap.get(inputOutpoint)
						if (key) {
							txInput.unlockingScriptTemplate = new P2PKH().unlock(
								key,
								'all',
								true,
								source?.satoshis,
								source?.script,
							)
						}
					}

					await tx.sign()

					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						if (keyMap.has(inputOutpoint)) {
							spends[i] = {
								unlockingScript: txInput.unlockingScript?.toHex() ?? '',
							}
						}
					}
					return spends
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepBsv',
					input: { inputCount: inputs.length, amount },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
				})
			}

			return {
				txid: result.txid,
				beef: result.tx,
			}
		} catch (error) {
			console.error('[sweepBsv]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepBsv',
					input: { inputCount: request.inputs?.length },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			// Log detailed error info for WERR_REVIEW_ACTIONS
			if (error && typeof error === 'object' && 'sendWithResults' in error) {
				const werr = error as {
					sendWithResults?: unknown
					txid?: string
					message?: string
				}
				console.error('[sweepBsv] WERR_REVIEW_ACTIONS details:', {
					message: werr.message,
					txid: werr.txid,
					sendWithResults: JSON.stringify(werr.sendWithResults, null, 2),
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Sweep ordinals from external inputs into the destination wallet.
 *
 * Each input is expected to be a 1-sat ordinal output. Each ordinal is
 * transferred to a derived address using the wallet's key derivation.
 */
export const sweepOrdinals: Action<
	SweepOrdinalsRequest,
	SweepOrdinalsResponse
> = {
	meta: {
		name: 'sweepOrdinals',
		description:
			'Sweep ordinals from external wallet (via WIF) into the connected wallet',
		category: 'sweep',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				inputs: {
					type: 'array',
					description: 'Ordinal UTXOs to sweep',
					items: {
						type: 'object',
						properties: {
							outpoint: {
								type: 'string',
								description: 'Outpoint (txid_vout)',
							},
							satoshis: {
								type: 'integer',
								description: 'Satoshis (should be 1)',
							},
							lockingScript: {
								type: 'string',
								description: 'Locking script hex',
							},
						},
						required: ['outpoint', 'satoshis', 'lockingScript'],
					},
				},
				wif: {
					type: 'string',
					description: 'WIF private key controlling the inputs',
				},
			},
			required: ['inputs', 'wif'],
		},
	},

	async execute(ctx, request): Promise<SweepOrdinalsResponse> {
		if (!ctx.services) {
			return { error: 'services-required' }
		}

		try {
			const { inputs, keys } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

			const keyMap = buildKeyMap(inputs, keys)
			const sourceMap = buildSourceMap(inputs)

			// Resolve metadata for all inputs from ORDFS
			const outpoints = inputs.map((i) => i.outpoint)
			console.log(
				`[sweepOrdinals] Resolving metadata for ${outpoints.length} outpoints`,
			)
			const metadataMap = await ctx.services.ordfs.bulkMetadata(
				outpoints.map((op) => `${op}:-2`),
			)

			// Build a lookup by outpoint (strip :-2 suffix from response keys)
			const metadata = new Map<string, OrdfsMetadata>()
			for (const [op, meta] of Object.entries(metadataMap)) {
				if (meta) metadata.set(op.replace(/:-2$/, ''), meta)
			}

			// Fetch BEEF for all input transactions and merge them
			const txids = [
				...new Set(inputs.map((i) => parseOutpoint(i.outpoint).txid)),
			]
			console.log(
				`[sweepOrdinals] Fetching BEEF for ${txids.length} transactions`,
			)

			const firstBeef = await ctx.services.getBeefForTxid(txids[0])
			for (let i = 1; i < txids.length; i++) {
				const additionalBeef = await ctx.services.getBeefForTxid(txids[i])
				firstBeef.mergeBeef(additionalBeef)
			}

			console.log(
				`[sweepOrdinals] Merged BEEF valid=${firstBeef.isValid()}, txs=${firstBeef.txs.length}`,
			)

			// Build input descriptors
			const inputDescriptors = inputs.map((input) => {
				const { txid, vout } = parseOutpoint(input.outpoint)
				const meta = metadata.get(input.outpoint)
				return {
					outpoint: formatOutpoint(txid, vout),
					inputDescription: `Ordinal ${meta?.origin ?? input.outpoint}`,
					unlockingScriptLength: 108,
					sequenceNumber: 0xffffffff,
				}
			})

			// Build outputs - one per ordinal, each 1 sat to derived address
			const outputs: CreateActionOutput[] = []
			for (const input of inputs) {
				const meta = metadata.get(input.outpoint)
				const contentType = meta?.contentType

				if (contentType === 'application/bsv-20') {
					return {
						error: `Cannot sweep BSV-20 token ${input.outpoint} through ordinal sweep — use sweepBsv21 instead`,
					}
				}

				const mapName = meta?.map?.name
				const { tags, basket } = await resolveOrdinalTags(ctx, input.outpoint, {
					contentType,
					origin: meta?.origin,
					name: typeof mapName === 'string' ? mapName : undefined,
				})

				const pubKeyResult = await ctx.wallet.getPublicKey({
					protocolID: ONESAT_PROTOCOL,
					keyID: input.outpoint,
					forSelf: true,
				})

				if (!pubKeyResult.publicKey) {
					return { error: `Failed to derive key for ${input.outpoint}` }
				}

				const derivedAddress = PublicKey.fromString(
					pubKeyResult.publicKey,
				).toAddress()

				const ordName =
					typeof mapName === 'string' ? mapName.slice(0, 64) : undefined
				outputs.push({
					lockingScript: new P2PKH().lock(derivedAddress).toHex(),
					satoshis: 1,
					outputDescription: `Ordinal ${meta?.origin ?? input.outpoint}`,
					basket,
					tags,
					customInstructions: JSON.stringify({
						protocolID: ONESAT_PROTOCOL,
						keyID: input.outpoint,
						...(ordName && { name: ordName }),
					}),
				})
			}

			const beefData = firstBeef.toBinary()

			// CRITICAL: randomizeOutputs must be false to preserve ordinal satoshi positions
			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Sweep ${inputs.length} ordinal${inputs.length !== 1 ? 's' : ''}`,
					inputBEEF: beefData,
					inputs: inputDescriptors,
					outputs,
					options: { randomizeOutputs: false },
				},
				undefined,
				beefData as number[],
				async (tx) => {
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						const key = keyMap.get(inputOutpoint)
						const source = sourceMap.get(inputOutpoint)
						if (key) {
							if (source?.script && OrdLock.isOrdLock(source.script)) {
								txInput.unlockingScriptTemplate = OrdLock.cancelListing(
									key,
									'all',
									true,
									source.satoshis,
									source.script,
								)
							} else {
								txInput.unlockingScriptTemplate = new P2PKH().unlock(
									key,
									'all',
									true,
									source?.satoshis,
									source?.script,
								)
							}
						}
					}

					await tx.sign()

					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						if (keyMap.has(inputOutpoint)) {
							spends[i] = {
								unlockingScript: txInput.unlockingScript?.toHex() ?? '',
							}
						}
					}
					return spends
				},
			)

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = inputs.map((inp, i) => ({
					index: i,
					protocolID: ONESAT_PROTOCOL,
					keyID: inp.outpoint,
					satoshis: 1,
				}))
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepOrdinals',
					input: { inputCount: inputs.length },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: logOutputs,
				})
			}

			return {
				txid: result.txid,
				beef: result.tx,
			}
		} catch (error) {
			console.error('[sweepOrdinals]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepOrdinals',
					input: { inputCount: request.inputs?.length },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			if (error && typeof error === 'object' && 'sendWithResults' in error) {
				const werr = error as {
					sendWithResults?: unknown
					txid?: string
					message?: string
				}
				console.error('[sweepOrdinals] WERR_REVIEW_ACTIONS details:', {
					message: werr.message,
					txid: werr.txid,
					sendWithResults: JSON.stringify(werr.sendWithResults, null, 2),
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Sweep BSV-21 tokens from external inputs into the destination wallet.
 *
 * Consolidates all token inputs into a single output. All inputs must be
 * for the same tokenId. Creates a fee output to the overlay fund address.
 */
export const sweepBsv21: Action<SweepBsv21Request, SweepBsv21Response> = {
	meta: {
		name: 'sweepBsv21',
		description:
			'Sweep BSV-21 tokens from external wallet (via WIF) into the connected wallet',
		category: 'sweep',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				inputs: {
					type: 'array',
					description: 'Token UTXOs to sweep (must all be same tokenId)',
					items: {
						type: 'object',
						properties: {
							outpoint: { type: 'string', description: 'Outpoint (txid_vout)' },
							satoshis: {
								type: 'integer',
								description: 'Satoshis (should be 1)',
							},
							lockingScript: {
								type: 'string',
								description: 'Locking script hex',
							},
							tokenId: {
								type: 'string',
								description: 'Token ID (txid_vout format)',
							},
							amount: { type: 'string', description: 'Token amount as string' },
						},
						required: [
							'outpoint',
							'satoshis',
							'lockingScript',
							'tokenId',
							'amount',
						],
					},
				},
				wif: {
					type: 'string',
					description: 'WIF private key controlling the inputs',
				},
			},
			required: ['inputs', 'wif'],
		},
	},

	async execute(ctx, request): Promise<SweepBsv21Response> {
		if (!ctx.services) {
			return { error: 'services-required' }
		}

		try {
			const { inputs, keys } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

			const keyMap = buildKeyMap(inputs, keys)
			const sourceMap = buildSourceMap(inputs)

			// Validate all inputs have the same tokenId
			const tokenId = inputs[0].tokenId
			if (!inputs.every((i) => i.tokenId === tokenId)) {
				return { error: 'mixed-token-ids' }
			}

			// Lookup token details to verify it's active and get fee info
			const tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)
			if (!tokenDetails.status.is_active) {
				return { error: 'token-not-active' }
			}
			const { fee_address, fee_per_output } = tokenDetails.status

			// Validate all input outpoints exist in the overlay
			const candidateOutpoints = inputs.map((i) => i.outpoint)
			const validated = await ctx.services.bsv21.validateOutputs(
				tokenId,
				candidateOutpoints,
				{ unspent: true },
			)
			const validSet = new Set(validated.map((v) => v.outpoint))
			const invalidInputs = inputs.filter((i) => !validSet.has(i.outpoint))
			if (invalidInputs.length > 0) {
				return {
					error: `unvalidated-inputs: ${invalidInputs.map((i) => i.outpoint).join(', ')}`,
				}
			}

			// Sum all input amounts
			const totalAmount = inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n)
			if (totalAmount <= 0n) {
				return { error: 'no-token-amount' }
			}

			// Fetch BEEF for all input transactions and merge them
			const txids = [
				...new Set(inputs.map((i) => parseOutpoint(i.outpoint).txid)),
			]
			console.log(`[sweepBsv21] Fetching BEEF for ${txids.length} transactions`)

			const firstBeef = await ctx.services.getBeefForTxid(txids[0])
			for (let i = 1; i < txids.length; i++) {
				const additionalBeef = await ctx.services.getBeefForTxid(txids[i])
				firstBeef.mergeBeef(additionalBeef)
			}

			console.log(
				`[sweepBsv21] Merged BEEF valid=${firstBeef.isValid()}, txs=${firstBeef.txs.length}`,
			)

			// Build input descriptors
			const inputDescriptors = inputs.map((input) => {
				const { txid, vout } = parseOutpoint(input.outpoint)
				return {
					outpoint: formatOutpoint(txid, vout),
					inputDescription: `Token input ${input.outpoint}`,
					unlockingScriptLength: 108,
					sequenceNumber: 0xffffffff,
				}
			})

			// Build outputs
			const outputs: CreateActionOutput[] = []

			// 1. Token output (1 sat) - derive key for this token
			const keyID = `${tokenId}-${Date.now()}`
			const pubKeyResult = await ctx.wallet.getPublicKey({
				protocolID: BSV21_PROTOCOL,
				keyID,
				forSelf: true,
			})

			if (!pubKeyResult.publicKey) {
				return { error: 'failed-to-derive-key' }
			}

			const derivedAddress = PublicKey.fromString(
				pubKeyResult.publicKey,
			).toAddress()
			const p2pkh = new P2PKH()
			const destinationLockingScript = p2pkh.lock(derivedAddress)
			const transferScript = BSV21.transfer(tokenId, totalAmount).lock(
				destinationLockingScript,
			)

			outputs.push({
				lockingScript: transferScript.toHex(),
				satoshis: 1,
				outputDescription: `Sweep ${totalAmount} tokens`,
				basket: BSV21_BASKET,
				tags: [
					`bsv21:${tokenId}`,
					`amt:${totalAmount}`,
					`dec:${tokenDetails.token.dec ?? 0}`,
					...(tokenDetails.token.sym ? [`sym:${tokenDetails.token.sym}`] : []),
					...(tokenDetails.token.icon
						? [`icon:${tokenDetails.token.icon}`]
						: []),
				],
				customInstructions: JSON.stringify({
					protocolID: BSV21_PROTOCOL,
					keyID,
					...(tokenDetails.token.sym && {
						sym: tokenDetails.token.sym,
					}),
				}),
			})

			// 2. Fee output to overlay fund address
			outputs.push({
				lockingScript: p2pkh.lock(fee_address).toHex(),
				satoshis: fee_per_output,
				outputDescription: 'Overlay processing fee',
				tags: [],
			})

			const beefData = firstBeef.toBinary()

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Sweep ${inputs.length} token UTXO${inputs.length !== 1 ? 's' : ''}`,
					inputBEEF: beefData,
					inputs: inputDescriptors,
					outputs,
					options: { randomizeOutputs: false },
				},
				undefined,
				beefData as number[],
				async (tx) => {
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						const key = keyMap.get(inputOutpoint)
						const source = sourceMap.get(inputOutpoint)
						if (key) {
							txInput.unlockingScriptTemplate = new P2PKH().unlock(
								key,
								'all',
								true,
								source?.satoshis,
								source?.script,
							)
						}
					}

					await tx.sign()

					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < tx.inputs.length; i++) {
						const txInput = tx.inputs[i]
						const inputOutpoint = formatOutpoint(
							txInput.sourceTXID!,
							txInput.sourceOutputIndex,
						)
						if (keyMap.has(inputOutpoint)) {
							spends[i] = {
								unlockingScript: txInput.unlockingScript?.toHex() ?? '',
							}
						}
					}
					return spends
				},
			)

			// Submit to overlay service for indexing
			if (result.tx) {
				try {
					const overlayResult = await ctx.services.overlay.submitBsv21(
						result.tx,
						tokenId,
					)
					console.log('[sweepBsv21] Overlay submission result:', overlayResult)
				} catch (overlayError) {
					console.warn('[sweepBsv21] Overlay submission failed:', overlayError)
				}
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepBsv21',
					input: {
						tokenId,
						inputCount: inputs.length,
						totalAmount: totalAmount.toString(),
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: BSV21_PROTOCOL,
							keyID,
							basket: BSV21_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return {
				txid: result.txid,
				beef: result.tx,
			}
		} catch (error) {
			console.error('[sweepBsv21]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sweepBsv21',
					input: { inputCount: request.inputs?.length },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// Export actions array for registry
export const sweepActions = [sweepBsv, sweepOrdinals, sweepBsv21]

// Export scan module
export { scanAddress, scanAddresses } from './scan'

// Export types
export type {
	PrepareResult,
	ScanProgress,
	ScanResult,
	TokenBalance,
} from './types'

/**
 * Prepare a BSV sweep transaction for client-side signing.
 * Returns unsigned tx + reference -- client signs externally, then calls completeSweep.
 */
export async function prepareSweepBsv(
	ctx: OneSatContext,
	inputs: SweepInput[],
	amount?: number,
): Promise<import('./types').PrepareResult> {
	if (!ctx.services) throw new Error('Services required')
	if (!inputs.length) throw new Error('No inputs provided')

	const inputTotal = inputs.reduce((sum, i) => sum + i.satoshis, 0)
	if (amount !== undefined && amount > inputTotal)
		throw new Error('Insufficient funds')

	// Fetch BEEF for all input transactions and merge them
	const txids = [...new Set(inputs.map((i) => parseOutpoint(i.outpoint).txid))]

	const firstBeef = await ctx.services.getBeefForTxid(txids[0])
	for (let i = 1; i < txids.length; i++) {
		const additionalBeef = await ctx.services.getBeefForTxid(txids[i])
		firstBeef.mergeBeef(additionalBeef)
	}

	// Build input descriptors
	const inputDescriptors = inputs.map((input) => {
		const { txid, vout } = parseOutpoint(input.outpoint)
		return {
			outpoint: formatOutpoint(txid, vout),
			inputDescription: 'Sweep input',
			unlockingScriptLength: 108, // P2PKH unlocking script length
			sequenceNumber: 0xffffffff,
		}
	})

	// Build outputs array
	const outputs: CreateActionOutput[] = []

	// If amount specified, we need the source address for the return output.
	// Since we don't have the WIF here (client-side signing), the caller must
	// handle partial sweeps by adding a return output before calling this.
	// For prepareSweepBsv, always sweep all -- wallet creates change.

	const createResult = await createTrackedAction(ctx.wallet, {
		description: amount ? `Sweep ${amount} sats` : `Sweep ${inputTotal} sats`,
		inputBEEF: firstBeef.toBinary(),
		inputs: inputDescriptors,
		outputs,
	})

	if ('error' in createResult && createResult.error) {
		throw new Error(String(createResult.error))
	}

	if (!createResult.signableTransaction) {
		throw new Error('No signable transaction returned')
	}

	// Parse the transaction to build inputsToSign mapping
	const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

	const ourOutpoints = new Set(
		inputs.map((input) => {
			const { txid, vout } = parseOutpoint(input.outpoint)
			return formatOutpoint(txid, vout)
		}),
	)

	const inputsToSign: import('./types').PrepareResult['inputsToSign'] = []
	for (let idx = 0; idx < tx.inputs.length; idx++) {
		const txInput = tx.inputs[idx]
		const op = formatOutpoint(txInput.sourceTXID!, txInput.sourceOutputIndex)
		if (ourOutpoints.has(op)) {
			const matchingInput = inputs.find((i) => {
				const { txid, vout } = parseOutpoint(i.outpoint)
				return formatOutpoint(txid, vout) === op
			})
			inputsToSign.push({
				index: idx,
				outpoint: matchingInput?.outpoint ?? '',
				satoshis: matchingInput?.satoshis ?? 0,
				lockingScript: matchingInput?.lockingScript ?? '',
			})
		}
	}

	// Convert tx BEEF to hex for JSON transport
	const txHex = Utils.toHex(createResult.signableTransaction.tx)

	return {
		txHex,
		reference: createResult.signableTransaction.reference,
		inputsToSign,
	}
}

/**
 * Complete a sweep by broadcasting with signed spends.
 * Called after client-side signing with the reference from prepare.
 */
export async function completeSweep(
	ctx: OneSatContext,
	reference: string,
	spends: Record<number, { unlockingScript: string }>,
): Promise<{ txid: string; rawTx?: string }> {
	const signResult = await ctx.wallet.signAction({
		reference,
		spends,
		options: { acceptDelayedBroadcast: false },
	})

	if ('error' in signResult) {
		throw new Error(String(signResult.error))
	}

	return {
		txid: signResult.txid!,
		rawTx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
	}
}
