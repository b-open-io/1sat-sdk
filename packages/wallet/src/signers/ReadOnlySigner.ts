import {
	type Counterparty,
	type KeyDeriverApi,
	type PrivateKey,
	PublicKey,
	type WalletProtocol,
} from '@bsv/sdk'

/**
 * A mock PrivateKey that only supports toPublicKey().
 * All other operations throw.
 */
class ReadOnlyPrivateKey {
	private publicKey: PublicKey

	constructor(publicKeyHex: string) {
		this.publicKey = PublicKey.fromString(publicKeyHex)
	}

	toPublicKey(): PublicKey {
		return this.publicKey
	}

	toString(): string {
		return this.publicKey.toString()
	}

	toHex(): string {
		return this.publicKey.toString()
	}
}

/**
 * A read-only KeyDeriver that exposes an identity key but throws on any signing/derivation operation.
 * Used when the wallet is instantiated with only a public key.
 */
export class ReadOnlySigner implements KeyDeriverApi {
	readonly identityKey: string
	readonly rootKey: PrivateKey

	constructor(identityPublicKey: string) {
		this.identityKey = identityPublicKey
		this.rootKey = new ReadOnlyPrivateKey(
			identityPublicKey,
		) as unknown as PrivateKey
	}

	derivePrivateKey(
		_protocolID: WalletProtocol,
		_keyID: string,
		_counterparty: Counterparty,
	): never {
		throw new Error('Cannot derive private key in read-only mode')
	}

	derivePublicKey(
		_protocolID: WalletProtocol,
		_keyID: string,
		_counterparty: Counterparty,
		_forSelf?: boolean,
	): never {
		throw new Error('Cannot derive public key in read-only mode')
	}

	deriveSymmetricKey(
		_protocolID: WalletProtocol,
		_keyID: string,
		_counterparty: Counterparty,
	): never {
		throw new Error('Cannot derive symmetric key in read-only mode')
	}

	revealCounterpartySecret(_counterparty: Counterparty): never {
		throw new Error('Cannot reveal secrets in read-only mode')
	}

	revealSpecificSecret(
		_counterparty: Counterparty,
		_protocolID: WalletProtocol,
		_keyID: string,
	): never {
		throw new Error('Cannot reveal secrets in read-only mode')
	}
}
