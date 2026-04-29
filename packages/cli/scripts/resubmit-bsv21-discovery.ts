/**
 * One-off recovery script: re-submit a BSV21 deploy tx to the discovery
 * overlay topic (tm_bsv21).
 *
 * Use when a deploy was broadcast on-chain but didn't reach the overlay
 * (e.g. previous URL bug, network blip, server downtime).
 *
 * Usage: bun run scripts/resubmit-bsv21-discovery.ts <txid>
 */

import { OneSatServices } from '@1sat/client'

const txid = process.argv[2]
if (!txid || !/^[0-9a-f]{64}$/i.test(txid)) {
	console.error(
		'Usage: bun run scripts/resubmit-bsv21-discovery.ts <txid>\n' +
			'  txid must be a 64-char hex string',
	)
	process.exit(1)
}

const services = new OneSatServices('main')

console.log(`Fetching BEEF for ${txid}...`)
const beef = await services.getBeefForTxid(txid)
console.log(`  beef has ${beef.txs.length} txs and ${beef.bumps.length} bumps`)

const atomicBeef = beef.toBinaryAtomic(txid)
console.log(`  atomic BEEF size: ${atomicBeef.length} bytes`)

console.log('Submitting to tm_bsv21 discovery topic...')
const result = await services.overlay.submitBsv21Discovery(atomicBeef)
console.log('Result:', result)
