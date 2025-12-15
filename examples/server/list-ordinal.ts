/**
 * Server-side ordinal listing example
 *
 * Demonstrates listing an ordinal for sale using OrdLock contract.
 * Only use this pattern on backends or scripts - never expose keys in browsers.
 *
 * Usage:
 *   PAYMENT_WIF=... ORD_WIF=... OUTPOINT=... PRICE=... bun run examples/server/list-ordinal.ts
 */
import {
	createBroadcaster,
	createOrdListings,
	fetchNftUtxos,
	fetchPayUtxos,
} from '@1sat/sdk'
import { PrivateKey } from '@bsv/sdk'

async function main() {
	// Load configuration from environment
	const paymentWif = process.env.PAYMENT_WIF
	const ordWif = process.env.ORD_WIF
	const outpoint = process.env.OUTPOINT
	const priceStr = process.env.PRICE

	if (!paymentWif || !ordWif || !outpoint || !priceStr) {
		console.error('Required environment variables:')
		console.error('  PAYMENT_WIF - Private key for paying fees')
		console.error('  ORD_WIF     - Private key holding the ordinal')
		console.error('  OUTPOINT    - Ordinal outpoint (txid_vout)')
		console.error('  PRICE       - Listing price in satoshis')
		process.exit(1)
	}

	const price = Number.parseInt(priceStr, 10)

	const paymentPk = PrivateKey.fromWif(paymentWif)
	const ordPk = PrivateKey.fromWif(ordWif)
	const paymentAddress = paymentPk.toAddress().toString()
	const ordAddress = ordPk.toAddress().toString()

	console.log('Payment Address:', paymentAddress)
	console.log('Ordinal Address:', ordAddress)
	console.log('Outpoint:', outpoint)
	console.log('Price:', price, 'satoshis')

	// Fetch UTXOs
	console.log('\nFetching UTXOs...')
	const utxos = await fetchPayUtxos(paymentAddress)
	console.log(`Found ${utxos.length} payment UTXOs`)

	// Fetch the ordinal UTXO
	const nftUtxos = await fetchNftUtxos(ordAddress)
	const ordinal = nftUtxos.find((u) => `${u.txid}_${u.vout}` === outpoint)

	if (!ordinal) {
		console.error('Ordinal not found at outpoint:', outpoint)
		console.error(
			'Available ordinals:',
			nftUtxos.map((u) => `${u.txid}_${u.vout}`).join(', '),
		)
		process.exit(1)
	}

	if (utxos.length === 0) {
		console.error('No payment UTXOs found. Fund the payment address first.')
		process.exit(1)
	}

	// Build listing transaction
	console.log('\nBuilding listing transaction...')
	const result = await createOrdListings({
		utxos,
		listings: [
			{
				payAddress: paymentAddress,
				price,
				listingUtxo: ordinal,
				ordPk,
			},
		],
		paymentPk,
		changeAddress: paymentAddress,
	})

	console.log('Transaction built successfully')
	console.log('TXID:', result.tx.id('hex'))

	// Broadcast
	console.log('\nBroadcasting...')
	const broadcaster = createBroadcaster()
	const broadcastResult = await broadcaster.broadcast(result.tx)

	if (broadcastResult.status === 'success') {
		console.log('Listing created successfully!')
		console.log(`Listed ordinal for ${price} satoshis`)
		console.log('Listing outpoint:', `${result.tx.id('hex')}_0`)
	} else {
		console.error('Broadcast failed:', broadcastResult.description)
	}
}

main().catch(console.error)
