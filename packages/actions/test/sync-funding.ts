import {
	createTestContext,
	deriveDepositAddress,
	destroyTestContext,
	syncFunding,
} from './setup'

async function main() {
	const labels = ['primary', 'seller', 'buyer']
	for (const label of labels) {
		try {
			const ctx = await createTestContext(label)
			const address = await deriveDepositAddress(ctx.wallet)
			console.log(`\n${label.toUpperCase()} (${address}):`)

			const count = await syncFunding(ctx)
			console.log(`  internalized: ${count} outputs`)

			const outputs = await ctx.wallet.listOutputs({
				basket: 'default',
				limit: 100,
			})
			console.log(`  wallet outputs: ${outputs.totalOutputs}`)
			for (const o of outputs.outputs) {
				console.log(`    ${o.outpoint} — ${o.satoshis} sats`)
			}

			await destroyTestContext(ctx)
		} catch (e) {
			console.error(`${label.toUpperCase()}: ${(e as Error).message}`)
		}
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
