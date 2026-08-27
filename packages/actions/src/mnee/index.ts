/**
 * MNEE Module
 *
 * Actions for querying and transferring MNEE stablecoin.
 * Uses the MNEE API for balance/UTXO queries and transaction submission.
 * Addresses are derived from the wallet's default P1SAT deposit prefix
 * (`DEFAULT_DEPOSIT_PREFIX = "1sat"`, indices 0-4).
 */

import type {
	MneeClient,
	MneeConfig,
	MneeSyncEntry,
	MneeTransferStatus,
	MneeUtxo,
} from '@1sat/client'
import { Cosign, Inscription as InscriptionTemplate } from '@1sat/templates'
import { type AddressDerivation, P1SAT_PROTOCOL } from '@1sat/types'
import {
	Hash,
	LockingScript,
	OP,
	PublicKey,
	type Script,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'
import type { Action, OneSatContext } from '../types'

// ============================================================================
// Helpers
// ============================================================================

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
	return Cosign.decode(script)?.address ?? undefined
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
						const json = JSON.parse(Utils.toUTF8(script.chunks[j + 1].data!))
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

	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
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
				sourceTXID: inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? '',
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
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(sighash),
	})

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
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
	/** Addresses to query for MNEE balance */
	addresses: string[]
}

export interface MneeAddressBalance {
	address: string
	/** Balance in atomic units */
	amount: number
	/** Balance in MNEE (decimal) */
	decimalAmount: number
}

export interface GetMneeBalanceResult {
	/** Per-address balances */
	balances: MneeAddressBalance[]
	/** Total balance in MNEE (decimal) */
	totalDecimal: number
	/** Total balance in atomic units */
	totalAtomic: number
}

export interface GetMneeUtxosInput {
	/** Addresses to query for MNEE UTXOs */
	addresses: string[]
}

export interface GetMneeUtxosResult {
	utxos: MneeUtxo[]
}

export type GetMneeConfigInput = {}

export interface GetMneeHistoryInput {
	/** Addresses to query history for */
	addresses: string[]
	/** Pagination cursor */
	fromScore?: number
	/** Max results (default 50) */
	limit?: number
}

export interface SendMneeInput {
	/** Recipients */
	recipients: Array<{ address: string; amount: number }>
	/** Source address derivations (address + keyID for signing) */
	derivations: AddressDerivation[]
	/** Change address. If omitted, change goes back to the first input's address. */
	changeAddress?: string
}

export interface GetMneeTxStatusInput {
	ticketId: string
}

export interface MneeTxHistory {
	txid: string
	height: number
	type: 'send' | 'receive'
	status: 'confirmed' | 'unconfirmed'
	/** Amount in atomic units sent/received (excluding fees and self-change) */
	amount: number
	/** Fee in atomic units (only for sends) */
	fee: number
	/** Pagination cursor */
	score: number
	/** Counterparty addresses and amounts */
	counterparties: Array<{ address: string; amount: number }>
}

export interface GetMneeHistoryResult {
	history: MneeTxHistory[]
	/** Pass this as fromScore in the next call for pagination */
	nextScore?: number
}

// ============================================================================
// History parsing (ported from mnee@3.1.0 parseSyncToTxHistory)
// ============================================================================

function parseSyncToTxHistory(
	sync: MneeSyncEntry,
	address: string,
	config: MneeConfig,
): MneeTxHistory | null {
	const txType: 'send' | 'receive' = sync.senders.includes(address)
		? 'send'
		: 'receive'
	const txStatus: 'confirmed' | 'unconfirmed' =
		sync.height > 0 ? 'confirmed' : 'unconfirmed'

	if (!sync.rawtx) return null

	const txArray = Utils.toArray(sync.rawtx, 'base64')
	const txHex = Utils.toHex(txArray)
	const tx = Transaction.fromHex(txHex)

	// Parse each output for cosign address and inscription amount
	const outputData: Array<{
		address: string | undefined
		amount: number
	}> = tx.outputs.map((output) => {
		const cosign = Cosign.decode(output.lockingScript)
		const inscription = InscriptionTemplate.decode(output.lockingScript)
		let amount = 0
		if (inscription?.file?.content) {
			try {
				const json = JSON.parse(
					Utils.toUTF8(Array.from(inscription.file.content)),
				)
				if (json.p === 'bsv-20' && json.id === config.tokenId && json.amt) {
					amount = Number.parseInt(json.amt, 10)
				}
			} catch {
				// not valid JSON inscription
			}
		}
		return { address: cosign?.address, amount }
	})

	const feeAddressIndex = outputData.findIndex(
		(o) => o.address === config.feeAddress,
	)
	const sender = sync.senders[0]

	let fee = 0
	const counterpartyAmounts = new Map<string, number>()

	for (let i = 0; i < outputData.length; i++) {
		const { address: outAddr, amount } = outputData[i]
		if (!outAddr || amount <= 0) continue

		if (feeAddressIndex === i && sender === address) {
			fee += amount
			continue
		}

		counterpartyAmounts.set(
			outAddr,
			(counterpartyAmounts.get(outAddr) ?? 0) + amount,
		)
	}

	const amountSentToAddress = counterpartyAmounts.get(address) ?? 0

	if (txType === 'send') {
		const senderAmt = counterpartyAmounts.get(sender) ?? 0
		counterpartyAmounts.set(sender, senderAmt - amountSentToAddress)
	}

	let counterparties: Array<{ address: string; amount: number }>
	if (txType === 'receive') {
		counterparties = [{ address: sender, amount: amountSentToAddress }]
	} else {
		counterparties = Array.from(counterpartyAmounts.entries())
			.map(([addr, amt]) => ({ address: addr, amount: amt }))
			.filter(
				(cp) =>
					cp.address !== address &&
					cp.address !== config.feeAddress &&
					cp.amount > 0,
			)
	}

	const totalCounterpartyAmount = counterparties.reduce(
		(sum, cp) => sum + cp.amount,
		0,
	)

	return {
		txid: sync.txid,
		height: sync.height,
		type: txType,
		status: txStatus,
		amount: totalCounterpartyAmount,
		fee,
		score: sync.score,
		counterparties,
	}
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Get MNEE balance across all yours wallet addresses.
 */
export const getMneeBalance: Action<GetMneeBalanceInput, GetMneeBalanceResult> =
	{
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
						description:
							'Specific addresses to query (omit to use yours wallet addresses)',
					},
				},
			},
		},
		async execute(ctx, input) {
			const mnee = getMneeClient(ctx)
			const rawBalances = await mnee.getBalances(input.addresses)

			const balances = rawBalances.map((b) => ({
				address: b.address,
				amount: b.amt,
				decimalAmount: b.precised,
			}))
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
					description:
						'Specific addresses to query (omit to use yours wallet addresses)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const utxos = await mnee.getAllUtxos(input.addresses)
		return { utxos }
	},
}

/**
 * Get MNEE service configuration (cosigner, fees, etc).
 */
export const getMneeConfig: Action<GetMneeConfigInput, MneeConfig> = {
	meta: {
		name: 'getMneeConfig',
		description:
			'Get MNEE service configuration including cosigner and fee structure',
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
export const getMneeHistory: Action<GetMneeHistoryInput, GetMneeHistoryResult> =
	{
		meta: {
			name: 'getMneeHistory',
			description:
				'Get MNEE transaction history with parsed amounts and counterparties',
			category: 'payments',
			requiresServices: true,
			inputSchema: {
				type: 'object',
				properties: {
					address: {
						type: 'string',
						description: 'Address to query (omit for all yours addresses)',
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
			const queryAddress = input.addresses[0]

			const config = await mnee.getConfig()
			const syncEntries = await mnee.getTxHistory(
				input.addresses,
				input.fromScore,
				input.limit,
			)

			const history: MneeTxHistory[] = []
			for (const entry of syncEntries) {
				const parsed = parseSyncToTxHistory(entry, queryAddress, config)
				if (parsed) history.push(parsed)
			}

			const nextScore =
				syncEntries.length > 0
					? syncEntries[syncEntries.length - 1].score
					: undefined

			return { history, nextScore }
		},
	}

/**
 * Get the status of an MNEE transfer by ticket ID.
 */
export const getMneeTxStatus: Action<GetMneeTxStatusInput, MneeTransferStatus> =
	{
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
	txid?: string
	ticketId?: string
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
			required: ['recipients', 'derivations'],
		},
	},
	async execute(ctx, input) {
		try {
			const mnee = getMneeClient(ctx)
			const { recipients, derivations, changeAddress } = input

			if (!recipients.length) return { error: 'no-recipients' }
			if (!derivations.length) return { error: 'no-derivations' }

			// 1. Build address→keyID map from caller-provided derivations
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
				: config.fees.find((f) => totalAtomic >= f.min && totalAtomic <= f.max)
						?.fee
			if (fee === undefined) return { error: 'fee-ranges-inadequate' }

			// 5. Get enough UTXOs across all addresses
			const allUtxos = await mnee.getAllUtxos(addresses)
			const tokensNeeded = totalAtomic + fee
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

			// 6. Fetch source transactions via MNEE API and build the tx
			const tx = new Transaction(1, [], [], 0)

			for (const utxo of selectedUtxos) {
				const rawHex = await ctx.services!.mnee.fetchRawTx(utxo.txid)
				if (!rawHex) {
					return { error: `failed-to-fetch-source-tx: ${utxo.txid}` }
				}
				const sourceTx = Transaction.fromHex(rawHex)

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
				tx.addOutput(createInscriptionOutput(config.feeAddress, fee, config))
			}

			// 9. Add change output
			const change = tokensIn - totalAtomic - fee
			if (change > 0) {
				const changeAddr =
					changeAddress ??
					extractAddressFromCosignScript(
						tx.inputs[0].sourceTransaction!.outputs[
							tx.inputs[0].sourceOutputIndex
						].lockingScript,
					) ??
					addresses[0]
				tx.addOutput(createInscriptionOutput(changeAddr, change, config))
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
				tx.inputs[i].unlockingScript = UnlockingScript.fromHex(unlockingHex)
			}

			// 11. Submit to MNEE for cosigner signature + broadcast
			const rawTx = tx.toHex()
			const submitResult = await mnee.submitRawTx(rawTx, { broadcast: true })

			if (!submitResult.ticketId) {
				return { error: 'no-ticket-id-returned' }
			}

			// 12. Poll for txid until MNEE confirms the transaction
			const ticketId = submitResult.ticketId
			const maxAttempts = 30
			const pollIntervalMs = 2000

			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				await new Promise((r) => setTimeout(r, pollIntervalMs))
				try {
					const status = await mnee.getTxStatus(ticketId)
					if (status.status === 'FAILED') {
						return {
							ticketId,
							error: status.errors ?? 'transaction-failed',
						}
					}
					if (status.status === 'SUCCESS' || status.status === 'MINED') {
						return { txid: status.tx_id, ticketId }
					}
					// BROADCASTING — keep polling
				} catch {
					// Ignore transient poll errors, keep trying
				}
			}

			// Timed out waiting — return ticketId so caller can check later
			return { ticketId, error: 'timeout-waiting-for-txid' }
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
