/**
 * createOrdinals - Create new ordinal inscriptions
 */

import type {
	ChangeResult,
	CreateOrdinalsCollectionConfig,
	CreateOrdinalsCollectionItemConfig,
	CreateOrdinalsConfig,
} from '@1sat/types'
import { stringifyMetaData } from '@1sat/utils'
import { TxBuilder } from '../builder'

/**
 * Creates a transaction with inscription outputs
 *
 * @param config - Configuration for creating ordinals
 * @returns Transaction result with change UTXO
 *
 * @example
 * ```typescript
 * const result = await createOrdinals({
 *   utxos: paymentUtxos,
 *   destinations: [
 *     { address: 'addr1...', inscription: { dataB64: '...', contentType: 'image/png' } }
 *   ],
 *   paymentPk: privateKey,
 *   changeAddress: 'addr2...',
 * })
 * ```
 */
export async function createOrdinals(
	config:
		| CreateOrdinalsConfig
		| CreateOrdinalsCollectionConfig
		| CreateOrdinalsCollectionItemConfig,
): Promise<ChangeResult> {
	const {
		utxos,
		destinations,
		paymentPk,
		satsPerKb,
		metaData,
		signer,
		additionalPayments = [],
		signInputs = true,
	} = config

	// Validate destinations
	for (const dest of destinations) {
		if (!dest.inscription) {
			throw new Error('Inscription is required for all destinations')
		}
	}

	// Warn if creating many inscriptions
	if (destinations.length > 100) {
		console.warn(
			'Creating many inscriptions at once can be slow. Consider batching.',
		)
	}

	// Determine change address
	const changeAddress = config.changeAddress ?? paymentPk?.toAddress()
	if (!changeAddress) {
		throw new Error('Either changeAddress or paymentPk is required')
	}

	// Stringify metadata (converts objects/arrays to strings)
	const stringifiedMetaData = stringifyMetaData(metaData)

	// Build transaction
	const builder = new TxBuilder({ satsPerKb, signInputs })

	// Add inscription outputs
	for (const dest of destinations) {
		builder.addOrdinalOutput(
			dest.address,
			dest.inscription,
			stringifiedMetaData,
		)
	}

	// Add additional payments
	if (additionalPayments.length > 0) {
		builder.addPayments(additionalPayments)
	}

	// Set change address
	builder.setChangeAddress(changeAddress)

	// Set signer if provided
	if (signer) {
		builder.setSigner(signer)
	}

	// Add payment inputs
	await builder.addPaymentInputs(utxos, paymentPk)

	// Build and return
	return builder.build()
}
