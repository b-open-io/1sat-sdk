import './preload'
import { inscribe } from '@1sat/actions'
import { SIGMA_BASKET } from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

// Abort the stale nosend anchor
try {
	await ctx.wallet.abortAction({ reference: 'dXUOUy1kfswUsZHb' })
	console.log('Aborted stale anchor')
} catch (_e) {
	console.log('Abort skipped (already aborted or does not exist)')
}

// Also abort any other nosend txs
const outputs = await ctx.wallet.listOutputs({ basket: SIGMA_BASKET })
console.log('Sigma basket:', outputs.totalOutputs, 'outputs')

const defaultOutputs = await ctx.wallet.listOutputs({ basket: 'default' })
console.log('Default basket:', defaultOutputs.totalOutputs, 'outputs')
for (const o of defaultOutputs.outputs) {
	console.log(`  ${o.outpoint} — ${o.satoshis} sats, spendable: ${o.spendable}`)
}

// Now try sigma inscribe
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#f7931a" stroke="#c16800" stroke-width="2"/>
  <text x="32" y="44" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="#fff">1</text>
</svg>`
const base64Content = Utils.toBase64(Array.from(new TextEncoder().encode(svg)))

console.log('\nRunning sigma inscribe...')
const result = await inscribe.execute(ctx.ctx, {
	base64Content,
	contentType: 'image/svg+xml',
	map: { app: '1sat-sdk-test', type: 'sigma-test' },
	sigma: true,
})

console.log('Result:', JSON.stringify(result, null, 2))

await destroyTestContext(ctx)
