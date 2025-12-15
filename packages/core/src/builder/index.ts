/**
 * TxBuilder - Transaction building abstraction for 1Sat Ordinals
 *
 * Provides a fluent API for building ordinal transactions with
 * automatic fee calculation and change handling.
 */

import { inputFromUtxo } from '@1sat/client'
import { DEFAULT_SAT_PER_KB } from '@1sat/constants'
import { signData } from '@1sat/protocols'
import { OrdP2PKH } from '@1sat/protocols'
import type {
	ChangeResult,
	Inscription,
	MAP,
	NftUtxo,
	Payment,
	Signer,
	TokenUtxo,
	Utxo,
} from '@1sat/types'
import {
	P2PKH,
	type PrivateKey,
	SatoshisPerKilobyte,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'

const { toBase64 } = Utils

/**
 * Configuration for TxBuilder
 */
export interface TxBuilderConfig {
	/** Satoshis per kilobyte for fee calculation */
	satsPerKb?: number
	/** Whether to sign inputs (set false for external signing) */
	signInputs?: boolean
}

/**
 * TxBuilder - Fluent API for building ordinal transactions
 *
 * Eliminates repetitive code by providing chainable methods for
 * common transaction building operations.
 *
 * @example
 * ```typescript
 * const result = await new TxBuilder()
 *   .addOrdinalOutput(address, inscription)
 *   .addPaymentInputs(utxos, privateKey)
 *   .setChangeAddress(changeAddress)
 *   .build()
 * ```
 */
export class TxBuilder {
	private tx: Transaction
	private satsPerKb: number
	private signInputs: boolean
	private changeAddress: string | null = null
	private signer: Signer | null = null
	private spentOutpoints: string[] = []
	private totalSatsIn = 0n

	constructor(config: TxBuilderConfig = {}) {
		this.tx = new Transaction()
		this.satsPerKb = config.satsPerKb ?? DEFAULT_SAT_PER_KB
		this.signInputs = config.signInputs ?? true
	}

	/**
	 * Add an ordinal output with optional inscription and metadata
	 */
	addOrdinalOutput(
		address: string,
		inscription?: Inscription,
		metaData?: MAP,
	): this {
		const script = inscription
			? new OrdP2PKH().lock(address, inscription, metaData)
			: new P2PKH().lock(address)

		this.tx.addOutput({
			satoshis: 1,
			lockingScript: script,
		})
		return this
	}

	/**
	 * Add a payment output (non-ordinal)
	 */
	addPaymentOutput(address: string, satoshis: number): this {
		this.tx.addOutput({
			satoshis,
			lockingScript: new P2PKH().lock(address),
		})
		return this
	}

	/**
	 * Add multiple payment outputs
	 */
	addPayments(payments: Payment[]): this {
		for (const p of payments) {
			this.addPaymentOutput(p.to, p.amount)
		}
		return this
	}

	/**
	 * Add ordinal inputs (1-sat UTXOs)
	 */
	addOrdinalInputs(utxos: (Utxo | NftUtxo)[], privateKey?: PrivateKey): this {
		for (const utxo of utxos) {
			if (utxo.satoshis !== 1) {
				throw new Error('Ordinal UTXOs must have exactly 1 satoshi')
			}

			const pk = utxo.pk ?? privateKey
			if (this.signInputs) {
				if (!pk) {
					throw new Error('Private key required to sign ordinal input')
				}
				const input = inputFromUtxo(
					utxo,
					new OrdP2PKH().unlock(
						pk,
						'all',
						true,
						utxo.satoshis,
						Script.fromBinary(Utils.toArray(utxo.script, 'base64')),
					),
				)
				this.tx.addInput(input)
			} else {
				this.tx.addInput(inputFromUtxo(utxo))
			}

			this.spentOutpoints.push(`${utxo.txid}_${utxo.vout}`)
			this.totalSatsIn += BigInt(utxo.satoshis)
		}
		return this
	}

	/**
	 * Add payment inputs with automatic funding
	 * Adds inputs until sufficient funds are available
	 */
	async addPaymentInputs(
		utxos: Utxo[],
		privateKey?: PrivateKey,
	): Promise<this> {
		const modelOrFee = new SatoshisPerKilobyte(this.satsPerKb)
		const totalSatsOut = this.tx.outputs.reduce(
			(total, out) => total + BigInt(out.satoshis ?? 0),
			0n,
		)

		for (const utxo of utxos) {
			const pk = utxo.pk ?? privateKey
			if (this.signInputs) {
				if (!pk) {
					throw new Error('Private key required to sign payment input')
				}
				const input = inputFromUtxo(
					utxo,
					new P2PKH().unlock(
						pk,
						'all',
						true,
						utxo.satoshis,
						Script.fromBinary(Utils.toArray(utxo.script, 'base64')),
					),
				)
				this.tx.addInput(input)
			} else {
				this.tx.addInput(inputFromUtxo(utxo))
			}

			this.spentOutpoints.push(`${utxo.txid}_${utxo.vout}`)
			this.totalSatsIn += BigInt(utxo.satoshis)

			// Check if we have enough funds
			const fee = await modelOrFee.computeFee(this.tx)
			if (this.totalSatsIn >= totalSatsOut + BigInt(fee)) {
				break
			}
		}

		return this
	}

	/**
	 * Add token inputs
	 */
	addTokenInputs(utxos: TokenUtxo[], privateKey?: PrivateKey): this {
		// Token inputs are ordinal inputs
		return this.addOrdinalInputs(utxos as (Utxo | NftUtxo)[], privateKey)
	}

	/**
	 * Set the change address
	 */
	setChangeAddress(address: string): this {
		this.changeAddress = address
		return this
	}

	/**
	 * Set a signer for data signing (Sigma protocol)
	 */
	setSigner(signer: Signer): this {
		this.signer = signer
		return this
	}

	/**
	 * Build and finalize the transaction
	 */
	async build(): Promise<ChangeResult> {
		if (!this.changeAddress) {
			throw new Error('Change address is required')
		}

		// Add change output
		const changeScript = new P2PKH().lock(this.changeAddress)
		this.tx.addOutput({
			lockingScript: changeScript,
			change: true,
		})

		// Sign data if signer provided
		if (this.signer) {
			this.tx = await signData(this.tx, this.signer)
		}

		// Calculate and apply fee
		const modelOrFee = new SatoshisPerKilobyte(this.satsPerKb)
		await this.tx.fee(modelOrFee)

		// Verify sufficient funds
		const totalSatsOut = this.tx.outputs.reduce(
			(total, out) => total + BigInt(out.satoshis ?? 0),
			0n,
		)
		if (this.totalSatsIn < totalSatsOut) {
			throw new Error(
				`Insufficient funds. In: ${this.totalSatsIn}, Out: ${totalSatsOut}`,
			)
		}

		// Sign transaction if requested
		if (this.signInputs) {
			await this.tx.sign()
		}

		// Build change UTXO
		let payChange: Utxo | undefined
		const changeOutIdx = this.tx.outputs.findIndex((o) => o.change)
		if (changeOutIdx !== -1) {
			const changeOutput = this.tx.outputs[changeOutIdx]
			if (changeOutput.satoshis && changeOutput.satoshis > 0) {
				payChange = {
					satoshis: changeOutput.satoshis,
					txid: this.tx.id('hex') as string,
					vout: changeOutIdx,
					script: toBase64(changeOutput.lockingScript.toBinary()),
				}
			}
		}

		return {
			tx: this.tx,
			spentOutpoints: this.spentOutpoints,
			payChange,
		}
	}

	/**
	 * Get the underlying transaction (for inspection)
	 */
	getTransaction(): Transaction {
		return this.tx
	}
}

/**
 * Create a new TxBuilder instance
 */
export function createTxBuilder(config?: TxBuilderConfig): TxBuilder {
	return new TxBuilder(config)
}
