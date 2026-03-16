import {
	BigNumber,
	ECDSA,
	type PrivateKey,
	type Signature,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/**
 * Unified signing interface for message signing operations.
 *
 * Abstracts the difference between raw PrivateKey and BRC-100
 * WalletInterface so templates don't need to know which signing
 * backend is in use.
 */
export interface Signer {
	/** Sign a pre-computed hash. Returns DER-encoded signature bytes. */
	signHash: (hash: number[]) => Promise<number[]>
	/** Returns the compressed public key as a hex string. */
	getPublicKey: () => Promise<string>
}

/**
 * Signer adapter for a raw PrivateKey.
 */
export class PrivateKeySigner implements Signer {
	constructor(private readonly privateKey: PrivateKey) {}

	async signHash(hash: number[]): Promise<number[]> {
		const sig = ECDSA.sign(new BigNumber(hash), this.privateKey) as Signature
		return sig.toDER() as number[]
	}

	async getPublicKey(): Promise<string> {
		return this.privateKey.toPublicKey().toString()
	}
}

/**
 * Signer adapter for a BRC-100 WalletInterface.
 *
 * Uses wallet.createSignature with hashToDirectlySign and
 * wallet.getPublicKey for key derivation via protocolID/keyID.
 */
export class WalletSigner implements Signer {
	constructor(
		private readonly wallet: WalletInterface,
		private readonly protocolID: WalletProtocol,
		private readonly keyID: string,
		private readonly counterparty: string = 'self',
	) {}

	async signHash(hash: number[]): Promise<number[]> {
		const { signature } = await this.wallet.createSignature({
			protocolID: this.protocolID,
			keyID: this.keyID,
			counterparty: this.counterparty,
			hashToDirectlySign: hash,
		})
		return Array.from(signature)
	}

	async getPublicKey(): Promise<string> {
		const { publicKey } = await this.wallet.getPublicKey({
			protocolID: this.protocolID,
			keyID: this.keyID,
			counterparty: this.counterparty,
			forSelf: true,
		})
		return publicKey
	}
}
