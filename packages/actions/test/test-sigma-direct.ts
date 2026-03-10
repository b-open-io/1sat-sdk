import './preload'
import { inscribe } from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

// Enable debug logging
ctx.ctx.debug = true
ctx.ctx.log = (entry: unknown) => console.log('[LOG]', JSON.stringify(entry, null, 2))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#f7931a" stroke="#c16800" stroke-width="2"/>
  <text x="32" y="44" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="#fff">1</text>
</svg>`
const base64Content = Utils.toBase64(Array.from(new TextEncoder().encode(svg)))

console.log('Running sigma inscribe...')
const result = await inscribe.execute(ctx.ctx, {
	base64Content,
	contentType: 'image/svg+xml',
	map: { app: '1sat-sdk-test', type: 'sigma-test' },
	sigma: true,
})

console.log('Result:', JSON.stringify(result, null, 2))

await destroyTestContext(ctx)
