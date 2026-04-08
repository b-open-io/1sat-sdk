/**
 * Tokens Module
 *
 * Actions for managing BSV21 tokens.
 */

import { BSV21, OrdLock } from '@1sat/templates'
import { parseOutpoint } from '@1sat/utils'
import {
	BigNumber,
	LockingScript,
	OP,
	P2PKH,
	PublicKey,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import { BSV21_BASKET, BSV21_PROTOCOL } from '../constants'
import type {
	Action,
	ActionLogEntry,
	ActionOptions,
	OneSatContext,
} from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

type PubKeyHex = string

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

export interface SendBsv21Request extends ActionOptions {
	/** Token ID (txid_vout format) */
	tokenId: string
	/** Amount to send (as bigint or string) */
	amount: bigint | string
	/** Recipient's identity public key (preferred) */
	counterparty?: PubKeyHex
	/** Legacy: raw P2PKH address */
	address?: string
	/** Paymail address */
	paymail?: string
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
			const symTag = o.tags?.find((t) => t.startsWith('sym:'))?.slice(4)
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
 * Send BSV21 tokens to an address.
 */
export const sendBsv21: Action<SendBsv21Request, TokenOperationResponse> = {
	meta: {
		name: 'sendBsv21',
		description: 'Send BSV21 tokens to a counterparty, address, or paymail',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: { type: 'string', description: 'Token ID (txid_vout format)' },
				amount: {
					type: 'string',
					description: 'Amount to send (as string for bigint)',
				},
				counterparty: {
					type: 'string',
					description: 'Recipient identity public key (hex)',
				},
				address: { type: 'string', description: 'Recipient P2PKH address' },
				paymail: { type: 'string', description: 'Recipient paymail address' },
			},
			required: ['tokenId', 'amount'],
		},
	},
	async execute(ctx, input) {
		try {
			const {
				tokenId,
				counterparty,
				address,
				paymail,
				amount: rawAmount,
			} = input
			const amount =
				typeof rawAmount === 'string' ? BigInt(rawAmount) : rawAmount

			if (!counterparty && !address && !paymail) {
				return { error: 'must-provide-counterparty-address-or-paymail' }
			}

			if (amount <= 0n) {
				return { error: 'amount-must-be-positive' }
			}

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
				if (totalIn >= amount) break

				const amtTag = utxo.tags?.find((t) => t.startsWith('amt:'))
				if (!amtTag) continue
				const utxoAmount = BigInt(amtTag.slice(4))

				// Skip UTXOs not confirmed in the overlay
				if (overlayValidated && !validOutpoints.has(utxo.outpoint)) {
					continue
				}

				selected.push(utxo)
				totalIn += utxoAmount
			}

			if (totalIn < amount) {
				return { error: 'insufficient-tokens' }
			}

			let recipientAddress: string
			let recipientKeyID: string | undefined
			if (counterparty) {
				recipientKeyID = `${tokenId}-${Date.now()}`
				const { publicKey } = await ctx.wallet.getPublicKey({
					protocolID: BSV21_PROTOCOL,
					keyID: recipientKeyID,
					counterparty,
					forSelf: false,
				})
				recipientAddress = PublicKey.fromString(publicKey).toAddress()
			} else if (paymail) {
				return { error: 'paymail-not-yet-implemented' }
			} else if (address) {
				recipientAddress = address
			} else {
				return { error: 'must-provide-counterparty-or-address' }
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
			const destinationLockingScript = p2pkh.lock(recipientAddress)
			const transferScript = BSV21.transfer(tokenId, amount).lock(
				destinationLockingScript,
			)
			outputs.push({
				lockingScript: transferScript.toHex(),
				satoshis: 1,
				outputDescription: `Send ${amount} tokens`,
			})

			const change = totalIn - amount
			let tokenOutputCount = 1
			let changeKeyID: string | undefined
			if (change > 0n) {
				tokenOutputCount = 2
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
					description: `Send ${amount} ${symbol}`,
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
						const { protocolID, keyID } = JSON.parse(utxo.customInstructions)
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							i,
							protocolID,
							keyID,
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
				const logOutputs: ActionLogEntry['outputs'] = [
					{
						index: 0,
						protocolID: BSV21_PROTOCOL,
						keyID: recipientKeyID,
						basket: BSV21_BASKET,
						satoshis: 1,
					},
				]
				if (change > 0n) {
					logOutputs.push({
						index: 1,
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
						amount: amount.toString(),
						counterparty,
						address,
						paymail,
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
					input: { tokenId: input.tokenId, amount: input.amount?.toString() },
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

// ============================================================================
// Module exports
// ============================================================================

/** All token actions for registry */
export const tokensActions = [
	listTokens,
	getBsv21Balances,
	sendBsv21,
	purchaseBsv21,
]
