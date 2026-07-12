import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hash, Script, Transaction } from '@bsv/sdk'
import OpNS from './opns.js'

// Real on-chain generation pair: parent output 1 is node "s"; the mint spends
// it, mining char 'h' to create "sh".
const PARENT =
	'935e2a477bda8709874c548fda2d504d490891ccfa5f8443705a8b6a3f403fda'
const MINT = '29ad92e000dd59450fec92aa7b178e88219af92a88cad56109d3efda6d9a8c8a'

function loadTx(txid: string): Transaction {
	const hex = readFileSync(
		join(import.meta.dir, 'testdata', `${txid}.hex`),
		'utf8',
	).trim()
	return Transaction.fromHex(hex)
}

describe('OpNS golden vector (s -> sh)', () => {
	const parentTx = loadTx(PARENT)
	const mintTx = loadTx(MINT)

	it('decodes the parent node "s"', () => {
		const node = OpNS.decode(parentTx.outputs[1].lockingScript)
		expect(node).not.toBeNull()
		expect(node?.domain).toBe('s')
	})

	it('rebuilds the three mint outputs byte-identically', () => {
		const node = OpNS.decode(parentTx.outputs[1].lockingScript)
		if (!node) throw new Error('parent did not decode')

		// Extract char, nonce, ownerScript from the real covenant unlock.
		const unlock = mintTx.inputs[0].unlockingScript
		if (!unlock) throw new Error('mint input has no unlocking script')
		const char = unlock.chunks[0].data?.[0] as number
		const nonce = unlock.chunks[1].data as number[]
		const ownerScript = Script.fromBinary(unlock.chunks[2].data as number[])
		expect(char).toBe('h'.charCodeAt(0))
		expect(nonce).toHaveLength(32)

		// Reconstruct the mined solution hash.
		const hash = Hash.sha256(Hash.sha256([...node.pow, char, ...nonce]))
		const domain = node.domain + String.fromCharCode(char)

		const restated = OpNS.lock(
			OpNS.claimBit(node.claimed, char),
			node.domain,
			hash,
		)
		const child = OpNS.lock([0], domain, hash)
		const inscription = OpNS.buildInscription(domain, ownerScript)

		expect(restated.toHex()).toBe(mintTx.outputs[0].lockingScript.toHex())
		expect(child.toHex()).toBe(mintTx.outputs[1].lockingScript.toHex())
		expect(inscription.toHex()).toBe(mintTx.outputs[2].lockingScript.toHex())
	})

	it('validates the mined nonce against difficulty', () => {
		const node = OpNS.decode(parentTx.outputs[1].lockingScript)
		if (!node) throw new Error('parent did not decode')
		const unlock = mintTx.inputs[0].unlockingScript
		if (!unlock) throw new Error('mint input has no unlocking script')
		const char = unlock.chunks[0].data?.[0] as number
		const nonce = unlock.chunks[1].data as number[]
		expect(OpNS.testSolution(node.pow, char, nonce)).not.toBeNull()
	})

	it('rebuilds the covenant unlock (incl. BIP-143 preimage) byte-identically', async () => {
		const realUnlock = mintTx.inputs[0].unlockingScript
		if (!realUnlock) throw new Error('mint input has no unlocking script')
		const char = realUnlock.chunks[0].data?.[0] as number
		const nonce = realUnlock.chunks[1].data as number[]
		const ownerScript = Script.fromBinary(realUnlock.chunks[2].data as number[])

		// Attach the parent as input 0's source so the preimage can commit to
		// its satoshis and locking script.
		mintTx.inputs[0].sourceTransaction = parentTx

		const rebuilt = await OpNS.unlock(char, nonce, ownerScript).sign(mintTx, 0)
		expect(rebuilt.toHex()).toBe(realUnlock.toHex())
	})
})
