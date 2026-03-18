import type { Action, OneSatContext } from '../types'

export interface EncryptRequest {
	plaintext: number[]
	protocolID: [number, string]
	keyID: string
	counterparty: string
}

export interface EncryptResponse {
	ciphertext?: number[]
	error?: string
}

export interface DecryptRequest {
	ciphertext: number[]
	protocolID: [number, string]
	keyID: string
	counterparty: string
}

export interface DecryptResponse {
	plaintext?: number[]
	error?: string
}

export const encryptForCounterparty: Action<EncryptRequest, EncryptResponse> = {
	meta: {
		name: 'encryptForCounterparty',
		description: 'Encrypt data for a counterparty using Type-42 key derivation',
		category: 'signing',
		inputSchema: {
			type: 'object',
			properties: {
				plaintext: { type: 'array', description: 'Plaintext bytes to encrypt' },
				protocolID: {
					type: 'array',
					description: 'Protocol ID tuple [securityLevel, protocolName]',
				},
				keyID: { type: 'string', description: 'Key identifier for derivation' },
				counterparty: {
					type: 'string',
					description: 'Counterparty identity key or "self"',
				},
			},
			required: ['plaintext', 'protocolID', 'keyID', 'counterparty'],
		},
	},

	async execute(
		ctx: OneSatContext,
		input: EncryptRequest,
	): Promise<EncryptResponse> {
		try {
			const { ciphertext } = await ctx.wallet.encrypt({
				protocolID: input.protocolID as [0 | 1 | 2, string],
				keyID: input.keyID,
				counterparty: input.counterparty,
				plaintext: input.plaintext,
			})
			return { ciphertext }
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) }
		}
	},
}

export const decryptFromCounterparty: Action<DecryptRequest, DecryptResponse> =
	{
		meta: {
			name: 'decryptFromCounterparty',
			description:
				'Decrypt data from a counterparty using Type-42 key derivation',
			category: 'signing',
			inputSchema: {
				type: 'object',
				properties: {
					ciphertext: {
						type: 'array',
						description: 'Ciphertext bytes to decrypt',
					},
					protocolID: {
						type: 'array',
						description: 'Protocol ID tuple [securityLevel, protocolName]',
					},
					keyID: {
						type: 'string',
						description: 'Key identifier for derivation',
					},
					counterparty: {
						type: 'string',
						description: 'Counterparty identity key or "self"',
					},
				},
				required: ['ciphertext', 'protocolID', 'keyID', 'counterparty'],
			},
		},

		async execute(
			ctx: OneSatContext,
			input: DecryptRequest,
		): Promise<DecryptResponse> {
			try {
				const { plaintext } = await ctx.wallet.decrypt({
					protocolID: input.protocolID as [0 | 1 | 2, string],
					keyID: input.keyID,
					counterparty: input.counterparty,
					ciphertext: input.ciphertext,
				})
				return { plaintext }
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) }
			}
		},
	}
