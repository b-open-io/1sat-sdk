import './preload'
import { inscribe } from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { createTestContext, destroyTestContext } from './setup'

const ctx = await createTestContext('primary')

const content = JSON.stringify({ test: true, ts: Date.now() })
const base64Content = Utils.toBase64(
	Array.from(new TextEncoder().encode(content)),
)

console.log('Running simple (non-sigma) inscribe...')
const result = await inscribe.execute(ctx.ctx, {
	base64Content,
	contentType: 'application/json',
	map: { app: '1sat-sdk-test', type: 'test' },
})

console.log('Result:', JSON.stringify(result, null, 2))

await destroyTestContext(ctx)
