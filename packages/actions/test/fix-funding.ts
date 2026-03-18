import './preload'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

// Abort in reverse dependency order: unsigned first, then nosend
const refs = [
	{ ref: 'JHd13qSMcLit+S53', desc: 'unsigned inscription (tx 572)' },
	{ ref: 'gn73sok4drnyikIM', desc: 'unsigned inscription (tx 570)' },
	{ ref: 'oetBCrOA+lPP/Z+n', desc: 'nosend anchor (tx 569)' },
	{ ref: '49bu5x7VlQcjp2qq', desc: 'nosend anchor (tx 571)' },
]

for (const { ref, desc } of refs) {
	try {
		const result = await ctx.wallet.abortAction({ reference: ref })
		console.log(`Aborted ${desc}: ${JSON.stringify(result)}`)
	} catch (e) {
		console.error(`Failed ${desc}: ${(e as Error).message}`)
	}
}

// Verify
const outputs = await ctx.wallet.listOutputs({ basket: 'default', limit: 100 })
console.log('\nDefault basket:', outputs.totalOutputs, 'outputs')
let total = 0
for (const o of outputs.outputs) {
	total += o.satoshis
	console.log(`  ${o.outpoint} — ${o.satoshis} sats, spendable: ${o.spendable}`)
}
console.log('Total:', total, 'sats')

await destroyTestContext(ctx)
