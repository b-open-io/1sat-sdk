import type { Action, OneSatContext } from '../types'

export interface FriendPubKeyRequest {
	friendIdentityKey: string
	protocolID: [number, string]
	keyID: string
}

export interface FriendPubKeyResponse {
	publicKey?: string
	error?: string
}

export const getFriendPublicKey: Action<
	FriendPubKeyRequest,
	FriendPubKeyResponse
> = {
	meta: {
		name: 'getFriendPublicKey',
		description:
			'Derive a public key for a counterparty using Type-42 key derivation',
		category: 'signing',
		inputSchema: {
			type: 'object',
			properties: {
				friendIdentityKey: {
					type: 'string',
					description: 'Counterparty identity key (compressed hex pubkey)',
				},
				protocolID: {
					type: 'array',
					description: 'Protocol ID tuple [securityLevel, protocolName]',
				},
				keyID: { type: 'string', description: 'Key identifier for derivation' },
			},
			required: ['friendIdentityKey', 'protocolID', 'keyID'],
		},
	},

	async execute(
		ctx: OneSatContext,
		input: FriendPubKeyRequest,
	): Promise<FriendPubKeyResponse> {
		try {
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: input.protocolID as [0 | 1 | 2, string],
				keyID: input.keyID,
				counterparty: input.friendIdentityKey,
				forSelf: false,
			})
			return { publicKey }
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) }
		}
	},
}
