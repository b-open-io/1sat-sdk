/**
 * Tokens Module
 *
 * Actions for managing BSV21 tokens.
 */

import { BSV21, OrdLock } from '@1sat/templates'
import type { Destination } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import {
	Beef,
	BigNumber,
	LockingScript,
	OP,
	P2PKH,
	PublicKey,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import {
	BSV21_AUTH_BASKET,
	BSV21_BASKET,
	BSV21_DEPLOY_FUNDING_BASKET,
	BSV21_PROTOCOL,
} from '../constants'
import type {
	Action,
	ActionLogEntry,
	ActionOptions,
	OneSatContext,
} from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { getDisplayValue } from '../utils/displayValue'
import { resolveDestination } from '../utils/resolveDestination'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

export interface Bsv21Balance {
	/** Token protocol (bsv-20) */
	p: string
	/** Token ID (outpoint for BSV21, tick for BSV20) */
	id: string
	/** Token symbol */
	sym?: string
	/** Token icon URL */
	icon?: string
	/** Decimal places */
	dec: number
	/** Total amount (confirmed + pending) */
	amt: string
	/** Breakdown of confirmed vs pending */
	all: {
		confirmed: bigint
		pending: bigint
	}
	/** Listed amounts (if applicable) */
	listed: {
		confirmed: bigint
		pending: bigint
	}
}

export interface SendBsv21Recipient {
	/** Amount to send (as bigint or string) */
	amount: bigint | string
	/** Where to lock the output. */
	destination: Destination
}

export interface SendBsv21Input extends ActionOptions {
	/** Token ID (txid_vout format) */
	tokenId: string
	/** Recipients to send tokens to */
	recipients: SendBsv21Recipient[]
}

export interface PurchaseBsv21Request extends ActionOptions {
	/** Token ID (txid_vout format of the deploy transaction) */
	tokenId: string
	/** Outpoint of listed token UTXO (OrdLock containing BSV21) */
	outpoint: string
	/** Amount of tokens in the listing */
	amount: bigint | string
	/** Optional marketplace fee address */
	marketplaceAddress?: string
	/** Optional marketplace fee rate (0-1) */
	marketplaceRate?: number
}

export interface TokenOperationResponse {
	txid?: string
	tx?: number[]
	error?: string
}

export interface DeployBsv21MintInput extends ActionOptions {
	/** Token symbol/ticker (max 32 chars) */
	symbol: string
	/** Total fixed supply (as bigint or string) */
	amount: bigint | string
	/** Decimal places (0-18) */
	decimals?: number
	/** Optional icon URL or data URI */
	icon?: string
	/** Recipient of the supply. Defaults to self. */
	destination?: Destination
}

export interface DeployBsv21AuthInput extends ActionOptions {
	/** Token symbol/ticker (max 32 chars) */
	symbol: string
	/** Decimal places (0-18) */
	decimals?: number
	/** Optional icon URL or data URI */
	icon?: string
	/** Auth-holder for the deploy+auth UTXO (= the first auth). Defaults to self. */
	destination?: Destination
}

export interface DeployBsv21Response extends TokenOperationResponse {
	/** New token ID = `${txid}_${deployVout}` */
	tokenId?: string
}

export interface DeployBsv21AuthResponse extends DeployBsv21Response {
	/** Outpoint of the auth UTXO needed for future mints */
	authOutpoint?: string
}

export interface MintBsv21Input extends ActionOptions {
	/** Token ID (txid_vout of the deploy+auth) */
	tokenId: string
	/** Optional mint output. Omit to skip minting (auth-only operation). */
	mint?: { amount: bigint | string; destination: Destination }
	/**
	 * Optional continuing/transferred auth output. Omit to permanently end
	 * minting; in that case `endMinting: true` is required as confirmation.
	 */
	auth?: { destination: Destination }
	/** Required when `auth` is omitted — explicit confirmation that minting ends. */
	endMinting?: boolean
}

export interface MintBsv21Response extends TokenOperationResponse {
	/** Outpoint of the new auth UTXO, if one was emitted. */
	authOutpoint?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildSerializedOutput(satoshis: number, script: number[]): number[] {
	const writer = new Utils.Writer()
	writer.writeUInt64LEBn(new BigNumber(satoshis))
	writer.writeVarIntNum(script.length)
	writer.write(script)
	return writer.toArray()
}

async function buildPurchaseUnlockingScript(
	tx: Transaction,
	inputIndex: number,
	sourceSatoshis: number,
	lockingScript: LockingScript,
): Promise<UnlockingScript> {
	if (tx.outputs.length < 2) {
		throw new Error('Malformed transaction: requires at least 2 outputs')
	}

	const script = new UnlockingScript().writeBin(
		buildSerializedOutput(
			tx.outputs[0].satoshis ?? 0,
			tx.outputs[0].lockingScript.toBinary(),
		),
	)

	if (tx.outputs.length > 2) {
		const writer = new Utils.Writer()
		for (const output of tx.outputs.slice(2)) {
			writer.write(
				buildSerializedOutput(
					output.satoshis ?? 0,
					output.lockingScript.toBinary(),
				),
			)
		}
		script.writeBin(writer.toArray())
	} else {
		script.writeOpCode(OP.OP_0)
	}

	const input = tx.inputs[inputIndex]
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		throw new Error('sourceTXID is required')
	}

	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: [],
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript: lockingScript,
		lockTime: tx.lockTime,
		scope:
			TransactionSignature.SIGHASH_ALL |
			TransactionSignature.SIGHASH_ANYONECANPAY |
			TransactionSignature.SIGHASH_FORKID,
	})

	return script.writeBin(preimage).writeOpCode(OP.OP_0)
}

async function listTokensInternal(
	ctx: OneSatContext,
	limit = 10000,
): Promise<WalletOutput[]> {
	const result = await ctx.wallet.listOutputs({
		basket: BSV21_BASKET,
		includeTags: true,
		includeCustomInstructions: true,
		limit,
	})
	return result.outputs
}

// ============================================================================
// Actions
// ============================================================================

/** Input for listTokens action */
export interface ListTokensInput {
	/** Max number of tokens to return */
	limit?: number
}

/**
 * List BSV21 token outputs from the wallet.
 */
export const listTokens: Action<ListTokensInput, WalletOutput[]> = {
	meta: {
		name: 'listTokens',
		description: 'List BSV21 token outputs from the wallet',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					description: 'Max number of tokens to return (default: 10000)',
				},
			},
		},
	},
	async execute(ctx, input) {
		return listTokensInternal(ctx, input.limit)
	},
}

/** Input for getBsv21Balances action (no required params) */
export type GetBsv21BalancesInput = Record<string, never>

/**
 * Get aggregated BSV21 token balances.
 */
export const getBsv21Balances: Action<GetBsv21BalancesInput, Bsv21Balance[]> = {
	meta: {
		name: 'getBsv21Balances',
		description: 'Get aggregated BSV21 token balances grouped by token ID',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const outputs = await listTokensInternal(ctx)

		const balanceMap = new Map<
			string,
			{
				id: string
				amt: bigint
				icon?: string
				sym?: string
				dec: number
			}
		>()

		for (const o of outputs) {
			const idTag = o.tags?.find((t) => t.startsWith('bsv21:'))
			const amtTag = o.tags?.find((t) => t.startsWith('amt:'))?.slice(4)
			if (!idTag || !amtTag) continue

			const tokenId = idTag.slice(6)
			const amt = BigInt(amtTag)
			const dec = Number.parseInt(
				o.tags?.find((t) => t.startsWith('dec:'))?.slice(4) || '0',
				10,
			)
			const symTag = getDisplayValue(o, 'sym', 'sym')
			const rawIcon = o.tags?.find((t) => t.startsWith('icon:'))?.slice(5)
			const icon = rawIcon?.startsWith('_')
				? `${tokenId.split('_')[0]}${rawIcon}`
				: rawIcon

			const existing = balanceMap.get(tokenId)
			if (existing) {
				existing.amt += amt
			} else {
				balanceMap.set(tokenId, {
					id: tokenId,
					amt,
					sym: symTag,
					icon,
					dec,
				})
			}
		}

		return Array.from(balanceMap.values()).map((b) => ({
			p: 'bsv-20',
			op: 'transfer',
			dec: b.dec,
			amt: b.amt.toString(),
			id: b.id,
			sym: b.sym,
			icon: b.icon,
			all: { confirmed: b.amt, pending: 0n },
			listed: { confirmed: 0n, pending: 0n },
		}))
	},
}

/**
 * Send BSV21 tokens to one or more recipients.
 */
export const sendBsv21: Action<SendBsv21Input, TokenOperationResponse> = {
	meta: {
		name: 'sendBsv21',
		description: 'Send BSV21 tokens to one or more recipients',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: { type: 'string', description: 'Token ID (txid_vout format)' },
				recipients: {
					type: 'array',
					description: 'Recipients to send tokens to',
					items: {
						type: 'object',
						properties: {
							amount: {
								type: 'string',
								description: 'Amount to send (as string for bigint)',
							},
							destination: {
								type: 'object',
								description:
									'Where to lock the output. One of lockingScript (hex), counterparty (pubkey), or address.',
							},
						},
						required: ['amount', 'destination'],
					},
				},
			},
			required: ['tokenId', 'recipients'],
		},
	},
	async execute(ctx, input) {
		try {
			const { tokenId, recipients } = input

			if (!recipients.length) {
				return { error: 'no-recipients' }
			}

			const resolved: Array<{
				amount: bigint
				destination: Destination
			}> = []

			for (const r of recipients) {
				const amount =
					typeof r.amount === 'string' ? BigInt(r.amount) : r.amount
				if (amount <= 0n) {
					return { error: 'amount-must-be-positive' }
				}
				if (!r.destination) {
					return { error: 'recipient-missing-destination' }
				}
				resolved.push({ amount, destination: r.destination })
			}

			const totalAmount = resolved.reduce((sum, r) => sum + r.amount, 0n)

			if (!ctx.services) {
				return { error: 'services-required' }
			}

			const tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)
			if (!tokenDetails.status.is_active) {
				return { error: 'token-not-active' }
			}
			const { fee_address, fee_per_output } = tokenDetails.status

			const listResult = await ctx.wallet.listOutputs({
				basket: BSV21_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 10000,
			})

			const tokenUtxos = listResult.outputs.filter((o) => {
				const idTag = o.tags?.find((t) => t.startsWith('bsv21:'))
				if (!idTag) return false
				return idTag.slice(6) === tokenId
			})

			// Batch-validate all candidate outpoints against the overlay
			const validOutpoints = new Set<string>()
			let overlayValidated = false
			if (ctx.services?.bsv21) {
				const candidateOutpoints = tokenUtxos.map((o) => o.outpoint)
				try {
					const validated = await ctx.services.bsv21.validateOutputs(
						tokenId,
						candidateOutpoints,
						{ unspent: true },
					)
					overlayValidated = true
					for (const v of validated) {
						const normalizedOutpoint = v.outpoint.replace('_', '.')
						validOutpoints.add(normalizedOutpoint)
					}
				} catch (e) {
					console.error('[sendBsv21] overlay validation error:', e)
					return { error: 'overlay-validation-failed' }
				}
			}

			const selected: WalletOutput[] = []
			let totalIn = 0n

			for (const utxo of tokenUtxos) {
				if (totalIn >= totalAmount) break

				const amtTag = utxo.tags?.find((t) => t.startsWith('amt:'))
				if (!amtTag) continue
				const utxoAmount = BigInt(amtTag.slice(4))

				if (overlayValidated && !validOutpoints.has(utxo.outpoint)) {
					continue
				}

				selected.push(utxo)
				totalIn += utxoAmount
			}

			if (totalIn < totalAmount) {
				return { error: 'insufficient-tokens' }
			}

			const outputs: Array<{
				lockingScript: string
				satoshis: number
				outputDescription: string
				basket?: string
				tags?: string[]
				customInstructions?: string
			}> = []

			const p2pkh = new P2PKH()
			const recipientKeyIDs: Array<string | undefined> = []

			// Build recipient outputs
			for (const r of resolved) {
				const recipientResolved = await resolveDestination(ctx, r.destination, {
					protocolID: BSV21_PROTOCOL,
					keyIDPrefix: tokenId,
				})
				recipientKeyIDs.push(recipientResolved.customInstructions?.keyID)

				const transferScript = BSV21.transfer(tokenId, r.amount).lock(
					recipientResolved.lockingScript,
				)
				outputs.push({
					lockingScript: transferScript.toHex(),
					satoshis: 1,
					outputDescription: `Send ${r.amount} tokens`,
				})
			}

			// Change output
			const change = totalIn - totalAmount
			let tokenOutputCount = resolved.length
			let changeKeyID: string | undefined
			if (change > 0n) {
				tokenOutputCount += 1
				changeKeyID = `${tokenId}-${Date.now()}`
				const { publicKey } = await ctx.wallet.getPublicKey({
					protocolID: BSV21_PROTOCOL,
					keyID: changeKeyID,
					counterparty: 'self',
					forSelf: true,
				})
				const changeAddress = PublicKey.fromString(publicKey).toAddress()
				const changeLockingScript = p2pkh.lock(changeAddress)
				const changeScript = BSV21.transfer(tokenId, change).lock(
					changeLockingScript,
				)

				outputs.push({
					lockingScript: changeScript.toHex(),
					satoshis: 1,
					outputDescription: 'Token change',
					basket: BSV21_BASKET,
					tags: [
						`bsv21:${tokenId}`,
						`amt:${change}`,
						`dec:${tokenDetails.token.dec ?? 0}`,
						...(tokenDetails.token.sym
							? [`sym:${tokenDetails.token.sym}`]
							: []),
						...(tokenDetails.token.icon
							? [`icon:${tokenDetails.token.icon}`]
							: []),
					],
					customInstructions: JSON.stringify({
						protocolID: BSV21_PROTOCOL,
						keyID: changeKeyID,
						...(tokenDetails.token.sym && {
							sym: tokenDetails.token.sym,
						}),
					}),
				})
			}

			// Fee output to overlay fund address (per token output)
			outputs.push({
				lockingScript: p2pkh.lock(fee_address).toHex(),
				satoshis: fee_per_output * tokenOutputCount,
				outputDescription: 'Overlay processing fee',
				tags: [],
			})

			const symbol = tokenDetails.token.sym || tokenId.slice(0, 8)

			let inputBEEF = listResult.BEEF
			if (!inputBEEF || (inputBEEF as number[]).length === 0) {
				if (!ctx.services) return { error: 'no-beef-available' }
				console.warn(
					'[sendBsv21] BEEF not returned by listOutputs, falling back to service lookup',
				)
				const txids = [
					...new Set(selected.map((o) => o.outpoint.split('.')[0])),
				]
				const beef = await ctx.services.getBeefForTxid(txids[0])
				for (let i = 1; i < txids.length; i++) {
					beef.mergeBeef(await ctx.services.getBeefForTxid(txids[i]))
				}
				inputBEEF = beef.toBinary()
			}
			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Send ${symbol} to ${resolved.length} recipient${resolved.length > 1 ? 's' : ''}`,
					labels: [`bsv21:${tokenId}`],
					inputBEEF,
					inputs: selected.map((o) => ({
						outpoint: o.outpoint,
						inputDescription: 'Token input',
						unlockingScriptLength: 108,
					})),
					outputs,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				inputBEEF as number[],
				async (tx) => {
					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < selected.length; i++) {
						const utxo = selected[i]
						if (!utxo.customInstructions) continue
						const { protocolID, keyID, counterparty } = JSON.parse(
							utxo.customInstructions,
						)
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							i,
							protocolID,
							keyID,
							counterparty,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						spends[i] = { unlockingScript: unlocking }
					}
					return spends
				},
			)

			// Submit to overlay service for indexing
			if (result.tx && ctx.services) {
				try {
					const overlayResult = await ctx.services.overlay.submitBsv21(
						result.tx,
						tokenId,
					)
					console.log('[sendBsv21] Overlay submission result:', overlayResult)
				} catch (overlayError) {
					console.warn('[sendBsv21] Overlay submission failed:', overlayError)
				}
			}

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = resolved.map((_r, i) => ({
					index: i,
					protocolID: BSV21_PROTOCOL,
					keyID: recipientKeyIDs[i],
					basket: BSV21_BASKET,
					satoshis: 1,
				}))
				if (change > 0n) {
					logOutputs.push({
						index: resolved.length,
						protocolID: BSV21_PROTOCOL,
						keyID: changeKeyID,
						basket: BSV21_BASKET,
						satoshis: 1,
					})
				}
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendBsv21',
					input: {
						tokenId,
						recipients: resolved.map((r) => ({
							amount: r.amount.toString(),
							destination: r.destination,
						})),
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: logOutputs,
				})
			}

			return result
		} catch (error) {
			console.error('[sendBsv21]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendBsv21',
					input: { tokenId: input.tokenId },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Purchase BSV21 tokens from marketplace.
 */
export const purchaseBsv21: Action<
	PurchaseBsv21Request,
	TokenOperationResponse
> = {
	meta: {
		name: 'purchaseBsv21',
		description: 'Purchase BSV21 tokens from the marketplace',
		category: 'tokens',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: { type: 'string', description: 'Token ID (txid_vout format)' },
				outpoint: {
					type: 'string',
					description: 'Outpoint of the listed token UTXO',
				},
				amount: {
					type: 'string',
					description: 'Amount of tokens in the listing (as string)',
				},
				marketplaceAddress: {
					type: 'string',
					description: 'Marketplace fee address',
				},
				marketplaceRate: {
					type: 'number',
					description: 'Marketplace fee rate (0-1)',
				},
			},
			required: ['tokenId', 'outpoint', 'amount'],
		},
	},
	async execute(ctx, input) {
		try {
			const {
				tokenId,
				outpoint,
				amount: rawAmount,
				marketplaceAddress,
				marketplaceRate,
			} = input
			const tokenAmount =
				typeof rawAmount === 'string' ? BigInt(rawAmount) : rawAmount

			if (!ctx.services) {
				return { error: 'services-required-for-purchase' }
			}

			const { txid, vout } = parseOutpoint(outpoint)

			try {
				await ctx.services.bsv21.validateOutput(tokenId, outpoint)
			} catch (e) {
				console.error('[purchaseBsv21] overlay validation error:', e)
				return { error: 'listing-not-found-in-overlay' }
			}

			const tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)

			const beef = await ctx.services.getBeefForTxid(txid)
			const listingBeefTx = beef.findTxid(txid)
			if (!listingBeefTx?.tx) {
				return { error: 'listing-transaction-not-found' }
			}

			const listingOutput = listingBeefTx.tx.outputs[vout]
			if (!listingOutput) {
				return { error: 'listing-output-not-found' }
			}

			const ordLockData = OrdLock.decode(listingOutput.lockingScript)
			if (!ordLockData) {
				return { error: 'not-an-ordlock-listing' }
			}

			const bsv21KeyID = `${tokenId}-${outpoint}`
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: BSV21_PROTOCOL,
				keyID: bsv21KeyID,
				counterparty: 'self',
				forSelf: true,
			})
			const ourTokenAddress = PublicKey.fromString(publicKey).toAddress()

			const outputs: Array<{
				lockingScript: string
				satoshis: number
				outputDescription: string
				basket?: string
				tags?: string[]
				customInstructions?: string
			}> = []

			const p2pkh = new P2PKH()
			const buyerLockingScript = p2pkh.lock(ourTokenAddress)
			const transferScript = BSV21.transfer(tokenId, tokenAmount).lock(
				buyerLockingScript,
			)
			outputs.push({
				lockingScript: transferScript.toHex(),
				satoshis: 1,
				outputDescription: 'Purchased tokens',
				basket: BSV21_BASKET,
				tags: [
					`bsv21:${tokenId}`,
					`amt:${tokenAmount}`,
					`dec:${tokenDetails.token.dec ?? 0}`,
					...(tokenDetails.token.sym ? [`sym:${tokenDetails.token.sym}`] : []),
					...(tokenDetails.token.icon
						? [`icon:${tokenDetails.token.icon}`]
						: []),
				],
				customInstructions: JSON.stringify({
					protocolID: BSV21_PROTOCOL,
					keyID: bsv21KeyID,
					...(tokenDetails.token.sym && {
						sym: tokenDetails.token.sym,
					}),
				}),
			})

			const payoutReader = new Utils.Reader(ordLockData.payout)
			const payoutSatoshis = payoutReader.readUInt64LEBn().toNumber()
			const payoutScriptLen = payoutReader.readVarIntNum()
			const payoutScriptBin = payoutReader.read(payoutScriptLen)
			const payoutLockingScript = LockingScript.fromBinary(payoutScriptBin)

			outputs.push({
				lockingScript: payoutLockingScript.toHex(),
				satoshis: payoutSatoshis,
				outputDescription: 'Payment to seller',
				tags: [],
			})

			if (marketplaceAddress && marketplaceRate && marketplaceRate > 0) {
				const marketFee = Math.ceil(payoutSatoshis * marketplaceRate)
				if (marketFee > 0) {
					outputs.push({
						lockingScript: p2pkh.lock(marketplaceAddress).toHex(),
						satoshis: marketFee,
						outputDescription: 'Marketplace fee',
						tags: [],
					})
				}
			}

			// Fee output to overlay fund address
			if (tokenDetails.status.is_active) {
				outputs.push({
					lockingScript: p2pkh.lock(tokenDetails.status.fee_address).toHex(),
					satoshis: tokenDetails.status.fee_per_output,
					outputDescription: 'Overlay processing fee',
					tags: [],
				})
			}

			const beefBinary = beef.toBinary()

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Purchase ${tokenAmount} tokens for ${payoutSatoshis} sats`,
					labels: [`bsv21:${tokenId}`],
					inputBEEF: beefBinary,
					inputs: [
						{
							outpoint,
							inputDescription: 'Listed token',
							unlockingScriptLength: 1402,
						},
					],
					outputs,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				beefBinary as number[],
				async (tx) => {
					const unlockingScript = await buildPurchaseUnlockingScript(
						tx,
						0,
						listingOutput.satoshis ?? 1,
						listingOutput.lockingScript,
					)
					return { 0: { unlockingScript: unlockingScript.toHex() } }
				},
			)

			// Submit to overlay service for indexing
			if (result.tx && ctx.services) {
				try {
					const overlayResult = await ctx.services.overlay.submitBsv21(
						result.tx,
						tokenId,
					)
					console.log(
						'[purchaseBsv21] Overlay submission result:',
						overlayResult,
					)
				} catch (overlayError) {
					console.warn(
						'[purchaseBsv21] Overlay submission failed:',
						overlayError,
					)
				}
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'purchaseBsv21',
					input: { tokenId, outpoint, amount: tokenAmount.toString() },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: BSV21_PROTOCOL,
							keyID: bsv21KeyID,
							basket: BSV21_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[purchaseBsv21]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'purchaseBsv21',
					input: {
						tokenId: input.tokenId,
						outpoint: input.outpoint,
						amount: input.amount?.toString(),
					},
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/** Miner fee rate used for manual deploy tx fee calculation. */
const DEPLOY_FEE_PER_KB = 100

/**
 * Estimate the byte size of the manually-built deploy tx (1 input, 1 output, no
 * change). Conservative — sized for a typical signed P2PKH unlocking script.
 */
function estimateDeployTxSize(deployScriptBytes: number): number {
	const overhead = 10 // version(4) + locktime(4) + inCount(1) + outCount(1)
	const input = 148 // P2PKH spend: txid(32)+vout(4)+scriptLen(1)+script(~107)+seq(4)
	const scriptLenVarint =
		deployScriptBytes < 0xfd
			? 1
			: deployScriptBytes < 0x10000
				? 3
				: 5
	const output = 8 + scriptLenVarint + deployScriptBytes
	return overhead + input + output
}

/**
 * Shared deploy flow:
 *   1. createAction a funding intermediate (wallet broadcasts via signAndProcess).
 *   2. Manually build + sign the deploy tx that spends the funding output.
 *   3. Synchronously broadcast the deploy via services.postBeef and require a
 *      success/processing arcade status before continuing. internalize alone
 *      only QUEUES a tx for later background broadcast — silent drops there
 *      have left tokens in a half-deployed state.
 *   4. internalizeAction adopts the deploy into the wallet basket so the auth
 *      UTXO becomes spendable.
 *
 * Used by both deployBsv21Mint and deployBsv21Auth — they only differ in the
 * deploy script (BSV21.deployMint vs BSV21.deployAuth) and target basket.
 */
async function executeBsv21Deploy(args: {
	ctx: OneSatContext
	symbol: string
	deployScript: LockingScript
	/** customInstructions to record on the deploy output. Pass through from
	 *  resolveDestination so wallet-derived destinations carry the keyID for
	 *  later spends; literal scripts/addresses pass undefined. */
	destinationCustomInstructions?: {
		protocolID: unknown
		keyID: string
		counterparty?: import('@bsv/sdk').WalletCounterparty
	}
	basket: string
	buildTags: (tokenId: string) => string[]
	description: string
	outputDescription: string
}): Promise<{ txid?: string; tx?: number[]; tokenId?: string; error?: string }> {
	const { ctx, symbol, deployScript, basket } = args

	const deployScriptBin = deployScript.toBinary()
	const txSize = estimateDeployTxSize(deployScriptBin.length)
	const fee = Math.ceil((txSize * DEPLOY_FEE_PER_KB) / 1000)
	// 1 sat for the deploy output + computed fee + small buffer for unlocking
	// script size variance (low-S signatures can be a byte shorter, etc.)
	const fundingValue = 1 + fee + 5

	const fundingKeyID = `bsv21-deploy-fund-${symbol}-${Date.now()}`
	const { publicKey: fundingPubKey } = await ctx.wallet.getPublicKey({
		protocolID: BSV21_PROTOCOL,
		keyID: fundingKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const fundingAddress = PublicKey.fromString(fundingPubKey).toAddress()
	const fundingScript = new P2PKH().lock(fundingAddress)

	const fundingResult = await ctx.wallet.createAction({
		description: `${args.description} (funding)`,
		outputs: [
			{
				lockingScript: fundingScript.toHex(),
				satoshis: fundingValue,
				outputDescription: 'Deploy funding intermediate',
				basket: BSV21_DEPLOY_FUNDING_BASKET,
				customInstructions: JSON.stringify({
					protocolID: BSV21_PROTOCOL,
					keyID: fundingKeyID,
				}),
			},
		],
		options: { randomizeOutputs: false },
	})

	if (!fundingResult.txid || !fundingResult.tx) {
		return { error: 'funding-failed' }
	}

	const fundingBeef = Beef.fromBinary(Array.from(fundingResult.tx))
	const fundingTx = fundingBeef.findAtomicTransaction(fundingResult.txid)
	if (!fundingTx) {
		return { error: 'funding-tx-not-in-beef' }
	}

	const deployTx = new Transaction()
	deployTx.addInput({
		sourceTransaction: fundingTx,
		// Setting sourceTXID is required so BeefTx.updateInputTxids picks up
		// the dependency. Without it, the deploy's inputTxids is empty and
		// Beef.sortTxs orders the deploy before its ancestors, which then get
		// trimmed by toBinaryAtomic.
		sourceTXID: fundingResult.txid,
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	deployTx.addOutput({
		lockingScript: deployScript,
		satoshis: 1,
	})

	const sigResult = await signP2PKHInput(
		ctx,
		deployTx,
		0,
		BSV21_PROTOCOL,
		fundingKeyID,
	)
	if (typeof sigResult !== 'string') {
		return { error: sigResult.error }
	}
	deployTx.inputs[0].unlockingScript = UnlockingScript.fromHex(sigResult)

	const deployTxid = deployTx.id('hex')
	const tokenId = `${deployTxid}_0`

	fundingBeef.mergeTransaction(deployTx)
	const deployBeefBin = fundingBeef.toBinaryAtomic(deployTxid)

	// Synchronous broadcast — internalize alone queues for background
	// broadcast and has been observed to silently drop the deploy tx,
	// stranding the funding output and leaving the wallet with a
	// "deployed" record for a tx that never reached the network.
	if (!ctx.services) {
		return { error: 'broadcast-services-unavailable' }
	}
	const broadcastResults = await ctx.services.postBeef(fundingBeef, [
		deployTxid,
	])
	const broadcastFailure = broadcastResults.find(
		(r) => r.status !== 'success',
	)
	if (broadcastFailure) {
		const reason =
			broadcastFailure.error?.message ??
			broadcastFailure.error?.code ??
			'broadcast-failed'
		return { error: `deploy-broadcast-failed: ${reason}` }
	}

	const customInstructions = args.destinationCustomInstructions
		? JSON.stringify({
				protocolID: args.destinationCustomInstructions.protocolID,
				keyID: args.destinationCustomInstructions.keyID,
				...(args.destinationCustomInstructions.counterparty !== undefined && {
					counterparty: args.destinationCustomInstructions.counterparty,
				}),
				sym: symbol,
			})
		: undefined

	await ctx.wallet.internalizeAction({
		tx: deployBeefBin,
		outputs: [
			{
				outputIndex: 0,
				protocol: 'basket insertion',
				insertionRemittance: {
					basket,
					tags: args.buildTags(tokenId),
					customInstructions,
				},
			},
		],
		description: args.description,
		labels: ['bsv21:deploy'],
	})

	return {
		txid: deployTxid,
		tx: deployBeefBin,
		tokenId,
	}
}

/**
 * Deploy a new BSV21 token with a fixed supply (deploy+mint).
 *
 * The entire supply is minted in this transaction and sent to the destination.
 * No further minting is possible — total supply is locked at deploy time.
 */
export const deployBsv21Mint: Action<
	DeployBsv21MintInput,
	DeployBsv21Response
> = {
	meta: {
		name: 'deployBsv21Mint',
		description: 'Deploy a new BSV21 token with fixed supply (deploy+mint)',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'Token symbol/ticker' },
				amount: {
					type: 'string',
					description: 'Total fixed supply (as string for bigint)',
				},
				decimals: {
					type: 'integer',
					description: 'Decimal places (0-18, default 0)',
				},
				icon: { type: 'string', description: 'Icon URL or data URI' },
				destination: {
					type: 'object',
					description:
						'Recipient destination. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self.',
				},
			},
			required: ['symbol', 'amount'],
		},
	},
	async execute(ctx, input) {
		try {
			const { symbol, amount: rawAmount, decimals = 0, icon, destination } =
				input

			const amount =
				typeof rawAmount === 'string' ? BigInt(rawAmount) : rawAmount
			if (amount <= 0n) {
				return { error: 'amount-must-be-positive' }
			}

			const resolved = await resolveDestination(ctx, destination, {
				protocolID: BSV21_PROTOCOL,
				keyIDPrefix: `bsv21-deploy-${symbol}`,
			})

			const deployScript = BSV21.deployMint(
				symbol,
				amount,
				decimals,
				icon,
			).lock(resolved.lockingScript)

			const result = await executeBsv21Deploy({
				ctx,
				symbol,
				deployScript,
				destinationCustomInstructions: resolved.customInstructions,
				basket: BSV21_BASKET,
				description: `Deploy ${symbol} (${amount} fixed supply)`,
				outputDescription: `Deploy ${symbol}`,
				buildTags: (tokenId) => {
					const tags = [
						`bsv21:${tokenId}`,
						`amt:${amount}`,
						`dec:${decimals}`,
						`sym:${symbol}`,
					]
					if (icon) tags.push(`icon:${icon}`)
					return tags
				},
			})

			if (result.error) return { error: result.error }

			if (result.tx && ctx.services) {
				try {
					await ctx.services.overlay.submitBsv21Discovery(result.tx)
				} catch (overlayError) {
					console.warn(
						'[deployBsv21Mint] Overlay submission failed:',
						overlayError,
					)
				}
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'deployBsv21Mint',
					input: {
						symbol,
						amount: amount.toString(),
						decimals,
						icon,
						destination,
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: BSV21_PROTOCOL,
							keyID: resolved.customInstructions?.keyID,
							basket: BSV21_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[deployBsv21Mint]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'deployBsv21Mint',
					input: { symbol: input.symbol },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Deploy a new BSV21 token with mintable supply (deploy+auth).
 *
 * Emits a single `deploy+auth` output that doubles as the genesis auth UTXO.
 * Initial supply is zero — the auth holder must spend this output via a
 * separate mint transaction to create supply. Authority can be split,
 * combined, transferred, or burned via subsequent auth operations.
 */
export const deployBsv21Auth: Action<
	DeployBsv21AuthInput,
	DeployBsv21AuthResponse
> = {
	meta: {
		name: 'deployBsv21Auth',
		description:
			'Deploy a new BSV21 token with mintable supply via auth UTXOs (deploy+auth)',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'Token symbol/ticker' },
				decimals: {
					type: 'integer',
					description: 'Decimal places (0-18, default 0)',
				},
				icon: { type: 'string', description: 'Icon URL or data URI' },
				destination: {
					type: 'object',
					description:
						'Auth-holder destination. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self.',
				},
			},
			required: ['symbol'],
		},
	},
	async execute(ctx, input) {
		try {
			const { symbol, decimals = 0, icon, destination } = input

			const resolved = await resolveDestination(ctx, destination, {
				protocolID: BSV21_PROTOCOL,
				keyIDPrefix: `bsv21-auth-${symbol}`,
			})

			const deployScript = BSV21.deployAuth(symbol, decimals, icon).lock(
				resolved.lockingScript,
			)

			const result = await executeBsv21Deploy({
				ctx,
				symbol,
				deployScript,
				destinationCustomInstructions: resolved.customInstructions,
				basket: BSV21_AUTH_BASKET,
				description: `Deploy ${symbol} (mintable)`,
				outputDescription: `Deploy ${symbol} auth`,
				buildTags: (tokenId) => {
					const tags = [`bsv21:${tokenId}`, `dec:${decimals}`, `sym:${symbol}`]
					if (icon) tags.push(`icon:${icon}`)
					return tags
				},
			})

			if (result.error) return { error: result.error }

			if (result.tx && ctx.services) {
				try {
					await ctx.services.overlay.submitBsv21Discovery(result.tx)
				} catch (overlayError) {
					console.warn(
						'[deployBsv21Auth] Overlay submission failed:',
						overlayError,
					)
				}
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'deployBsv21Auth',
					input: { symbol, decimals, icon, destination },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: BSV21_PROTOCOL,
							keyID: resolved.customInstructions?.keyID,
							basket: BSV21_AUTH_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			// For deploy+auth, the deploy output IS the first auth UTXO.
			return {
				...result,
				authOutpoint: result.tokenId,
			}
		} catch (error) {
			console.error('[deployBsv21Auth]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'deployBsv21Auth',
					input: { symbol: input.symbol },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Spend an auth UTXO to mint new supply, transfer authority, or burn it.
 *
 * Both `mint` and `auth` are optional, but at least one must be present.
 * Omitting `auth` ends minting permanently and requires `endMinting: true`
 * as explicit confirmation.
 */
export const mintBsv21: Action<MintBsv21Input, MintBsv21Response> = {
	meta: {
		name: 'mintBsv21',
		description:
			'Spend an auth UTXO to mint new supply and/or re-issue authority',
		category: 'tokens',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: { type: 'string', description: 'Token ID (txid_vout format)' },
				mint: {
					type: 'object',
					description: 'Optional mint output: { amount, destination }',
				},
				auth: {
					type: 'object',
					description: 'Optional continuing auth output: { destination }',
				},
				endMinting: {
					type: 'boolean',
					description:
						'Required when auth is omitted — explicit confirmation that minting ends.',
				},
			},
			required: ['tokenId'],
		},
	},
	async execute(ctx, input) {
		try {
			const { tokenId, mint, auth, endMinting } = input

			if (!mint && !auth) {
				return { error: 'must-provide-mint-or-auth' }
			}
			if (!auth && !endMinting) {
				return { error: 'omitting-auth-requires-endMinting-true' }
			}

			const mintAmount =
				mint?.amount !== undefined
					? typeof mint.amount === 'string'
						? BigInt(mint.amount)
						: mint.amount
					: 0n
			if (mint && mintAmount <= 0n) {
				return { error: 'mint-amount-must-be-positive' }
			}

			if (!ctx.services) {
				return { error: 'services-required' }
			}

			// Look up the token's metadata for tag enrichment.
			const tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)

			// Find a spendable auth UTXO for this token.
			const authList = await ctx.wallet.listOutputs({
				basket: BSV21_AUTH_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const authUtxo = authList.outputs.find((o) =>
				o.tags?.includes(`bsv21:${tokenId}`),
			)
			if (!authUtxo) {
				return { error: 'no-auth-utxo-for-token' }
			}
			if (!authUtxo.customInstructions) {
				return { error: 'auth-utxo-missing-custom-instructions' }
			}
			const authCI = JSON.parse(authUtxo.customInstructions) as {
				protocolID: [0 | 1 | 2, string]
				keyID: string
				counterparty?: import('@bsv/sdk').WalletCounterparty
			}

			// Build outputs.
			const outputs: Array<{
				lockingScript: string
				satoshis: number
				outputDescription: string
				basket?: string
				tags?: string[]
				customInstructions?: string
			}> = []

			let authOutputIndex: number | undefined

			if (mint) {
				const mintResolved = await resolveDestination(ctx, mint.destination, {
					protocolID: BSV21_PROTOCOL,
					keyIDPrefix: `bsv21-mint-${tokenId}`,
				})
				const mintScript = BSV21.mint(tokenId, mintAmount).lock(
					mintResolved.lockingScript,
				)
				const mintTags = [
					`bsv21:${tokenId}`,
					`amt:${mintAmount}`,
					`dec:${tokenDetails.token.dec ?? 0}`,
					...(tokenDetails.token.sym
						? [`sym:${tokenDetails.token.sym}`]
						: []),
					...(tokenDetails.token.icon
						? [`icon:${tokenDetails.token.icon}`]
						: []),
				]
				const mintCI = mintResolved.customInstructions
					? JSON.stringify({
							protocolID: mintResolved.customInstructions.protocolID,
							keyID: mintResolved.customInstructions.keyID,
							...(mintResolved.customInstructions.counterparty !== undefined && {
								counterparty: mintResolved.customInstructions.counterparty,
							}),
							...(tokenDetails.token.sym && { sym: tokenDetails.token.sym }),
						})
					: undefined
				outputs.push({
					lockingScript: mintScript.toHex(),
					satoshis: 1,
					outputDescription: `Mint ${mintAmount} tokens`,
					basket: BSV21_BASKET,
					tags: mintTags,
					customInstructions: mintCI,
				})
			}

			if (auth) {
				const authResolved = await resolveDestination(ctx, auth.destination, {
					protocolID: BSV21_PROTOCOL,
					keyIDPrefix: `bsv21-auth-${tokenId}`,
				})
				const authScript = BSV21.auth(tokenId).lock(authResolved.lockingScript)
				const authTags = [
					`bsv21:${tokenId}`,
					`dec:${tokenDetails.token.dec ?? 0}`,
					...(tokenDetails.token.sym
						? [`sym:${tokenDetails.token.sym}`]
						: []),
					...(tokenDetails.token.icon
						? [`icon:${tokenDetails.token.icon}`]
						: []),
				]
				const authCustomInstructions = authResolved.customInstructions
					? JSON.stringify({
							protocolID: authResolved.customInstructions.protocolID,
							keyID: authResolved.customInstructions.keyID,
							...(authResolved.customInstructions.counterparty !== undefined && {
								counterparty: authResolved.customInstructions.counterparty,
							}),
							...(tokenDetails.token.sym && { sym: tokenDetails.token.sym }),
						})
					: undefined
				authOutputIndex = outputs.length
				outputs.push({
					lockingScript: authScript.toHex(),
					satoshis: 1,
					outputDescription: 'Continuing mint authority',
					basket: BSV21_AUTH_BASKET,
					tags: authTags,
					customInstructions: authCustomInstructions,
				})
			}

			// Optional fee output to overlay fund address (per token output).
			const tokenOutputCount =
				(mint ? 1 : 0) + (auth ? 1 : 0)
			if (
				tokenDetails.status.is_active &&
				tokenDetails.status.fee_per_output > 0
			) {
				outputs.push({
					lockingScript: new P2PKH()
						.lock(tokenDetails.status.fee_address)
						.toHex(),
					satoshis: tokenDetails.status.fee_per_output * tokenOutputCount,
					outputDescription: 'Overlay processing fee',
					tags: [],
				})
			}

			let inputBEEF = authList.BEEF
			if (!inputBEEF || (inputBEEF as number[]).length === 0) {
				const beef = await ctx.services.getBeefForTxid(
					authUtxo.outpoint.split('.')[0],
				)
				inputBEEF = beef.toBinary()
			}

			const symbol = tokenDetails.token.sym || tokenId.slice(0, 8)
			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: mint
						? `Mint ${mintAmount} ${symbol}`
						: `Re-issue ${symbol} authority`,
					labels: [`bsv21:${tokenId}`],
					inputBEEF,
					inputs: [
						{
							outpoint: authUtxo.outpoint,
							inputDescription: 'Mint authority',
							unlockingScriptLength: 108,
						},
					],
					outputs,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				inputBEEF as number[],
				async (tx) => {
					const unlocking = await signP2PKHInput(
						ctx,
						tx,
						0,
						authCI.protocolID,
						authCI.keyID,
						authCI.counterparty,
					)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)

			if (result.error) return { error: result.error }

			// Submit to per-token overlay topic.
			if (result.tx && ctx.services) {
				try {
					await ctx.services.overlay.submitBsv21(result.tx, tokenId)
				} catch (overlayError) {
					console.warn(
						'[mintBsv21] Overlay submission failed:',
						overlayError,
					)
				}
			}

			const authOutpoint =
				result.txid && authOutputIndex !== undefined
					? `${result.txid}_${authOutputIndex}`
					: undefined

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'mintBsv21',
					input: { tokenId, mint, auth, endMinting },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
				authOutpoint,
			}
		} catch (error) {
			console.error('[mintBsv21]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'mintBsv21',
					input: { tokenId: input.tokenId },
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

/** All token actions for registry */
export const tokensActions = [
	listTokens,
	getBsv21Balances,
	sendBsv21,
	purchaseBsv21,
	deployBsv21Mint,
	deployBsv21Auth,
	mintBsv21,
]
