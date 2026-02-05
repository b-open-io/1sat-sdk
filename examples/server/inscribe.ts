/**
 * Server-side inscription example
 *
 * This demonstrates creating an inscription using private keys directly.
 * Only use this pattern on backends or scripts - never expose keys in browsers.
 *
 * Usage:
 *   WALLET_WIF=your-private-key-wif bun run examples/server/inscribe.ts
 */
import { ONESAT_MAINNET_URL } from '@1sat/constants'
import { ArcadeClient, createOrdinals, fetchPayUtxos } from '@1sat/sdk'
import { PrivateKey, Utils } from '@bsv/sdk'

const { toArray, toBase64 } = Utils

async function main() {
	// Load private key from environment
	const wif = process.env.WALLET_WIF
	if (!wif) {
		console.error('Error: WALLET_WIF environment variable is required')
		console.error(
			'Usage: WALLET_WIF=your-wif bun run examples/server/inscribe.ts',
		)
		process.exit(1)
	}

	const privateKey = PrivateKey.fromWif(wif)
	const address = privateKey.toAddress().toString()
	console.log('Address:', address)

	// Fetch UTXOs
	console.log('Fetching UTXOs...')
	const utxos = await fetchPayUtxos(address)
	console.log(`Found ${utxos.length} UTXOs`)

	if (utxos.length === 0) {
		console.error('No UTXOs found. Fund the address first.')
		process.exit(1)
	}

	// Create inscription
	const text = 'Hello from 1Sat SDK!'
	console.log(`Creating inscription: "${text}"`)

	const result = await createOrdinals({
		utxos,
		destinations: [
			{
				address,
				inscription: {
					dataB64: toBase64(toArray(text, 'utf8')),
					contentType: 'text/plain',
				},
			},
		],
		paymentPk: privateKey,
		changeAddress: address,
	})

	console.log('Transaction built successfully')
	console.log('TXID:', result.tx.id('hex'))

	// Broadcast
	console.log('Broadcasting...')
	const arcade = new ArcadeClient(ONESAT_MAINNET_URL)
	const broadcastResult = await arcade.submitTransactionHex(result.tx.toHex())

	if (
		broadcastResult.txStatus === 'MINED' ||
		broadcastResult.txStatus === 'SEEN_ON_NETWORK' ||
		broadcastResult.txStatus === 'ACCEPTED_BY_NETWORK' ||
		broadcastResult.txStatus === 'IMMUTABLE'
	) {
		console.log('Broadcast successful!')
		console.log(
			`View inscription: https://ordfs.network/${result.tx.id('hex')}_0`,
		)
	} else {
		console.error(
			`Broadcast failed (${broadcastResult.txStatus}):`,
			broadcastResult.extraInfo ?? 'No additional details',
		)
	}
}

main().catch(console.error)
