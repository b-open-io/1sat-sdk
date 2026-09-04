/**
 * Tokens Module
 *
 * Actions for managing BSV21 tokens.
 */

import { BSV21, OrdLock, P2MS } from '@1sat/templates'
import {
	BSV21_DEPLOY_TAG,
	type Destination,
	buildInputAssetLabel,
	buildTokenLabel,
	readAssetIdTag,
} from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import {
	BigNumber,
	type CreateActionArgs,
	LockingScript,
	OP,
	P2PKH,
	PublicKey,
	Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply'
import { BSV21_AUTH_TAG, BSV21_BASKET, P1SAT_PROTOCOL } from '../constants'
import { appendSigmaPlaceholder } from '../signing/sigma'
import type {
	Action,
	ActionLogEntry,
	ActionOptions,
	OneSatContext,
} from '../types'
import { appendMapSuffix } from '../utils/appendMapSuffix'
import {
	bsv21FieldsFromOutput,
	bsv21FilterTags,
	buildBsv21CustomInstructions,
	normalizeBsv21TokenId,
} from '../utils/bsv21Remittance'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { getDisplayValue } from '../utils/displayValue'
import { resolveDestination } from '../utils/resolveDestination'
import { signP2PKHInput } from '../utils/signP2PKH'

/** tokenId: CI `id` → tag `bsv21:<id>` → deploy outpoint. */
function tokenIdFromOutput(o: WalletOutput): string | undefined {
	return bsv21FieldsFromOutput({
		tags: o.tags,
		customInstructions: o.customInstructions,
		outpoint: o.outpoint,
	}).tokenId
}

function matchesTokenId(o: WalletOutput, tokenId: string): boolean {
	const id = tokenIdFromOutput(o)
	if (!id) return false
	return normalizeBsv21TokenId(id) === normalizeBsv21TokenId(tokenId)
}

function amtFromOutput(o: WalletOutput): string | undefined {
	return bsv21FieldsFromOutput({
		tags: o.tags,
		customInstructions: o.customInstructions,
		outpoint: o.outpoint,
	}).amt
}

/** Value tips only — skip pure auth rows in balances. */
function isBalanceableBsv21Output(o: WalletOutput): boolean {
	const f = bsv21FieldsFromOutput({
		tags: o.tags,
		customInstructions: o.customInstructions,
		outpoint: o.outpoint,
	})
	// Auth-only UTXOs (not deploy+mint value)
	if (f.isAuth && !f.isDeploy) return false
	const op = parseBsv21Op(o)
	if (op === 'auth' || op === 'deploy+auth') return false
	return !!f.amt && f.amt !== '0'
}

function parseBsv21Op(o: WalletOutput): string | undefined {
	const ci = o.customInstructions
	if (!ci) return undefined
	try {
		const op = (JSON.parse(ci) as { op?: string }).op
		return typeof op === 'string' ? op : undefined
	} catch {
		return undefined
	}
}

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
	/**
	 * When true (default): require overlay token active + validate each
	 * candidate input; only spend overlay-approved UTXOs; hard-fail if the
	 * overlay call fails or remaining tips cannot cover the send.
	 * When false: select from wallet tips only (no action-level overlay
	 * gate). Module prompt verify is independent of this flag.
	 */
	validateOverlay?: boolean
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
	/** Optional MAP metadata appended outside the BSV21 inscription payload. */
	map?: Record<string, string>
	/** Add transaction-bound SIGMA authorship. Defaults to false. */
	signWithBAP?: boolean
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
	/** Optional MAP metadata appended outside the BSV21 inscription payload. */
	map?: Record<string, string>
	/** Add transaction-bound SIGMA authorship. Defaults to false. */
	signWithBAP?: boolean
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
	 * Optional continuing/transferred auth output. Omit to emit a continuing
	 * auth back to self (default). Pass an explicit `destination` to transfer
	 * mint authority to another counterparty/address.
	 */
	auth?: { destination: Destination }
	/**
	 * Permanently end minting — no continuing auth output is emitted. May be
	 * used alone to terminate authority without a final mint, or with `mint` to
	 * mint a final supply. Cannot be combined with `auth`.
	 */
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

/** Input for listBsv21 action */
export interface ListTokensInput {
	/** Max number of tokens to return */
	limit?: number
}

/**
 * List BSV21 token outputs from the wallet.
 */
export const listBsv21: Action<ListTokensInput, WalletOutput[]> = {
	meta: {
		name: 'listBsv21',
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
			if (!isBalanceableBsv21Output(o)) continue
			const fields = bsv21FieldsFromOutput({
				tags: o.tags,
				customInstructions: o.customInstructions,
				outpoint: o.outpoint,
			})
			const tokenId = fields.tokenId
			const amtStr = fields.amt
			if (!tokenId || !amtStr) continue

			const amt = BigInt(amtStr)
			const dec = Number.parseInt(fields.dec || '0', 10)
			const symTag = fields.sym ?? getDisplayValue(o, 'sym', 'sym')
			const rawIcon = fields.icon
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
				validateOverlay: {
					type: 'boolean',
					description:
						'Default true. When true, require active token + per-input overlay unspent check (hard fail). When false, spend wallet tips only.',
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
			const validateOverlay = input.validateOverlay !== false

			type TokenDetails = Awaited<
				ReturnType<
					NonNullable<
						NonNullable<typeof ctx.services>['bsv21']
					>['getTokenDetails']
				>
			>
			let tokenDetails: TokenDetails | undefined

			if (validateOverlay) {
				if (!ctx.services?.bsv21) {
					return { error: 'services-required' }
				}
				try {
					tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)
				} catch (e) {
					console.error('[sendBsv21] getTokenDetails failed:', e)
					return { error: 'token-not-found' }
				}
				if (!tokenDetails.status.is_active) {
					return { error: 'token-not-active' }
				}
			} else if (ctx.services?.bsv21) {
				// Best-effort meta/fees only — never gate the send.
				try {
					tokenDetails = await ctx.services.bsv21.getTokenDetails(tokenId)
				} catch {
					tokenDetails = undefined
				}
			}

			const listResult = await ctx.wallet.listOutputs({
				basket: BSV21_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 10000,
			})

			const tokenUtxos = listResult.outputs.filter((o) =>
				matchesTokenId(o, tokenId),
			)

			// When validateOverlay: only spend tips the overlay still lists unspent.
			const validOutpoints = new Set<string>()
			if (validateOverlay) {
				const candidateOutpoints = tokenUtxos.map((o) => o.outpoint)
				try {
					const validated = await ctx.services!.bsv21!.validateOutputs(
						tokenId,
						candidateOutpoints,
						{ unspent: true },
					)
					for (const v of validated) {
						validOutpoints.add(v.outpoint.replace('_', '.'))
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

				const amtStr = amtFromOutput(utxo)
				if (!amtStr) continue
				const utxoAmount = BigInt(amtStr)

				if (validateOverlay && !validOutpoints.has(utxo.outpoint)) {
					continue
				}

				selected.push(utxo)
				totalIn += utxoAmount
			}

			if (totalIn < totalAmount) {
				return {
					error: validateOverlay
						? 'insufficient-valid-tokens'
						: 'insufficient-tokens',
				}
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

			// Meta: overlay when present, else first selected tip CI.
			const fromTip = selected[0]
				? bsv21FieldsFromOutput({
						tags: selected[0].tags,
						customInstructions: selected[0].customInstructions,
						outpoint: selected[0].outpoint,
					})
				: {}
			const tokenTags = bsv21FilterTags({ tokenId })
			const tokenMeta = {
				id: tokenId,
				op: 'transfer' as const,
				sym: tokenDetails?.token.sym ?? fromTip.sym,
				dec: tokenDetails?.token.dec ?? fromTip.dec ?? 0,
				icon: tokenDetails?.token.icon ?? fromTip.icon,
			}
			for (const r of resolved) {
				const recipientResolved = await resolveDestination(ctx, r.destination, {
					protocolID: P1SAT_PROTOCOL,
					keyIDPrefix: tokenId,
				})
				recipientKeyIDs.push(recipientResolved.customInstructions?.keyID)

				const transferScript = BSV21.transfer(tokenId, r.amount).lock(
					recipientResolved.lockingScript,
				)
				// Self destinations stay in the BSV21 basket with filter tags + CI.
				const isSelf =
					r.destination.counterparty === 'self' ||
					recipientResolved.customInstructions?.counterparty === 'self'
				outputs.push({
					lockingScript: transferScript.toHex(),
					satoshis: 1,
					outputDescription: `Send ${r.amount} tokens`,
					...(isSelf && {
						basket: BSV21_BASKET,
						tags: tokenTags,
						// Only when the wallet actually derived the key. A literal
						// address or lockingScript destination has no derivation, and
						// inventing a keyID here would record a triple that was never
						// used to lock this output — leaving it unspendable from its
						// own record.
						...(recipientResolved.customInstructions?.keyID && {
							customInstructions: buildBsv21CustomInstructions({
								token: { ...tokenMeta, amt: String(r.amount) },
								protocolID: P1SAT_PROTOCOL,
								keyID: recipientResolved.customInstructions.keyID,
								counterparty: 'self',
							}),
						}),
					}),
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
					protocolID: P1SAT_PROTOCOL,
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
					tags: tokenTags,
					customInstructions: buildBsv21CustomInstructions({
						token: { ...tokenMeta, amt: String(change) },
						protocolID: P1SAT_PROTOCOL,
						keyID: changeKeyID,
						counterparty: 'self',
					}),
				})
			}

			// Fee out when we have fund params (required path always has details).
			const fee_address = tokenDetails?.status?.fee_address
			const fee_per_output = tokenDetails?.status?.fee_per_output
			if (
				typeof fee_address === 'string' &&
				fee_address &&
				typeof fee_per_output === 'number' &&
				fee_per_output > 0
			) {
				outputs.push({
					lockingScript: p2pkh.lock(fee_address).toHex(),
					satoshis: fee_per_output * tokenOutputCount,
					outputDescription: 'Overlay processing fee',
					tags: ['fee:overlay'],
				})
			}

			const symbol = tokenMeta.sym || tokenId.slice(0, 8)

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
			const inputLabels = selected
				.map((o) => readAssetIdTag(o.tags))
				.filter((id): id is string => Boolean(id))
				.map((id) => buildInputAssetLabel(BSV21_BASKET, id))
			const sendArgs = await prepareP1SatArgs(ctx, {
				description: `Send ${symbol} to ${resolved.length} recipient${resolved.length > 1 ? 's' : ''}`,
				labels: [buildTokenLabel(tokenId), ...inputLabels],
				inputBEEF,
				inputs: selected.map((o) => ({
					outpoint: o.outpoint,
					inputDescription: 'Token input',
					unlockingScriptLength: 108,
				})),
				outputs,
				options: { randomizeOutputs: false },
			})
			const spends = selected
				.map((o) => {
					const id = readAssetIdTag(o.tags)
					return id ? { basket: BSV21_BASKET, id } : null
				})
				.filter((t): t is { basket: string; id: string } => !!t)
			const result = await executeTrackedAction(
				ctx.wallet,
				sendArgs,
				input.fundingProvider,
				inputBEEF as number[],
				undefined,
				{
					spends,
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'bsv21',
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
					protocolID: P1SAT_PROTOCOL,
					keyID: recipientKeyIDs[i],
					basket: BSV21_BASKET,
					satoshis: 1,
				}))
				if (change > 0n) {
					logOutputs.push({
						index: resolved.length,
						protocolID: P1SAT_PROTOCOL,
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
export const buyBsv21: Action<PurchaseBsv21Request, TokenOperationResponse> = {
	meta: {
		name: 'buyBsv21',
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
				console.error('[buyBsv21] overlay validation error:', e)
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
				protocolID: P1SAT_PROTOCOL,
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
				tags: bsv21FilterTags({ tokenId }),
				customInstructions: buildBsv21CustomInstructions({
					token: {
						id: tokenId,
						amt: String(tokenAmount),
						op: 'transfer',
						sym: tokenDetails.token.sym,
						dec: tokenDetails.token.dec ?? 0,
						icon: tokenDetails.token.icon,
					},
					protocolID: P1SAT_PROTOCOL,
					keyID: bsv21KeyID,
					counterparty: 'self',
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
					tags: ['fee:overlay'],
				})
			}

			const beefBinary = beef.toBinary()

			const buyArgs = await prepareP1SatArgs(ctx, {
				description: `Purchase ${tokenAmount} tokens for ${payoutSatoshis} sats`,
				labels: [buildTokenLabel(tokenId)],
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
			})
			const result = await executeTrackedAction(
				ctx.wallet,
				buyArgs,
				input.fundingProvider,
				beefBinary as number[],
				undefined,
				{
					spends: [{ outpoint, scheme: 'bsv21' }],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'bsv21',
				},
			)

			// Submit to overlay service for indexing
			if (result.tx && ctx.services) {
				try {
					const overlayResult = await ctx.services.overlay.submitBsv21(
						result.tx,
						tokenId,
					)
					console.log('[buyBsv21] Overlay submission result:', overlayResult)
				} catch (overlayError) {
					console.warn('[buyBsv21] Overlay submission failed:', overlayError)
				}
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'buyBsv21',
					input: { tokenId, outpoint, amount: tokenAmount.toString() },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: bsv21KeyID,
							basket: BSV21_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[buyBsv21]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'buyBsv21',
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

/**
 * Deploy via createAction. Tags: `bsv21:deploy` (+ auth). No `bsv21:<tokenId>`
 * (id = this outpoint, known only after the tx). Balance/selection resolve id
 * from outpoint when that tag is present.
 */
async function executeBsv21Deploy(args: {
	ctx: OneSatContext
	symbol: string
	deployScript: Script
	destinationCustomInstructions?: {
		protocolID: unknown
		keyID: string
		counterparty?: import('@bsv/sdk').WalletCounterparty
	}
	basket: string
	/** Filter tags (`bsv21:deploy` / `bsv21:auth`). */
	buildTags: () => string[]
	/** Load-bearing CI fields (no `id` — readers use deploy outpoint). */
	token: {
		amt: string
		op: string
		dec?: string | number
		icon?: string
	}
	description: string
	outputDescription: string
	fundingProvider?: import('../funding').FundingProvider
	/** Route the output through the shared SIGMA placeholder/seal flow. */
	signWithBAP?: boolean
}): Promise<{
	txid?: string
	tx?: number[]
	tokenId?: string
	error?: string
}> {
	const { ctx, symbol, deployScript, basket } = args

	// Deploy filing: `bsv21:deploy` (+ optional auth). No `bsv21:<tokenId>`
	// (id = outpoint after mine). Never amt/sym/dec/icon tags.
	const tags = args
		.buildTags()
		.filter((t) => t === BSV21_DEPLOY_TAG || t === BSV21_AUTH_TAG)
	if (!tags.includes(BSV21_DEPLOY_TAG)) tags.push(BSV21_DEPLOY_TAG)

	const customInstructions = args.destinationCustomInstructions
		? buildBsv21CustomInstructions({
				token: {
					// No `id` — readers use deploy outpoint as token id.
					amt: args.token.amt,
					op: args.token.op,
					sym: symbol,
					dec: args.token.dec,
					icon: args.token.icon,
				},
				protocolID: args.destinationCustomInstructions.protocolID,
				keyID: args.destinationCustomInstructions.keyID,
				counterparty: args.destinationCustomInstructions.counterparty as
					| string
					| undefined,
			})
		: undefined

	const caArgs: CreateActionArgs = {
		description: args.description,
		outputs: [
			{
				lockingScript: deployScript.toHex(),
				satoshis: 1,
				outputDescription: args.outputDescription,
				basket,
				tags,
				customInstructions,
			},
		],
		options: { randomizeOutputs: false },
	}

	if (args.signWithBAP) {
		if (args.fundingProvider) {
			throw new Error(
				'sigma-incompatible-with-funding-provider: external funders cannot sign the wallet-owned SIGMA anchor input',
			)
		}
		caArgs.outputs![0].lockingScript = (
			await appendSigmaPlaceholder(ctx, deployScript)
		).toHex()
	}

	const prepared = await prepareP1SatArgs(ctx, caArgs)
	const result = await executeTrackedAction(
		ctx.wallet,
		prepared,
		args.fundingProvider,
	)

	if (!result.txid) {
		return { error: 'deploy-no-txid' }
	}

	return {
		txid: result.txid,
		tx: result.tx,
		tokenId: `${result.txid}_0`,
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
				map: {
					type: 'object',
					description: 'Optional MAP metadata for the deploy output',
				},
				signWithBAP: {
					type: 'boolean',
					description: 'Add transaction-bound SIGMA authorship',
					default: false,
				},
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
			const {
				symbol,
				amount: rawAmount,
				decimals = 0,
				icon,
				destination,
				map,
				signWithBAP = false,
			} = input

			const amount =
				typeof rawAmount === 'string' ? BigInt(rawAmount) : rawAmount
			if (amount <= 0n) {
				return { error: 'amount-must-be-positive' }
			}

			const resolved = await resolveDestination(ctx, destination, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: `bsv21-deploy-${symbol}`,
			})

			const deployScript = appendMapSuffix(
				new Script(
					BSV21.deployMint(symbol, amount, decimals, icon).lock(
						resolved.lockingScript,
					).chunks,
				),
				map,
			)

			const result = await executeBsv21Deploy({
				ctx,
				symbol,
				deployScript,
				destinationCustomInstructions: resolved.customInstructions,
				basket: BSV21_BASKET,
				description: `Deploy ${symbol} (${amount} fixed supply)`,
				outputDescription: `Deploy ${symbol}`,
				fundingProvider: input.fundingProvider,
				signWithBAP,
				token: {
					amt: String(amount),
					op: 'deploy+mint',
					dec: decimals,
					icon,
				},
				buildTags: () => [BSV21_DEPLOY_TAG],
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
						map,
						signWithBAP,
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
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
				map: {
					type: 'object',
					description: 'Optional MAP metadata for the deploy output',
				},
				signWithBAP: {
					type: 'boolean',
					description: 'Add transaction-bound SIGMA authorship',
					default: false,
				},
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
			const {
				symbol,
				decimals = 0,
				icon,
				destination,
				map,
				signWithBAP = false,
			} = input

			const resolved = await resolveDestination(ctx, destination, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: `bsv21-auth-${symbol}`,
			})

			const deployScript = appendMapSuffix(
				new Script(
					BSV21.deployAuth(symbol, decimals, icon).lock(resolved.lockingScript)
						.chunks,
				),
				map,
			)

			const result = await executeBsv21Deploy({
				ctx,
				symbol,
				deployScript,
				destinationCustomInstructions: resolved.customInstructions,
				basket: BSV21_BASKET,
				description: `Deploy ${symbol} (mintable)`,
				outputDescription: `Deploy ${symbol} auth`,
				fundingProvider: input.fundingProvider,
				signWithBAP,
				token: {
					amt: '0',
					op: 'deploy+auth',
					dec: decimals,
					icon,
				},
				buildTags: () => [BSV21_DEPLOY_TAG, BSV21_AUTH_TAG],
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
					input: { symbol, decimals, icon, destination, map, signWithBAP },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: resolved.customInstructions?.keyID,
							basket: BSV21_BASKET,
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
 * By default a continuing self auth output is emitted so minting can continue.
 * Pass `auth: { destination }` to transfer authority to another counterparty.
 * Pass `endMinting: true` to permanently end minting (no auth output emitted).
 */
export const mintBsv21: Action<MintBsv21Input, MintBsv21Response> = {
	meta: {
		name: 'mintBsv21',
		description:
			'Spend an auth UTXO to mint supply, re-issue authority, or permanently end minting',
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
						'Permanently end minting, alone or after a final mint; cannot be combined with auth.',
				},
			},
			required: ['tokenId'],
		},
	},
	async execute(ctx, input) {
		try {
			const { tokenId, mint, auth, endMinting } = input

			if (auth && endMinting) {
				return { error: 'auth-and-end-minting-are-mutually-exclusive' }
			}
			if (!mint && !auth && !endMinting) {
				return { error: 'must-provide-mint-or-auth' }
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
			if (!tokenDetails.status.is_active) {
				return { error: 'token-not-active' }
			}

			// Find a spendable auth UTXO for this token (same basket as balance).
			const authList = await ctx.wallet.listOutputs({
				basket: BSV21_BASKET,
				// A deploy+auth output cannot carry bsv21:<tokenId> when it is
				// created because its txid is not known yet. Load authority
				// candidates by the canonical auth tag, then resolve the token id
				// from CI/tags/deploy outpoint with matchesTokenId below.
				tags: [BSV21_AUTH_TAG],
				tagQueryMode: 'all',
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const authUtxo = authList.outputs.find((output) =>
				matchesTokenId(output, tokenId),
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
					protocolID: P1SAT_PROTOCOL,
					keyIDPrefix: `bsv21-mint-${tokenId}`,
				})
				const mintScript = BSV21.mint(tokenId, mintAmount).lock(
					mintResolved.lockingScript,
				)
				const mintMeta = {
					id: tokenId,
					amt: String(mintAmount),
					op: 'mint' as const,
					sym: tokenDetails.token.sym,
					dec: tokenDetails.token.dec ?? 0,
					icon: tokenDetails.token.icon,
				}
				outputs.push({
					lockingScript: mintScript.toHex(),
					satoshis: 1,
					outputDescription: `Mint ${mintAmount} tokens`,
					basket: BSV21_BASKET,
					tags: bsv21FilterTags({ tokenId }),
					customInstructions: mintResolved.customInstructions
						? buildBsv21CustomInstructions({
								token: mintMeta,
								protocolID: mintResolved.customInstructions.protocolID,
								keyID: mintResolved.customInstructions.keyID,
								counterparty: mintResolved.customInstructions.counterparty as
									| string
									| undefined,
							})
						: buildBsv21CustomInstructions({ token: mintMeta }),
				})
			}

			if (!endMinting) {
				const authResolved = await resolveDestination(ctx, auth?.destination, {
					protocolID: P1SAT_PROTOCOL,
					keyIDPrefix: `bsv21-auth-${tokenId}`,
				})
				const authScript = BSV21.auth(tokenId).lock(authResolved.lockingScript)
				const authMeta = {
					id: tokenId,
					amt: '0',
					op: 'auth' as const,
					sym: tokenDetails.token.sym,
					dec: tokenDetails.token.dec ?? 0,
					icon: tokenDetails.token.icon,
				}
				authOutputIndex = outputs.length
				outputs.push({
					lockingScript: authScript.toHex(),
					satoshis: 1,
					outputDescription: 'Continuing mint authority',
					basket: BSV21_BASKET,
					tags: bsv21FilterTags({ tokenId, auth: true }),
					customInstructions: authResolved.customInstructions
						? buildBsv21CustomInstructions({
								token: authMeta,
								protocolID: authResolved.customInstructions.protocolID,
								keyID: authResolved.customInstructions.keyID,
								counterparty: authResolved.customInstructions.counterparty as
									| string
									| undefined,
							})
						: buildBsv21CustomInstructions({ token: authMeta }),
				})
			}

			// Optional fee output to overlay fund address (per token output).
			// At this point outputs contains exactly the emitted BSV21 outputs.
			// Counting the caller's optional `auth` input undercounts the default
			// continuing-self authority emitted whenever endMinting is false.
			const tokenOutputCount = outputs.length
			if (tokenOutputCount > 0 && tokenDetails.status.fee_per_output > 0) {
				outputs.push({
					lockingScript: new P2PKH()
						.lock(tokenDetails.status.fee_address)
						.toHex(),
					satoshis: tokenDetails.status.fee_per_output * tokenOutputCount,
					outputDescription: 'Overlay processing fee',
					tags: ['fee:overlay'],
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
			const authInputId = readAssetIdTag(authUtxo.tags)
			const mintArgs = await prepareP1SatArgs(ctx, {
				description: mint
					? `Mint ${mintAmount} ${symbol}`
					: endMinting
						? `End ${symbol} mint authority`
						: `Re-issue ${symbol} authority`,
				labels: [
					buildTokenLabel(tokenId),
					...(authInputId
						? [buildInputAssetLabel(BSV21_BASKET, authInputId)]
						: []),
				],
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
			})
			const result = await executeTrackedAction(
				ctx.wallet,
				mintArgs,
				input.fundingProvider,
				inputBEEF as number[],
				async (tx) => {
					if ((authCI as { multiSig?: boolean }).multiSig === true) {
						// 1-of-N P2MS auth: this wallet contributes its single
						// portion. For M > 1 the prepare/finalize flow collects
						// portions from multiple admins out-of-band; that lives
						// in a separate action.
						const counterparty = authCI.counterparty ?? 'self'
						const portion = await P2MS.unlockSingleWithWallet(
							tx,
							0,
							ctx.wallet,
							authCI.protocolID,
							authCI.keyID,
							typeof counterparty === 'string' ? counterparty : 'self',
						)
						const { publicKey: myPub } = await ctx.wallet.getPublicKey({
							protocolID: authCI.protocolID,
							keyID: authCI.keyID,
							counterparty,
							forSelf: true,
						})
						const portions = new Map([[myPub, portion]])
						const assembler = P2MS.unlock(portions)
						const unlockScript = await assembler.sign(tx, 0)
						return { 0: { unlockingScript: unlockScript.toHex() } }
					}
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
					console.warn('[mintBsv21] Overlay submission failed:', overlayError)
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
	listBsv21,
	getBsv21Balances,
	sendBsv21,
	buyBsv21,
	deployBsv21Mint,
	deployBsv21Auth,
	mintBsv21,
]
