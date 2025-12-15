/**
 * sendOrdinals - Send existing ordinals to new addresses
 */

import type { ChangeResult, SendOrdinalsConfig } from '@1sat/types'
import { stringifyMetaData } from '@1sat/utils'
import { TxBuilder } from '../builder'

/**
 * Sends ordinals to the given destinations
 *
 * @param config - Configuration for sending ordinals
 * @returns Transaction result with spent outpoints and change UTXO
 *
 * @example
 * ```typescript
 * const result = await sendOrdinals({
 *   paymentUtxos: payUtxos,
 *   ordinals: nftUtxos,
 *   paymentPk: paymentKey,
 *   ordPk: ordinalKey,
 *   destinations: [{ address: 'addr1...' }],
 *   changeAddress: 'addr2...',
 * })
 * ```
 */
export async function sendOrdinals(
	config: SendOrdinalsConfig,
): Promise<ChangeResult> {
	const {
		paymentUtxos,
		ordinals,
		paymentPk,
		ordPk,
		destinations,
		satsPerKb,
		metaData,
		signer,
		additionalPayments = [],
		enforceUniformSend = true,
		signInputs = true,
	} = config

	// Validate ordinal count matches destination count
	if (enforceUniformSend && destinations.length !== ordinals.length) {
		throw new Error(
			'Number of destinations must match number of ordinals being sent',
		)
	}

	// Determine change address
	const changeAddress = config.changeAddress ?? paymentPk?.toAddress()
	if (!changeAddress) {
		throw new Error('Either changeAddress or paymentPk is required')
	}

	// Stringify metadata
	const stringifiedMetaData = stringifyMetaData(metaData)

	// Build transaction
	const builder = new TxBuilder({ satsPerKb, signInputs })

	// Add ordinal inputs first (important for output ordering)
	builder.addOrdinalInputs(ordinals, ordPk)

	// Add ordinal outputs
	for (const dest of destinations) {
		if (dest.inscription) {
			builder.addOrdinalOutput(
				dest.address,
				dest.inscription,
				stringifiedMetaData,
			)
		} else {
			builder.addOrdinalOutput(dest.address)
		}
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
	await builder.addPaymentInputs(paymentUtxos, paymentPk)

	// Build and return
	return builder.build()
}
