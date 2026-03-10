import './preload'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

// Abort the nosend anchor tx from a previous failed sigma attempt
const reference = 'eEsRS4fhhRD8FKRo'
console.log('Aborting nosend tx 0efb9335... with reference:', reference)

try {
	const result = await ctx.wallet.abortAction({ reference })
	console.log('Abort result:', result)
} catch (e) {
	console.error('Abort failed:', e)
}

// Check state after abort
const outputs = await ctx.wallet.listOutputs({ basket: 'default' })
console.log('\nDefault basket after abort:', outputs.totalOutputs, 'outputs')
for (const o of outputs.outputs) {
	console.log(`  ${o.outpoint} — ${o.satoshis} sats, spendable: ${o.spendable}`)
}

await destroyTestContext(ctx)
