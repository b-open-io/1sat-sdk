import './preload'
import { ORDINALS_BASKET, SIGMA_BASKET } from '@1sat/types'
import { P2PKH, PublicKey } from '@bsv/sdk'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')
const wallet = ctx.wallet

// Step 1: Create anchor tx (should work - no explicit inputs)
console.log('Step 1: Creating anchor tx...')
const keyID = Date.now().toString()
const { publicKey: anchorPubKey } = await wallet.getPublicKey({
	protocolID: [1, 'onesat'] as [0 | 1 | 2, string],
	keyID: `anchor-${keyID}`,
	counterparty: 'self',
	forSelf: true,
})
const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
const anchorLockingScript = new P2PKH().lock(anchorAddress)

try {
	const anchorResult = await wallet.createAction({
		description: 'Sigma anchor output',
		outputs: [
			{
				lockingScript: anchorLockingScript.toHex(),
				satoshis: 2,
				outputDescription: 'Sigma anchor',
				basket: SIGMA_BASKET,
				customInstructions: JSON.stringify({
					protocolID: [1, 'onesat'],
					keyID: `anchor-${keyID}`,
				}),
			},
		],
		options: {
			signAndProcess: true,
			noSend: true,
			randomizeOutputs: false,
			acceptDelayedBroadcast: true,
		},
	})
	console.log('Anchor txid:', anchorResult.txid)
	console.log('Anchor noSendChange:', anchorResult.noSendChange)

	// Step 2: Create inscription tx spending the anchor
	console.log('\nStep 2: Creating inscription tx spending anchor...')
	const { publicKey } = await wallet.getPublicKey({
		protocolID: [1, 'onesat'] as [0 | 1 | 2, string],
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const address = PublicKey.fromString(publicKey).toAddress()
	const lockingScript = new P2PKH().lock(address)

	try {
		const inscribeResult = await wallet.createAction({
			description: 'Create inscription',
			inputs: [
				{
					outpoint: `${anchorResult.txid}.0`,
					inputDescription: 'Sigma anchor',
					unlockingScriptLength: 108,
				},
			],
			outputs: [
				{
					lockingScript: lockingScript.toHex(),
					satoshis: 1,
					outputDescription: 'Inscription',
					basket: ORDINALS_BASKET,
				},
			],
			options: {
				signAndProcess: false,
				randomizeOutputs: false,
				noSend: true,
				noSendChange: anchorResult.noSendChange,
				knownTxids: [anchorResult.txid!],
				acceptDelayedBroadcast: true,
				trustSelf: 'known',
			},
		})
		console.log(
			'Inscription result reference:',
			inscribeResult.signableTransaction?.reference,
		)
		console.log('SUCCESS: Both steps completed')

		// Abort the inscription (we don't need it)
		if (inscribeResult.signableTransaction?.reference) {
			await wallet.abortAction({
				reference: inscribeResult.signableTransaction.reference,
			})
			console.log('Aborted inscription tx')
		}
	} catch (e) {
		console.error('Step 2 FAILED:', e)
	}

	// Abort the anchor
	// Find its reference
	if (anchorResult.txid) {
		// We can't easily abort by txid, need reference
		// The anchor was noSend so it should have a reference we can look up
		console.log('\nNote: anchor tx is nosend, needs to be aborted manually')
	}
} catch (e) {
	console.error('Step 1 FAILED:', e)
}

await destroyTestContext(ctx)
