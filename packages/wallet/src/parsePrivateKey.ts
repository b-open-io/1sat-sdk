import { PrivateKey } from '@bsv/sdk'

/**
 * Parse a key into `PrivateKeyClass`, the SDK class the consuming toolbox
 * uses. A `PrivateKey` from another `@bsv/sdk` build is copied by value.
 */
export function parsePrivateKey(
	input: PrivateKey | string,
	PrivateKeyClass: typeof PrivateKey = PrivateKey,
): PrivateKey {
	if (typeof input !== 'string') {
		// TypeScript cannot model a PrivateKey from another SDK build, which
		// fails `instanceof PrivateKeyClass` while still being a PrivateKey.
		return input instanceof PrivateKeyClass
			? input
			: new PrivateKeyClass((input as PrivateKey).toHex(), 'hex')
	}

	if (/^[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(input)) {
		return PrivateKeyClass.fromWif(input)
	}

	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return new PrivateKeyClass(input)
	}

	try {
		return PrivateKeyClass.fromWif(input)
	} catch {
		throw new Error(
			'Invalid private key format. Expected PrivateKey instance, WIF string, or 64-char hex string.',
		)
	}
}
