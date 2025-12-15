/**
 * transferOrdTokens - Transfer BSV20/BSV21 tokens
 */

import { inputFromUtxo } from '@1sat/client'
import { DEFAULT_SAT_PER_KB, TOKEN_CONTENT_TYPE } from '@1sat/constants'
import { OrdP2PKH, applyInscription, signData } from '@1sat/protocols'
import type {
	Distribution,
	PreMAP,
	Signer,
	TokenChangeResult,
	TokenSplitConfig,
	TokenUtxo,
	TransferOrdTokensConfig,
	Utxo,
} from '@1sat/types'
import { TokenInputMode, TokenType } from '@1sat/types'
import { stringifyMetaData } from '@1sat/utils'
import {
	P2PKH,
	type PrivateKey,
	SatoshisPerKilobyte,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { ReturnTypes, toTokenSat } from 'satoshi-token'

const { toArray, toBase64 } = Utils

interface TransferTokenInscription {
	p: 'bsv-20'
	op: 'transfer' | 'burn'
	amt: string
}

interface TransferBSV20Inscription extends TransferTokenInscription {
	tick: string
}

interface TransferBSV21Inscription extends TransferTokenInscription {
	id: string
}

/**
 * Transfer tokens to one or more destinations
 *
 * @example
 * ```typescript
 * const result = await transferOrdTokens({
 *   protocol: TokenType.BSV21,
 *   tokenID: 'token-origin-txid_0',
 *   decimals: 8,
 *   utxos: paymentUtxos,
 *   inputTokens: tokenUtxos,
 *   distributions: [{ address: recipient, tokens: 100 }],
 *   paymentPk: privateKey,
 *   ordPk: ordinalKey,
 *   changeAddress: address,
 *   tokenChangeAddress: address,
 * })
 * ```
 */
export async function transferOrdTokens(
	config: TransferOrdTokensConfig,
): Promise<TokenChangeResult> {
	const {
		protocol,
		tokenID,
		utxos,
		inputTokens,
		distributions,
		paymentPk,
		ordPk,
		satsPerKb = DEFAULT_SAT_PER_KB,
		metaData,
		signer,
		decimals,
		additionalPayments = [],
		burn = false,
		tokenInputMode = TokenInputMode.Needed,
		splitConfig = {
			outputs: 1,
			omitMetaData: false,
		},
		signInputs = true,
	} = config

	// Ensure inputs match expected token
	if (!inputTokens.every((token) => token.id === tokenID)) {
		throw new Error('Input tokens do not match the provided tokenID')
	}

	// Calculate amounts
	let changeTsats = 0n
	let totalTsatIn = 0n
	let totalTsatOut = 0n
	const totalAmtNeeded = distributions.reduce(
		(acc, dist) => acc + toTokenSat(dist.tokens, decimals, ReturnTypes.BigInt),
		0n,
	)

	const modelOrFee = new SatoshisPerKilobyte(satsPerKb)
	let tx = new Transaction()

	// Handle token inputs based on mode
	let tokensToUse: TokenUtxo[]
	if (tokenInputMode === TokenInputMode.All) {
		tokensToUse = inputTokens
		totalTsatIn = inputTokens.reduce((acc, token) => acc + BigInt(token.amt), 0n)
	} else {
		tokensToUse = []
		for (const token of inputTokens) {
			tokensToUse.push(token)
			totalTsatIn += BigInt(token.amt)
			if (totalTsatIn >= totalAmtNeeded) {
				break
			}
		}
		if (totalTsatIn < totalAmtNeeded) {
			throw new Error('Not enough tokens to satisfy the transfer amount')
		}
	}

	// Add token inputs
	for (const token of tokensToUse) {
		if (signInputs) {
			const ordKeyToUse = token.pk ?? ordPk
			if (!ordKeyToUse) {
				throw new Error('Private key required for token input')
			}
			const inputScript = Script.fromBinary(toArray(token.script, 'base64'))
			tx.addInput(
				inputFromUtxo(
					token,
					new OrdP2PKH().unlock(
						ordKeyToUse,
						'all',
						true,
						token.satoshis,
						inputScript,
					),
				),
			)
		} else {
			tx.addInput(inputFromUtxo(token))
		}
	}

	// Clean undefined fields from metadata
	const cleanedMetaData = metaData ? cleanMetaData(metaData) : undefined

	// Build destination outputs
	for (const dest of distributions) {
		const bigAmt = toTokenSat(dest.tokens, decimals, ReturnTypes.BigInt)

		const transferInscription: TransferTokenInscription = {
			p: 'bsv-20',
			op: burn ? 'burn' : 'transfer',
			amt: bigAmt.toString(),
		}

		let inscriptionObj: TransferBSV20Inscription | TransferBSV21Inscription
		if (protocol === TokenType.BSV20) {
			inscriptionObj = {
				...transferInscription,
				tick: tokenID,
			} as TransferBSV20Inscription
		} else if (protocol === TokenType.BSV21) {
			inscriptionObj = {
				...transferInscription,
				id: tokenID,
			} as TransferBSV21Inscription
		} else {
			throw new Error('Invalid protocol')
		}

		const inscription = {
			dataB64: toBase64(toArray(JSON.stringify(inscriptionObj), 'utf8')),
			contentType: TOKEN_CONTENT_TYPE,
		}

		const lockingScript =
			typeof dest.address === 'string'
				? new OrdP2PKH().lock(
						dest.address,
						inscription,
						dest.omitMetaData ? undefined : stringifyMetaData(cleanedMetaData),
					)
				: applyInscription(dest.address, inscription)

		tx.addOutput({
			satoshis: 1,
			lockingScript,
		})
		totalTsatOut += bigAmt
	}

	changeTsats = totalTsatIn - totalTsatOut

	if (changeTsats < 0n) {
		throw new Error('Not enough tokens to send')
	}

	// Handle token change
	let tokenChange: TokenUtxo[] = []
	if (changeTsats > 0n) {
		const tokenChangeAddress = config.tokenChangeAddress ?? ordPk?.toAddress()
		if (!tokenChangeAddress) {
			throw new Error('ordPk or tokenChangeAddress required for token change')
		}
		tokenChange = splitChangeOutputs(
			tx,
			changeTsats,
			protocol,
			tokenID,
			tokenChangeAddress,
			cleanedMetaData,
			splitConfig,
			decimals,
		)
	}

	// Add additional payments
	for (const p of additionalPayments) {
		tx.addOutput({
			satoshis: p.amount,
			lockingScript: new P2PKH().lock(p.to),
		})
	}

	// Add payment change output
	let payChange: Utxo | undefined
	const changeAddress = config.changeAddress ?? paymentPk?.toAddress()
	if (!changeAddress) {
		throw new Error('paymentPk or changeAddress required for payment change')
	}
	const changeScript = new P2PKH().lock(changeAddress)
	tx.addOutput({
		lockingScript: changeScript,
		change: true,
	})

	// Add payment inputs
	let totalSatsIn = 0n
	const totalSatsOut = tx.outputs.reduce(
		(total, out) => total + BigInt(out.satoshis ?? 0),
		0n,
	)
	let fee = 0

	for (const utxo of utxos) {
		if (signInputs) {
			const payKeyToUse = utxo.pk ?? paymentPk
			if (!payKeyToUse) {
				throw new Error('paymentPk required for payment utxo')
			}
			const input = inputFromUtxo(
				utxo,
				new P2PKH().unlock(
					payKeyToUse,
					'all',
					true,
					utxo.satoshis,
					Script.fromBinary(toArray(utxo.script, 'base64')),
				),
			)
			tx.addInput(input)
		} else {
			tx.addInput(inputFromUtxo(utxo))
		}

		totalSatsIn += BigInt(utxo.satoshis)
		fee = await modelOrFee.computeFee(tx)

		if (totalSatsIn >= totalSatsOut + BigInt(fee)) {
			break
		}
	}

	if (totalSatsIn < totalSatsOut + BigInt(fee)) {
		throw new Error(
			`Not enough funds to transfer tokens. In: ${totalSatsIn}, Out: ${totalSatsOut}, Fee: ${fee}`,
		)
	}

	// Sign data if signer provided (Sigma protocol)
	if (signer) {
		tx = await signData(tx, signer)
	}

	// Calculate final fee
	await tx.fee(modelOrFee)

	// Sign transaction
	if (signInputs) {
		await tx.sign()
	}

	// Update txid on token change outputs
	const txid = tx.id('hex') as string
	for (const change of tokenChange) {
		change.txid = txid
	}

	// Build payment change UTXO
	const payChangeOutIdx = tx.outputs.findIndex((o) => o.change)
	if (payChangeOutIdx !== -1) {
		const changeOutput = tx.outputs[payChangeOutIdx]
		if (changeOutput.satoshis && changeOutput.satoshis > 0) {
			payChange = {
				satoshis: changeOutput.satoshis,
				txid,
				vout: payChangeOutIdx,
				script: toBase64(changeOutput.lockingScript.toBinary()),
			}
		}
	}

	return {
		tx,
		spentOutpoints: tx.inputs.map(
			(i) => `${i.sourceTXID}_${i.sourceOutputIndex}`,
		),
		payChange,
		tokenChange,
	}
}

function cleanMetaData(metaData: PreMAP): PreMAP {
	const cleaned: PreMAP = { app: metaData.app, type: metaData.type }
	for (const [key, value] of Object.entries(metaData)) {
		if (value !== undefined) {
			cleaned[key] = value
		}
	}
	return cleaned
}

function splitChangeOutputs(
	tx: Transaction,
	changeTsats: bigint,
	protocol: TokenType,
	tokenID: string,
	tokenChangeAddress: string,
	metaData: PreMAP | undefined,
	splitConfig: TokenSplitConfig,
	decimals: number,
): TokenUtxo[] {
	const tokenChanges: TokenUtxo[] = []

	const threshold =
		splitConfig.threshold !== undefined
			? toTokenSat(splitConfig.threshold, decimals, ReturnTypes.BigInt)
			: undefined

	const maxOutputs = splitConfig.outputs
	const changeAmt = changeTsats
	let splitOutputs: bigint

	if (threshold !== undefined && threshold > 0n) {
		splitOutputs = changeAmt / threshold
		splitOutputs = BigInt(Math.min(Number(splitOutputs), maxOutputs))
	} else {
		splitOutputs = BigInt(maxOutputs)
	}
	splitOutputs = BigInt(Math.max(Number(splitOutputs), 1))

	const baseChangeAmount = changeAmt / splitOutputs
	let remainder = changeAmt % splitOutputs

	for (let i = 0n; i < splitOutputs; i++) {
		let splitAmount = baseChangeAmount
		if (remainder > 0n) {
			splitAmount += 1n
			remainder -= 1n
		}

		const transferInscription: TransferTokenInscription = {
			p: 'bsv-20',
			op: 'transfer',
			amt: splitAmount.toString(),
		}

		let inscription: TransferBSV20Inscription | TransferBSV21Inscription
		if (protocol === TokenType.BSV20) {
			inscription = {
				...transferInscription,
				tick: tokenID,
			} as TransferBSV20Inscription
		} else if (protocol === TokenType.BSV21) {
			inscription = {
				...transferInscription,
				id: tokenID,
			} as TransferBSV21Inscription
		} else {
			throw new Error('Invalid protocol')
		}

		const lockingScript = new OrdP2PKH().lock(
			tokenChangeAddress,
			{
				dataB64: toBase64(toArray(JSON.stringify(inscription), 'utf8')),
				contentType: TOKEN_CONTENT_TYPE,
			},
			splitConfig.omitMetaData ? undefined : stringifyMetaData(metaData),
		)

		const vout = tx.outputs.length
		tx.addOutput({ lockingScript, satoshis: 1 })

		tokenChanges.push({
			id: tokenID,
			satoshis: 1,
			script: toBase64(lockingScript.toBinary()),
			txid: '',
			vout,
			amt: splitAmount.toString(),
		})
	}

	return tokenChanges
}
