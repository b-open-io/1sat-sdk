/**
 * Sweep Module
 *
 * Functions for sweeping assets from external wallets into a BRC-100 wallet.
 */

import type { IndexedOutput } from '@1sat/types'
import { BSV21 } from '@bopen-io/templates'
import {
	type CreateActionOutput,
	P2PKH,
	PrivateKey,
	PublicKey,
	Transaction,
	Utils,
} from '@bsv/sdk'
import {
	BSV21_BASKET,
	BSV21_PROTOCOL,
	ONESAT_PROTOCOL,
	ORDINALS_BASKET,
} from '../constants'
import type { Action, OneSatContext } from '../types'
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
		const [txid, voutStr] = utxo.outpoint.split('_')
		const vout = Number.parseInt(voutStr, 10)
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
			const { inputs, wif, amount } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

			// Parse WIF and derive source address
			const privateKey = PrivateKey.fromWif(wif)
			const sourceAddress = privateKey.toPublicKey().toAddress()

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
			const txids = [...new Set(inputs.map((i) => i.outpoint.split('_')[0]))]

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
				const [txid, voutStr] = input.outpoint.split('_')
				// Convert outpoint format: our format uses "_" but SDK expects "."
				return {
					outpoint: `${txid}.${voutStr}`,
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

			// Step 1: Create action to get the signable transaction
			const createResult = await ctx.wallet.createAction({
				description: amount
					? `Sweep ${amount} sats`
					: `Sweep ${inputTotal} sats`,
				inputBEEF: beefData,
				inputs: inputDescriptors,
				outputs,
				options: { signAndProcess: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			// Step 2: Sign each input with our external key
			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

			console.log(
				`[sweep] Transaction has ${tx.inputs.length} inputs, ${tx.outputs.length} outputs`,
			)

			// Build a set of outpoints we control (using SDK format with ".")
			const ourOutpoints = new Set(
				inputs.map((input) => {
					const [txid, vout] = input.outpoint.split('_')
					return `${txid}.${vout}`
				}),
			)

			// Find and set up P2PKH unlocker on each input we control
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`
				const hasSourceTx = !!txInput.sourceTransaction
				const sourceSatoshis =
					txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]
						?.satoshis

				console.log(
					`[sweep] Input ${i}: ${inputOutpoint}, hasSourceTx=${hasSourceTx}, satoshis=${sourceSatoshis}, isOurs=${ourOutpoints.has(inputOutpoint)}`,
				)

				if (ourOutpoints.has(inputOutpoint)) {
					const p2pkh = new P2PKH()
					txInput.unlockingScriptTemplate = p2pkh.unlock(
						privateKey,
						'all', // SIGHASH_ALL - commit to outputs (we know them now)
						true, // anyoneCanPay - only commit to this input
					)
				}
			}

			// Sign all inputs
			await tx.sign()

			// Extract unlocking scripts for signAction (only for our inputs)
			const spends: Record<number, { unlockingScript: string }> = {}
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`

				if (ourOutpoints.has(inputOutpoint)) {
					spends[i] = {
						unlockingScript: txInput.unlockingScript?.toHex() ?? '',
					}
				}
			}

			// Step 3: Complete the action with our signatures
			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends,
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			return {
				txid: signResult.txid,
				beef: signResult.tx ? Array.from(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[sweepBsv]', error)
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
							contentType: {
								type: 'string',
								description: 'Content type from metadata',
							},
							origin: { type: 'string', description: 'Origin outpoint' },
							name: { type: 'string', description: 'Name from MAP metadata' },
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
			const { inputs, wif } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

			// Parse WIF
			const privateKey = PrivateKey.fromWif(wif)

			// Fetch BEEF for all input transactions and merge them
			const txids = [...new Set(inputs.map((i) => i.outpoint.split('_')[0]))]
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
				const [txid, voutStr] = input.outpoint.split('_')
				return {
					outpoint: `${txid}.${voutStr}`,
					inputDescription: `Ordinal ${input.origin ?? input.outpoint}`,
					unlockingScriptLength: 108,
					sequenceNumber: 0xffffffff,
				}
			})

			// Build outputs - one per ordinal, each 1 sat to derived address
			const outputs: CreateActionOutput[] = []
			for (const input of inputs) {
				// Derive a unique public key for this ordinal using the input outpoint as keyID
				const pubKeyResult = await ctx.wallet.getPublicKey({
					protocolID: ONESAT_PROTOCOL,
					keyID: input.outpoint,
					forSelf: true,
				})

				if (!pubKeyResult.publicKey) {
					return { error: `Failed to derive key for ${input.outpoint}` }
				}

				// Create P2PKH locking script from derived public key
				const derivedAddress = PublicKey.fromString(
					pubKeyResult.publicKey,
				).toAddress()
				const lockingScript = new P2PKH().lock(derivedAddress)

				// Build tags following ordinals API pattern
				const tags: string[] = []
				if (input.contentType) tags.push(`type:${input.contentType}`)
				if (input.origin) tags.push(`origin:${input.origin}`)
				const customInstructions = JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: input.outpoint,
					...(input.name && { name: input.name.slice(0, 64) }),
				})
				console.log(
					`[sweepOrdinals] Output for ${input.outpoint}: keyID=${input.outpoint}, customInstructions=${customInstructions}`,
				)
				outputs.push({
					lockingScript: lockingScript.toHex(),
					satoshis: 1,
					outputDescription: `Ordinal ${input.origin ?? input.outpoint}`,
					basket: ORDINALS_BASKET,
					tags,
					customInstructions,
				})
			}

			const beefData = firstBeef.toBinary()

			// Create action to get signable transaction
			// CRITICAL: randomizeOutputs must be false to preserve ordinal satoshi positions
			const createActionArgs = {
				description: `Sweep ${inputs.length} ordinal${inputs.length !== 1 ? 's' : ''}`,
				inputBEEF: beefData,
				inputs: inputDescriptors,
				outputs,
				options: { signAndProcess: false, randomizeOutputs: false },
			}

			console.log('[sweepOrdinals] === CREATE ACTION ARGS ===')
			console.log(
				`[sweepOrdinals] description: ${createActionArgs.description}`,
			)
			console.log(`[sweepOrdinals] inputBEEF length: ${beefData.length} bytes`)
			console.log(`[sweepOrdinals] inputs count: ${inputDescriptors.length}`)
			console.log(`[sweepOrdinals] outputs count: ${outputs.length}`)
			console.log(
				'[sweepOrdinals] inputs:',
				JSON.stringify(inputDescriptors, null, 2),
			)
			console.log('[sweepOrdinals] outputs:', JSON.stringify(outputs, null, 2))
			console.log(
				'[sweepOrdinals] options:',
				JSON.stringify(createActionArgs.options),
			)
			console.log('[sweepOrdinals] Calling createAction...')

			let createResult: Awaited<ReturnType<typeof ctx.wallet.createAction>>
			try {
				createResult = await ctx.wallet.createAction(createActionArgs)
				console.log(
					'[sweepOrdinals] createAction returned:',
					JSON.stringify(
						createResult,
						(key, value) => {
							// Don't stringify large binary data
							if (key === 'tx' && value instanceof Uint8Array) {
								return `<Uint8Array ${value.length} bytes>`
							}
							if (key === 'tx' && Array.isArray(value)) {
								return `<Array ${value.length} bytes>`
							}
							return value
						},
						2,
					),
				)
			} catch (createError) {
				console.error('[sweepOrdinals] createAction threw:', createError)
				const errorMsg =
					createError instanceof Error
						? createError.message
						: String(createError)
				const errorStack =
					createError instanceof Error ? createError.stack : undefined
				console.error('[sweepOrdinals] Stack:', errorStack)
				return { error: `createAction failed: ${errorMsg}` }
			}

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			// Sign each input with our external key
			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

			// Log transaction structure for debugging
			console.log('[sweepOrdinals] === Transaction Structure ===')
			console.log(`[sweepOrdinals] Inputs (${tx.inputs.length}):`)
			let totalInputSats = 0
			for (let i = 0; i < tx.inputs.length; i++) {
				const inp = tx.inputs[i]
				const sats =
					inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.satoshis ?? 0
				totalInputSats += sats
				console.log(
					`  [${i}] ${inp.sourceTXID}:${inp.sourceOutputIndex} = ${sats} sats`,
				)
			}
			console.log(`[sweepOrdinals] Outputs (${tx.outputs.length}):`)
			let totalOutputSats = 0
			for (let i = 0; i < tx.outputs.length; i++) {
				const out = tx.outputs[i]
				totalOutputSats += out.satoshis ?? 0
				console.log(
					`  [${i}] ${out.satoshis} sats, script len=${out.lockingScript?.toHex().length ?? 0}`,
				)
			}
			console.log(
				`[sweepOrdinals] Total in: ${totalInputSats}, Total out: ${totalOutputSats}, Fee: ${totalInputSats - totalOutputSats}`,
			)
			console.log(
				`[sweepOrdinals] Signable tx hex: ${Utils.toHex(createResult.signableTransaction.tx)}`,
			)
			console.log('[sweepOrdinals] ==============================')

			// Build a set of outpoints we control
			const ourOutpoints = new Set(
				inputs.map((input) => {
					const [txid, vout] = input.outpoint.split('_')
					return `${txid}.${vout}`
				}),
			)

			// Set up P2PKH unlocker on each input we control
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`

				if (ourOutpoints.has(inputOutpoint)) {
					const p2pkh = new P2PKH()
					txInput.unlockingScriptTemplate = p2pkh.unlock(
						privateKey,
						'all',
						true, // anyoneCanPay
					)
				}
			}

			await tx.sign()

			// Log signed transaction details for debugging
			const localTxid = tx.id('hex')
			console.log('[sweepOrdinals] === LOCAL SIGNED TX ===')
			console.log(`[sweepOrdinals] Local txid: ${localTxid}`)
			console.log(`[sweepOrdinals] Signed tx hex: ${tx.toHex()}`)

			// Extract unlocking scripts for signAction
			const spends: Record<number, { unlockingScript: string }> = {}
			console.log('[sweepOrdinals] === UNLOCKING SCRIPTS FOR SIGNACTION ===')
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`

				if (ourOutpoints.has(inputOutpoint)) {
					const unlockHex = txInput.unlockingScript?.toHex() ?? ''
					spends[i] = { unlockingScript: unlockHex }
					console.log(`  [${i}] ${inputOutpoint}: ${unlockHex.length} chars`)
				} else {
					console.log(`  [${i}] ${inputOutpoint}: (wallet input - not ours)`)
				}
			}

			// Complete the action with our signatures
			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends,
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			// Debug: compare local vs signAction result
			console.log('[sweepOrdinals] === SIGN ACTION RESULT ===')
			console.log(`[sweepOrdinals] signAction txid: ${signResult.txid}`)
			// Log broadcast results if available
			if ('sendWithResults' in signResult) {
				console.log(
					'[sweepOrdinals] sendWithResults:',
					JSON.stringify(
						(signResult as { sendWithResults?: unknown }).sendWithResults,
					),
				)
			}
			console.log(`[sweepOrdinals] Local txid (partial): ${localTxid}`)
			console.log(
				'[sweepOrdinals] Note: TXIDs differ because local is partial (wallet input unsigned)',
			)

			if (signResult.tx) {
				// Parse returned BEEF to show final transaction structure
				const returnedTx = Transaction.fromBEEF(signResult.tx)
				console.log('[sweepOrdinals] === FINAL TX STRUCTURE (broadcast) ===')
				console.log(
					`[sweepOrdinals] Final inputs (${returnedTx.inputs.length}):`,
				)
				let returnedInputSats = 0
				for (let i = 0; i < returnedTx.inputs.length; i++) {
					const inp = returnedTx.inputs[i]
					const sats =
						inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.satoshis ?? 0
					returnedInputSats += sats
					const isOurs = ourOutpoints.has(
						`${inp.sourceTXID}.${inp.sourceOutputIndex}`,
					)
					console.log(
						`  [${i}] ${inp.sourceTXID?.slice(0, 8)}...:${inp.sourceOutputIndex} = ${sats} sats, unlock=${inp.unlockingScript?.toHex().length ?? 0} chars ${isOurs ? '(ours)' : '(wallet fee)'}`,
					)
				}
				console.log(
					`[sweepOrdinals] Final outputs (${returnedTx.outputs.length}):`,
				)
				let returnedOutputSats = 0
				for (let i = 0; i < returnedTx.outputs.length; i++) {
					const out = returnedTx.outputs[i]
					returnedOutputSats += out.satoshis ?? 0
					console.log(
						`  [${i}] ${out.satoshis} sats, script=${out.lockingScript?.toHex().length ?? 0} chars`,
					)
				}
				const finalFee = returnedInputSats - returnedOutputSats
				console.log(
					`[sweepOrdinals] Final: Total in=${returnedInputSats}, Total out=${returnedOutputSats}, Fee=${finalFee} sats`,
				)
				console.log(`[sweepOrdinals] Final tx hex: ${returnedTx.toHex()}`)
				console.log(
					`[sweepOrdinals] Final tx computed id: ${returnedTx.id('hex')}`,
				)

				// Check if fee seems too low (less than 1 sat/byte)
				const txSize = returnedTx.toHex().length / 2
				const satPerByte = finalFee / txSize
				console.log(
					`[sweepOrdinals] Tx size: ${txSize} bytes, Fee rate: ${satPerByte.toFixed(2)} sat/byte`,
				)
				if (satPerByte < 0.5) {
					console.warn('[sweepOrdinals] WARNING: Fee rate seems very low!')
				}
			}

			return {
				txid: signResult.txid,
				beef: signResult.tx ? Array.from(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[sweepOrdinals]', error)
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
			const { inputs, wif } = request

			if (!inputs || inputs.length === 0) {
				return { error: 'no-inputs' }
			}

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

			// Parse WIF
			const privateKey = PrivateKey.fromWif(wif)

			// Sum all input amounts
			const totalAmount = inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n)
			if (totalAmount <= 0n) {
				return { error: 'no-token-amount' }
			}

			// Fetch BEEF for all input transactions and merge them
			const txids = [...new Set(inputs.map((i) => i.outpoint.split('_')[0]))]
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
				const [txid, voutStr] = input.outpoint.split('_')
				return {
					outpoint: `${txid}.${voutStr}`,
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
					`id:${tokenId}`,
					`amt:${totalAmount}`,
					`dec:${tokenDetails.token.dec}`,
					...(tokenDetails.token.sym ? [`sym:${tokenDetails.token.sym}`] : []),
					...(tokenDetails.token.icon
						? [`icon:${tokenDetails.token.icon}`]
						: []),
				],
				customInstructions: JSON.stringify({
					protocolID: BSV21_PROTOCOL,
					keyID,
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

			// Create action to get signable transaction
			const createResult = await ctx.wallet.createAction({
				description: `Sweep ${inputs.length} token UTXO${inputs.length !== 1 ? 's' : ''}`,
				inputBEEF: beefData,
				inputs: inputDescriptors,
				outputs,
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			// Sign each input with our external key
			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

			// Build a set of outpoints we control
			const ourOutpoints = new Set(
				inputs.map((input) => {
					const [txid, vout] = input.outpoint.split('_')
					return `${txid}.${vout}`
				}),
			)

			// Set up P2PKH unlocker on each input we control
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`

				if (ourOutpoints.has(inputOutpoint)) {
					txInput.unlockingScriptTemplate = p2pkh.unlock(
						privateKey,
						'all',
						true, // anyoneCanPay
					)
				}
			}

			await tx.sign()

			// Extract unlocking scripts for signAction
			const spends: Record<number, { unlockingScript: string }> = {}
			for (let i = 0; i < tx.inputs.length; i++) {
				const txInput = tx.inputs[i]
				const inputOutpoint = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`

				if (ourOutpoints.has(inputOutpoint)) {
					spends[i] = {
						unlockingScript: txInput.unlockingScript?.toHex() ?? '',
					}
				}
			}

			// Complete the action with our signatures
			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends,
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			// Submit to overlay service for indexing
			if (signResult.tx) {
				try {
					const overlayResult = await ctx.services.overlay.submitBsv21(
						signResult.tx,
						tokenId,
					)
					console.log('[sweepBsv21] Overlay submission result:', overlayResult)
				} catch (overlayError) {
					// Log but don't fail the sweep - tx is already broadcast
					console.warn('[sweepBsv21] Overlay submission failed:', overlayError)
				}
			}

			return {
				txid: signResult.txid,
				beef: signResult.tx ? Array.from(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[sweepBsv21]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// Export actions array for registry
export const sweepActions = [sweepBsv, sweepOrdinals, sweepBsv21]
