import { ORDINALS_BASKET } from '@1sat/types'
import {
	createTestContext,
	deriveDepositAddress,
	destroyTestContext,
} from './setup'

async function main() {
	const labels = ['primary', 'seller', 'buyer']
	for (const label of labels) {
		const ctx = await createTestContext(label)
		const address = await deriveDepositAddress(ctx.wallet)
		const identity = (await ctx.wallet.getPublicKey({ identityKey: true }))
			.publicKey

		console.log(`\n${label.toUpperCase()}:`)
		console.log(`  address:  ${address}`)
		console.log(`  identity: ${identity.slice(0, 16)}...`)

		// Check default basket (funding)
		const defaults = await ctx.wallet.listOutputs({
			basket: 'default',
			limit: 100,
		})
		console.log(
			`  default basket: ${defaults.totalOutputs} outputs, ${defaults.outputs.reduce((s, o) => s + o.satoshis, 0)} sats`,
		)

		// Check 1sat basket (ordinals)
		const ordinals = await ctx.wallet.listOutputs({
			basket: ORDINALS_BASKET,
			limit: 100,
		})
		console.log(`  1sat basket:    ${ordinals.totalOutputs} outputs`)

		await destroyTestContext(ctx)
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
