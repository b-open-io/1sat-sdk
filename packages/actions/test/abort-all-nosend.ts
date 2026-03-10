import './preload'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

const ref = 'oetBCrOA+lPP/Z+n'
console.log('Aborting:', ref)
const result = await ctx.wallet.abortAction({ reference: ref })
console.log('Result:', result)

const outputs = await ctx.wallet.listOutputs({ basket: 'default' })
console.log('\nDefault:', outputs.totalOutputs, 'outputs')
for (const o of outputs.outputs) {
	console.log(`  ${o.outpoint} — ${o.satoshis} sats`)
}

await destroyTestContext(ctx)
