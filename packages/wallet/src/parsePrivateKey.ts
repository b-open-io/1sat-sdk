import { PrivateKey } from '@bsv/sdk'

export function parsePrivateKey(input: PrivateKey | string): PrivateKey {
	if (input instanceof PrivateKey) {
		return input
	}

	if (/^[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(input)) {
		return PrivateKey.fromWif(input)
	}

	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return new PrivateKey(input)
	}

	try {
		return PrivateKey.fromWif(input)
	} catch {
		throw new Error(
			'Invalid private key format. Expected PrivateKey instance, WIF string, or 64-char hex string.',
		)
	}
}
