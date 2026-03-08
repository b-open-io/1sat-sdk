/**
 * Lightweight paymail client for P2P payments.
 *
 * Handles SRV resolution via Google DoH with a fix for Cloudflare-managed
 * zones that return NOERROR with empty answers instead of NXDOMAIN.
 */

const DOH_URL = 'https://dns.google.com/resolve'

const P2P_PAYMENT_DESTINATION = '2a40af698840'
const P2P_RECEIVE_BEEF = '5c55a7fdb7bb'
const P2P_RECEIVE_TX = '5f1323cddf31'

const capabilityCache = new Map<string, Record<string, string>>()

export interface P2pDestination {
	reference: string
	outputs: { script: string; satoshis: number }[]
}

export interface P2pSendResult {
	txid: string
	note?: string
}

async function resolveHost(domain: string): Promise<{ host: string; port: number }> {
	const resp = await fetch(`${DOH_URL}?name=_bsvalias._tcp.${domain}&type=SRV&cd=0`)
	const doh = await resp.json()

	// NXDOMAIN or NOERROR with no answer — fall back to domain:443
	if (doh.Status === 3 || !doh.Answer?.length) {
		return { host: domain, port: 443 }
	}

	// Parse SRV answer: "priority weight port target"
	const parts = doh.Answer[0].data.split(' ')
	let target = parts[3]
	if (target.endsWith('.')) target = target.slice(0, -1)

	// If DNSSEC-validated, trust the target. Otherwise require domain match.
	if (!doh.AD) {
		const norm = (d: string) => d.replace(/\.$/, '')
		const a = norm(domain)
		const b = norm(target)
		if (a !== b && !a.endsWith('.' + b) && !b.endsWith('.' + a)) {
			// Untrusted redirect — fall back to domain
			return { host: domain, port: 443 }
		}
	}

	return { host: target, port: parseInt(parts[2]) }
}

async function getCapabilities(domain: string): Promise<Record<string, string>> {
	const cached = capabilityCache.get(domain)
	if (cached) return cached

	const { host, port } = await resolveHost(domain)
	const resp = await fetch(`https://${host}:${port}/.well-known/bsvalias`)
	const json = await resp.json()
	const caps = json.capabilities as Record<string, string>
	capabilityCache.set(domain, caps)
	return caps
}

function resolveUrl(template: string, alias: string, domain: string): string {
	return template.replace('{alias}', alias).replace('{domain.tld}', domain)
}

export async function getP2pPaymentDestination(
	paymail: string,
	satoshis: number,
): Promise<P2pDestination> {
	const [alias, domain] = paymail.split('@')
	const caps = await getCapabilities(domain)
	const url = caps[P2P_PAYMENT_DESTINATION]
	if (!url) throw new Error(`${domain} does not support P2P payment destinations`)

	const resp = await fetch(resolveUrl(url, alias, domain), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ satoshis }),
	})
	if (!resp.ok) throw new Error(`P2P destination request failed: ${resp.status}`)
	return await resp.json()
}

export async function sendBeefP2P(
	paymail: string,
	beefHex: string,
	reference: string,
): Promise<P2pSendResult> {
	const [alias, domain] = paymail.split('@')
	const caps = await getCapabilities(domain)

	// Prefer receive-beef, fall back to receive-transaction
	const beefUrl = caps[P2P_RECEIVE_BEEF]
	if (beefUrl) {
		const resp = await fetch(resolveUrl(beefUrl, alias, domain), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ beef: beefHex, reference }),
		})
		if (!resp.ok) throw new Error(`P2P beef send failed: ${resp.status}`)
		return await resp.json()
	}

	const txUrl = caps[P2P_RECEIVE_TX]
	if (!txUrl) throw new Error(`${domain} does not support P2P receive`)

	const resp = await fetch(resolveUrl(txUrl, alias, domain), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hex: beefHex, reference }),
	})
	if (!resp.ok) throw new Error(`P2P send failed: ${resp.status}`)
	return await resp.json()
}
