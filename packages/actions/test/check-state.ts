import './preload'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')
const outputs = await ctx.wallet.listOutputs({ basket: 'default', limit: 100 })
console.log('Default basket:', outputs.totalOutputs, 'outputs')
for (const o of outputs.outputs) console.log('  ', o.outpoint, '—', o.satoshis, 'sats, spendable:', o.spendable)

// Check sigma basket too
const sigma = await ctx.wallet.listOutputs({ basket: 'sigma', limit: 100 })
console.log('\nSigma basket:', sigma.totalOutputs, 'outputs')
for (const o of sigma.outputs) console.log('  ', o.outpoint, '—', o.satoshis, 'sats, spendable:', o.spendable)

await destroyTestContext(ctx)
