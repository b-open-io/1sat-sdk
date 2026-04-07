/**
 * MNEE Module
 *
 * Actions for querying and transferring MNEE stablecoin.
 * Uses the MNEE API for balance/UTXO queries and transaction submission.
 * Addresses are derived from the wallet's BRC-29 "yours" prefix (indices 0-4).
 */

import type {
	MneeBalance,
	MneeUtxo,
	MneeTransferResponse,
	MneeTransferStatus,
	MneeTxHistoryResponse,
	MneeConfig,
	MneeClient,
} from '@1sat/client'
import { BRC29_PROTOCOL_ID, type AddressDerivation } from '@1sat/types'
import {
	Hash,
	LockingScript,
	OP,
	PublicKey,
	Script,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'
import type { Action, OneSatContext } from '../types'
import {
	deriveDepositAddresses,
	toBase64Prefix,
	toBase64Suffix,
} from '../addresses'

// ============================================================================
// Helpers
// ============================================================================

const YOURS_PREFIX = 'yours'
const YOURS_ADDRESS_COUNT = 5

/** Derive all 5 yours wallet addresses with full derivation info */
async function deriveYoursDerivations(
	ctx: OneSatContext,
): Promise<AddressDerivation[]> {
	const result = await deriveDepositAddresses.execute(ctx, {
		prefix: YOURS_PREFIX,
		startIndex: 0,
		count: YOURS_ADDRESS_COUNT,
	})
	return result.derivations
}

/** Derive all 5 yours wallet addresses for MNEE operations */
async function deriveYoursAddresses(ctx: OneSatContext): Promise<string[]> {
	const derivations = await deriveYoursDerivations(ctx)
	return derivations.map((d) => d.address)
}

/** Build a map of address → BRC-29 keyID for signing */
function buildAddressKeyMap(
	derivations: AddressDerivation[],
): Map<string, string> {
	const map = new Map<string, string>()
	for (const d of derivations) {
		const keyID = `${d.derivationPrefix} ${d.derivationSuffix}`
		map.set(d.address, keyID)
	}
	return map
}

// ============================================================================
// CosignTemplate (ported from mnee@3.1.0)
// ============================================================================

function cosignLock(
	userAddress: string,
	approverPubKey: PublicKey,
): LockingScript {
	const hash = Utils.fromBase58Check(userAddress)
	const pkhash = hash.data as number[]
	const script = new LockingScript()
	script
		.writeOpCode(OP.OP_DUP)
		.writeOpCode(OP.OP_HASH160)
		.writeBin(pkhash)
		.writeOpCode(OP.OP_EQUALVERIFY)
		.writeOpCode(OP.OP_CHECKSIGVERIFY)
		.writeBin(approverPubKey.encode(true) as number[])
		.writeOpCode(OP.OP_CHECKSIG)
	return script
}

function applyInscription(
	lockingScript: LockingScript,
	inscription: { dataB64: string; contentType: string },
): LockingScript {
	const ordHex = Utils.toHex(Utils.toArray('ord', 'utf8'))
	const fileBytes = Utils.toArray(inscription.dataB64, 'base64')
	const fileHex = Utils.toHex(fileBytes)
	const mimeHex = Utils.toHex(Utils.toArray(inscription.contentType, 'utf8'))
	const ordAsm = `OP_0 OP_IF ${ordHex} OP_1 ${mimeHex} OP_0 ${fileHex} OP_ENDIF`
	return LockingScript.fromASM(`${ordAsm} ${lockingScript.toASM()}`)
}

function createInscriptionOutput(
	recipient: string,
	atomicAmount: number,
	config: MneeConfig,
): { lockingScript: LockingScript; satoshis: number } {
	const inscriptionData = {
		p: 'bsv-20',
		op: 'transfer',
		id: config.tokenId,
		amt: atomicAmount.toString(),
	}
	const dataB64 = Utils.toBase64(
		Utils.toArray(JSON.stringify(inscriptionData), 'utf8'),
	)
	const cosignScript = cosignLock(
		recipient,
		PublicKey.fromString(config.approver),
	)
	return {
		lockingScript: applyInscription(cosignScript, {
			dataB64,
			contentType: 'application/bsv-20',
		}),
		satoshis: 1,
	}
}

/** Extract the user address from a cosign locking script */
function extractAddressFromCosignScript(script: Script): string | undefined {
	const chunks = script.chunks
	for (let i = 0; i <= chunks.length - 7; i++) {
		if (
			chunks[i].op === OP.OP_DUP &&
			chunks[i + 1].op === OP.OP_HASH160 &&
			chunks[i + 2].data?.length === 20 &&
			chunks[i + 3].op === OP.OP_EQUALVERIFY &&
			chunks[i + 4].op === OP.OP_CHECKSIGVERIFY &&
			chunks[i + 5].data?.length === 33 &&
			chunks[i + 6].op === OP.OP_CHECKSIG
		) {
			return Utils.toBase58Check(chunks[i + 2].data as number[], [0])
		}
	}
	return undefined
}

/** Parse BSV-20 inscription amount from a locking script */
function parseInscriptionAmount(script: Script): number {
	for (let i = 0; i < script.chunks.length; i++) {
		const chunk = script.chunks[i]
		if (
			chunk.data?.length === 3 &&
			Utils.toUTF8(chunk.data) === 'ord' &&
			i >= 2 &&
			script.chunks[i - 1].op === OP.OP_IF &&
			script.chunks[i - 2].op === OP.OP_FALSE
		) {
			// Find the data chunk (after OP_0 following content type)
			for (let j = i + 1; j < script.chunks.length; j++) {
				if (script.chunks[j].op === OP.OP_ENDIF) break
				if (
					script.chunks[j].op === OP.OP_0 &&
					j + 1 < script.chunks.length &&
					script.chunks[j + 1].data
				) {
					try {
						const json = JSON.parse(
							Utils.toUTF8(script.chunks[j + 1].data!),
						)
						if (json.amt) return Number.parseInt(json.amt, 10)
					} catch {
						// not JSON
					}
				}
			}
		}
	}
	return 0
}

/** Sign a cosign input using BRC-29 key derivation */
async function signCosignInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	keyID: string,
): Promise<string> {
	const input = tx.inputs[inputIndex]
	const sourceLockingScript =
		input.sourceTransaction?.outputs[input.sourceOutputIndex]?.lockingScript
	if (!sourceLockingScript)
		throw new Error(`Missing source locking script for input ${inputIndex}`)

	const sourceTXID =
		input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID)
		throw new Error(`Missing source TXID for input ${inputIndex}`)

	const sourceSatoshis =
		input.sourceTransaction?.outputs[input.sourceOutputIndex]?.satoshis ?? 1

	const scope =
		TransactionSignature.SIGHASH_ALL |
		TransactionSignature.SIGHASH_ANYONECANPAY |
		TransactionSignature.SIGHASH_FORKID

	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, idx) => idx !== inputIndex)
			.map((inp) => ({
				sourceTXID:
					inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: inp.sourceOutputIndex,
				sequence: inp.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript: sourceLockingScript,
		lockTime: tx.lockTime,
		scope,
	})

	const sighash = Hash.sha256(Hash.sha256(preimage))

	const { signature } = await ctx.wallet.createSignature({
		protocolID: BRC29_PROTOCOL_ID,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(sighash),
	})

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID,
		forSelf: true,
	})

	const sigWithHashtype = [...signature, scope]

	return new UnlockingScript()
		.writeBin(sigWithHashtype)
		.writeBin(Utils.toArray(publicKey, 'hex'))
		.toHex()
}

function getMneeClient(ctx: OneSatContext): MneeClient {
	if (!ctx.services?.mnee) {
		throw new Error('MNEE client not available — services required')
	}
	return ctx.services.mnee
}

// ============================================================================
// Types
// ============================================================================

export interface GetMneeBalanceInput {
	/** Specific addresses to query. If omitted, derives all yours wallet addresses. */
	addresses?: string[]
}

export interface GetMneeBalanceResult {
	/** Per-address balances */
	balances: MneeBalance[]
	/** Total balance in MNEE (decimal) */
	totalDecimal: number
	/** Total balance in atomic units */
	totalAtomic: number
}

export interface GetMneeUtxosInput {
	/** Specific addresses to query. If omitted, derives all yours wallet addresses. */
	addresses?: string[]
}

export interface GetMneeUtxosResult {
	utxos: MneeUtxo[]
}

export interface GetMneeConfigInput {
	// no params
}

export interface GetMneeHistoryInput {
	/** Specific address. If omitted, uses primary address (index 0). */
	address?: string
	/** Pagination cursor */
	fromScore?: number
	/** Max results (default 50) */
	limit?: number
}

export interface SendMneeInput {
	/** Recipients */
	recipients: Array<{ address: string; amount: number }>
	/** Specific source addresses. If omitted, derives all yours wallet addresses. */
	fromAddresses?: string[]
}

export interface SendMneeResult {
	ticketId?: string
	rawtx?: string
	error?: string
}

export interface GetMneeTxStatusInput {
	ticketId: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Get MNEE balance across all yours wallet addresses.
 */
export const getMneeBalance: Action<GetMneeBalanceInput, GetMneeBalanceResult> = {
	meta: {
		name: 'getMneeBalance',
		description: 'Get MNEE stablecoin balance across yours wallet addresses',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				addresses: {
					type: 'array',
					description: 'Specific addresses to query (omit to use yours wallet addresses)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const addresses = input.addresses ?? await deriveYoursAddresses(ctx)
		const balances = await mnee.getBalances(addresses)

		const totalAtomic = balances.reduce((sum, b) => sum + b.amount, 0)
		const totalDecimal = balances.reduce((sum, b) => sum + b.decimalAmount, 0)

		return { balances, totalDecimal, totalAtomic }
	},
}

/**
 * Get MNEE UTXOs across all yours wallet addresses.
 */
export const getMneeUtxos: Action<GetMneeUtxosInput, GetMneeUtxosResult> = {
	meta: {
		name: 'getMneeUtxos',
		description: 'Get MNEE UTXOs across yours wallet addresses',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				addresses: {
					type: 'array',
					description: 'Specific addresses to query (omit to use yours wallet addresses)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const addresses = input.addresses ?? await deriveYoursAddresses(ctx)
		const utxos = await mnee.getAllUtxos(addresses)
		return { utxos }
	},
}

/**
 * Get MNEE service configuration (cosigner, fees, etc).
 */
export const getMneeConfig: Action<GetMneeConfigInput, MneeConfig> = {
	meta: {
		name: 'getMneeConfig',
		description: 'Get MNEE service configuration including cosigner and fee structure',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const mnee = getMneeClient(ctx)
		return mnee.getConfig()
	},
}

/**
 * Get MNEE transaction history for an address.
 */
export const getMneeHistory: Action<GetMneeHistoryInput, MneeTxHistoryResponse> = {
	meta: {
		name: 'getMneeHistory',
		description: 'Get MNEE transaction history',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				address: {
					type: 'string',
					description: 'Address to query (omit for primary address)',
				},
				fromScore: {
					type: 'number',
					description: 'Pagination cursor',
				},
				limit: {
					type: 'number',
					description: 'Max results (default 50)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const address = input.address ?? (await deriveYoursAddresses(ctx))[0]
		return mnee.getTxHistory(address, input.fromScore, input.limit)
	},
}

/**
 * Get the status of an MNEE transfer by ticket ID.
 */
export const getMneeTxStatus: Action<GetMneeTxStatusInput, MneeTransferStatus> = {
	meta: {
		name: 'getMneeTxStatus',
		description: 'Get the status of an MNEE transfer',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				ticketId: {
					type: 'string',
					description: 'Ticket ID from a transfer response',
				},
			},
			required: ['ticketId'],
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		return mnee.getTxStatus(input.ticketId)
	},
}

// ============================================================================
// Send MNEE
// ============================================================================

export interface SendMneeRecipient {
	address: string
	/** Amount in MNEE (decimal, e.g. 1.5 = $1.50) */
	amount: number
}

export interface SendMneeInput {
	recipients: SendMneeRecipient[]
	/** Change address. If omitted, change goes back to the first input's address. */
	changeAddress?: string
}

export interface SendMneeResult {
	ticketId?: string
	rawtx?: string
	error?: string
}

/**
 * Send MNEE stablecoin. Builds the transaction, signs with BRC-29 keys,
 * and submits to MNEE API for cosigner signature + broadcast.
 */
export const sendMnee: Action<SendMneeInput, SendMneeResult> = {
	meta: {
		name: 'sendMnee',
		description: 'Send MNEE stablecoin to one or more recipients',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				recipients: {
					type: 'array',
					description: 'Recipients with address and amount in MNEE',
				},
				changeAddress: {
					type: 'string',
					description: 'Change address (defaults to first input address)',
				},
			},
			required: ['recipients'],
		},
	},
	async execute(ctx, input) {
		try {
			const mnee = getMneeClient(ctx)
			const { recipients, changeAddress } = input

			if (!recipients.length) return { error: 'no-recipients' }

			// 1. Derive addresses and build address→keyID map
			const derivations = await deriveYoursDerivations(ctx)
			const addresses = derivations.map((d) => d.address)
			const addressKeyMap = buildAddressKeyMap(derivations)

			// 2. Get MNEE config
			const config = await mnee.getConfig()
			if (!config?.approver) return { error: 'failed-to-get-mnee-config' }

			// 3. Calculate total amount needed
			const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0)
			if (totalAmount <= 0) return { error: 'invalid-amount' }
			const totalAtomic = MneeClientStatic.toAtomicAmount(totalAmount)

			// 4. Calculate fee
			const fee = recipients.some((r) => r.address === config.burnAddress)
				? 0
				: config.fees.find(
						(f) => totalAtomic >= f.min && totalAtomic <= f.max,
					)?.fee
			if (fee === undefined) return { error: 'fee-ranges-inadequate' }

			// 5. Get enough UTXOs across all addresses
			const allUtxos = await mnee.getAllUtxos(addresses)
			let tokensNeeded = totalAtomic + fee
			const selectedUtxos: MneeUtxo[] = []
			let tokensIn = 0

			for (const utxo of allUtxos) {
				if (tokensIn >= tokensNeeded) break
				const amt = utxo.data.bsv21?.amt ?? 0
				if (amt <= 0) continue
				selectedUtxos.push(utxo)
				tokensIn += amt
			}

			if (tokensIn < tokensNeeded) {
				return {
					error: `Insufficient MNEE. Have: ${MneeClientStatic.fromAtomicAmount(tokensIn)}, Need: ${MneeClientStatic.fromAtomicAmount(tokensNeeded)}`,
				}
			}

			// 6. Fetch source transactions and build the tx
			const tx = new Transaction(1, [], [], 0)

			for (const utxo of selectedUtxos) {
				// Fetch source transaction from MNEE API or 1Sat services
				let sourceTx: Transaction | undefined
				try {
					const beef = await ctx.services!.getBeefForTxid(utxo.txid)
					const beefTx = beef.findTxid(utxo.txid)
					if (beefTx?.tx) sourceTx = beefTx.tx
				} catch {
					// Fallback: try raw tx fetch
				}

				if (!sourceTx) {
					return { error: `failed-to-fetch-source-tx: ${utxo.txid}` }
				}

				tx.addInput({
					sourceTXID: utxo.txid,
					sourceOutputIndex: utxo.vout,
					sourceTransaction: sourceTx,
					unlockingScript: new UnlockingScript(),
					sequence: 0xffffffff,
				})
			}

			// 7. Add recipient outputs
			for (const r of recipients) {
				const out = createInscriptionOutput(
					r.address,
					MneeClientStatic.toAtomicAmount(r.amount),
					config,
				)
				tx.addOutput(out)
			}

			// 8. Add fee output
			if (fee > 0) {
				tx.addOutput(
					createInscriptionOutput(config.feeAddress, fee, config),
				)
			}

			// 9. Add change output
			const change = tokensIn - totalAtomic - fee
			if (change > 0) {
				const changeAddr =
					changeAddress ??
					extractAddressFromCosignScript(
						selectedUtxos[0]
							? Script.fromHex(selectedUtxos[0].script)
							: tx.inputs[0].sourceTransaction!.outputs[
									tx.inputs[0].sourceOutputIndex
								].lockingScript,
					) ??
					addresses[0]
				tx.addOutput(
					createInscriptionOutput(changeAddr, change, config),
				)
			}

			// 10. Sign each input with the matching BRC-29 key
			for (let i = 0; i < tx.inputs.length; i++) {
				const utxo = selectedUtxos[i]
				const ownerAddress = utxo.owners?.[0]
				const keyID = addressKeyMap.get(ownerAddress)
				if (!keyID) {
					return {
						error: `No key found for address ${ownerAddress} — not a yours wallet address`,
					}
				}

				const unlockingHex = await signCosignInput(ctx, tx, i, keyID)
				tx.inputs[i].unlockingScript =
					UnlockingScript.fromHex(unlockingHex)
			}

			// 11. Submit to MNEE for cosigner signature + broadcast
			const rawTx = tx.toHex()
			const result = await mnee.submitRawTx(rawTx, { broadcast: true })

			return {
				ticketId: result.ticketId,
				rawtx: result.rawtx,
			}
		} catch (error) {
			console.error('[sendMnee]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// Static helpers re-exported for convenience
const MneeClientStatic = {
	toAtomicAmount(mneeAmount: number): number {
		return Math.round(mneeAmount * 100_000)
	},
	fromAtomicAmount(atomicAmount: number): number {
		return atomicAmount / 100_000
	},
}

// ============================================================================
// Module exports
// ============================================================================

export const mneeActions = [
	getMneeBalance,
	getMneeUtxos,
	getMneeConfig,
	getMneeHistory,
	getMneeTxStatus,
	sendMnee,
]
