import './preload'
import { P2PKH, PublicKey } from '@bsv/sdk'
import { createTestContext, destroyTestContext, syncFunding } from './setup'

const ctx = await createTestContext('primary')

// Check default basket
const outputs = await ctx.wallet.listOutputs({ basket: 'default' })
console.log('Default basket:', outputs.totalOutputs, 'outputs')

let totalSats = 0
for (const out of outputs.outputs) totalSats += out.satoshis
console.log('Total sats:', totalSats)

// Show individual outputs
console.log('\nOutput details:')
for (const out of outputs.outputs) {
	console.log(
		`  ${out.outpoint} — ${out.satoshis} sats, spendable: ${out.spendable}`,
	)
}

// Check other baskets
for (const basket of ['sigma', 'ordinals', 'bsv21']) {
	try {
		const b = await ctx.wallet.listOutputs({ basket })
		if (b.totalOutputs > 0) {
			console.log(`\n${basket} basket: ${b.totalOutputs} outputs`)
			for (const out of b.outputs) {
				console.log(
					`  ${out.outpoint} — ${out.satoshis} sats, spendable: ${out.spendable}`,
				)
			}
		}
	} catch {
		/* basket may not exist */
	}
}

// Try syncFunding to see if we can refresh the server state
console.log('\n--- Attempting syncFunding ---')
try {
	const synced = await syncFunding(ctx)
	console.log('syncFunding internalized:', synced, 'outputs')
} catch (e) {
	console.error('syncFunding failed:', (e as Error).message)
}

// Re-check after sync
const afterSync = await ctx.wallet.listOutputs({ basket: 'default' })
console.log('\nAfter sync — default basket:', afterSync.totalOutputs, 'outputs')
let afterSats = 0
for (const out of afterSync.outputs) afterSats += out.satoshis
console.log('After sync — total sats:', afterSats)

// Try createAction again
try {
	console.log('\nTrying createAction after sync...')
	const keyID = Date.now().toString()
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: [1, 'onesat'] as [0 | 1 | 2, string],
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const lockingScript = new P2PKH().lock(
		PublicKey.fromString(publicKey).toAddress(),
	)

	const result = await ctx.wallet.createAction({
		description: 'Test funding check',
		outputs: [
			{
				lockingScript: lockingScript.toHex(),
				satoshis: 1,
				outputDescription: 'Test output',
			},
		],
		options: { signAndProcess: true, acceptDelayedBroadcast: true },
	})
	console.log('Success! txid:', result.txid)
} catch (e) {
	const err = e as Error & { code?: string; data?: unknown }
	console.error('Failed:', err.message)
	if (err.code) console.error('Error code:', err.code)
	if (err.data) console.error('Error data:', JSON.stringify(err.data, null, 2))
}

await destroyTestContext(ctx)
