import './preload'
import {
	createTestContext,
	deriveDepositAddress,
	destroyTestContext,
} from './setup'

async function main() {
	const labels = ['primary', 'seller', 'buyer']
	for (const label of labels) {
		try {
			const ctx = await createTestContext(label)
			const address = await deriveDepositAddress(ctx.wallet)
			console.log(`${label.toUpperCase()}: ${address}`)

			// Check wallet balance
			const outputs = await ctx.wallet.listOutputs({
				basket: 'default',
				limit: 10,
			})
			console.log(`  wallet outputs: ${outputs.totalOutputs}`)

			await destroyTestContext(ctx)
		} catch (e) {
			console.log(`${label.toUpperCase()}: ${(e as Error).message}`)
		}
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
