/**
 * Smoke test for the MCP server's BRC-31 auth flow.
 * Run with: bun run scripts/test-mcp-auth.ts
 * Requires the MCP server to be running on port 3322.
 */

const MCP_URL = 'http://127.0.0.1:3322'

async function testAuthDiscovery() {
	console.log('1. Testing auth discovery...')
	const res = await fetch(`${MCP_URL}/.well-known/auth`)
	if (!res.ok) throw new Error(`Discovery failed: ${res.status}`)
	const data = await res.json()
	if (!data.identityKey) throw new Error('No identityKey in discovery response')
	if (!data.authrite) throw new Error('No authrite version')
	console.log(`   Server identity: ${data.identityKey.slice(0, 12)}...`)
	console.log('   PASS')
	return data
}

async function testUnauthenticatedRejection() {
	console.log('2. Testing unauthenticated MCP request is rejected...')
	const res = await fetch(`${MCP_URL}/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({}),
	})
	if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`)
	console.log('   PASS (401 Unauthorized)')
}

async function testHandshake() {
	console.log('3. Testing BRC-31 handshake...')
	// Generate a random client nonce
	const nonceBytes = new Uint8Array(32)
	crypto.getRandomValues(nonceBytes)
	const clientNonce = btoa(String.fromCharCode(...Array.from(nonceBytes)))

	// Use a dummy identity key (won't verify but tests the handshake flow)
	const res = await fetch(`${MCP_URL}/.well-known/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			messageType: 'initialRequest',
			identityKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
			nonce: clientNonce,
		}),
	})
	if (!res.ok) throw new Error(`Handshake failed: ${res.status}`)
	const data = await res.json()
	if (!data.signature) throw new Error('No signature in handshake response')
	if (data.yourNonce !== clientNonce) throw new Error('Server did not echo client nonce')
	console.log(`   Server nonce: ${data.nonce.slice(0, 16)}...`)
	console.log(`   Signature: ${data.signature.slice(0, 16)}...`)
	console.log('   PASS')
}

async function testNotFound() {
	console.log('4. Testing 404 for unknown endpoint...')
	const res = await fetch(`${MCP_URL}/nonexistent`)
	if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`)
	console.log('   PASS')
}

async function main() {
	console.log(`\nMCP Server Smoke Test (${MCP_URL})\n${'='.repeat(40)}\n`)

	try {
		await fetch(`${MCP_URL}/.well-known/auth`, { signal: AbortSignal.timeout(2000) })
	} catch {
		console.error('MCP server is not running on port 3322.')
		console.error('Start the wallet-desktop app first: bun run dev')
		process.exit(1)
	}

	let passed = 0
	let failed = 0

	for (const test of [testAuthDiscovery, testUnauthenticatedRejection, testHandshake, testNotFound]) {
		try {
			await test()
			passed++
		} catch (err) {
			console.error(`   FAIL: ${err instanceof Error ? err.message : String(err)}`)
			failed++
		}
	}

	console.log(`\n${'='.repeat(40)}`)
	console.log(`Results: ${passed} passed, ${failed} failed`)
	process.exit(failed > 0 ? 1 : 0)
}

main()
