import { ArcadeClient } from '@1sat/client'
/**
 * Server-side token transfer example
 *
 * Demonstrates transferring BSV21 tokens using private keys directly.
 * Only use this pattern on backends or scripts - never expose keys in browsers.
 *
 * Usage:
 *   PAYMENT_WIF=... ORD_WIF=... TOKEN_ID=... RECIPIENT=... bun run examples/server/token-transfer.ts
 */
import {
	TokenType,
	fetchPayUtxos,
	fetchTokenUtxos,
	selectTokenUtxos,
	transferOrdTokens,
} from '@1sat/core'
import { ONESAT_MAINNET_URL } from '@1sat/types'
import { PrivateKey } from '@bsv/sdk'

async function main() {
	// Load configuration from environment
	const paymentWif = process.env.PAYMENT_WIF
	const ordWif = process.env.ORD_WIF
	const tokenId = process.env.TOKEN_ID
	const recipient = process.env.RECIPIENT
	const amountStr = process.env.AMOUNT ?? '100'

	if (!paymentWif || !ordWif || !tokenId || !recipient) {
		console.error('Required environment variables:')
		console.error('  PAYMENT_WIF - Private key for paying fees')
		console.error('  ORD_WIF     - Private key holding the tokens')
		console.error('  TOKEN_ID    - Token origin (e.g., txid_0)')
		console.error('  RECIPIENT   - Destination address')
		console.error('  AMOUNT      - Amount to transfer (default: 100)')
		process.exit(1)
	}

	const amount = Number.parseInt(amountStr, 10)
	const decimals = Number.parseInt(process.env.DECIMALS ?? '8', 10)

	const paymentPk = PrivateKey.fromWif(paymentWif)
	const ordPk = PrivateKey.fromWif(ordWif)
	const paymentAddress = paymentPk.toAddress().toString()
	const ordAddress = ordPk.toAddress().toString()

	console.log('Payment Address:', paymentAddress)
	console.log('Ordinal Address:', ordAddress)
	console.log('Token ID:', tokenId)
	console.log('Recipient:', recipient)
	console.log('Amount:', amount)

	// Fetch UTXOs
	console.log('\nFetching UTXOs...')
	const utxos = await fetchPayUtxos(paymentAddress)
	console.log(`Found ${utxos.length} payment UTXOs`)

	const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, tokenId, ordAddress)
	console.log(`Found ${tokenUtxos.length} token UTXOs`)

	if (utxos.length === 0) {
		console.error('No payment UTXOs found. Fund the payment address first.')
		process.exit(1)
	}

	if (tokenUtxos.length === 0) {
		console.error('No token UTXOs found. The ordinal address has no tokens.')
		process.exit(1)
	}

	// Select tokens for transfer
	const { selectedUtxos, isEnough } = selectTokenUtxos(
		tokenUtxos,
		amount,
		decimals,
	)

	if (!isEnough) {
		console.error('Insufficient token balance for transfer')
		process.exit(1)
	}

	console.log(`Selected ${selectedUtxos.length} token UTXOs for transfer`)

	// Build transfer transaction
	console.log('\nBuilding transfer transaction...')
	const result = await transferOrdTokens({
		protocol: TokenType.BSV21,
		tokenID: tokenId,
		decimals,
		utxos,
		inputTokens: selectedUtxos,
		distributions: [{ address: recipient, tokens: amount }],
		paymentPk,
		ordPk,
		changeAddress: paymentAddress,
		tokenChangeAddress: ordAddress,
	})

	console.log('Transaction built successfully')
	console.log('TXID:', result.tx.id('hex'))

	// Broadcast
	console.log('\nBroadcasting...')
	const arcade = new ArcadeClient(ONESAT_MAINNET_URL)
	const broadcastResult = await arcade.submitTransactionHex(result.tx.toHex())

	if (
		broadcastResult.txStatus === 'MINED' ||
		broadcastResult.txStatus === 'SEEN_ON_NETWORK' ||
		broadcastResult.txStatus === 'ACCEPTED_BY_NETWORK' ||
		broadcastResult.txStatus === 'IMMUTABLE'
	) {
		console.log('Transfer successful!')
		console.log(`Transferred ${amount} tokens to ${recipient}`)
	} else {
		console.error(
			`Broadcast failed (${broadcastResult.txStatus}):`,
			broadcastResult.extraInfo ?? 'No additional details',
		)
	}
}

main().catch(console.error)
