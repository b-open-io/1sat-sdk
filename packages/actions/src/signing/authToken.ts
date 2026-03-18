import { BSM, BigNumber, Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import type { Action, OneSatContext } from '../types'

const { toArray, toHex } = Utils

const AUTH_PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'bitcoin-auth']
const AUTH_KEY_ID = 'auth-0'

export interface AuthTokenRequest {
	requestPath: string
	body?: string
	scheme?: 'brc77' | 'bsm'
	bodyEncoding?: 'utf8' | 'hex' | 'base64'
	timestamp?: string
}

export interface AuthTokenResponse {
	authToken?: string
	error?: string
}

function compactSign(
	derSig: number[],
	msgHash: number[],
	pubKeyHex: string,
): string {
	const sig = Signature.fromDER(toHex(derSig), 'hex')
	const pubKey = PublicKey.fromString(pubKeyHex)
	const recovery = sig.CalculateRecoveryFactor(pubKey, new BigNumber(msgHash))
	return sig.toCompact(recovery, true, 'base64') as string
}

export const getAuthToken: Action<AuthTokenRequest, AuthTokenResponse> = {
	meta: {
		name: 'getAuthToken',
		description: 'Generate a BRC-77 or BSM auth token for HTTP request signing',
		category: 'signing',
		inputSchema: {
			type: 'object',
			properties: {
				requestPath: {
					type: 'string',
					description: 'API endpoint path including query params',
				},
				body: {
					type: 'string',
					description: 'Request body to include in signature',
				},
				scheme: {
					type: 'string',
					enum: ['brc77', 'bsm'],
					description: 'Signature scheme (default: brc77)',
				},
				bodyEncoding: {
					type: 'string',
					enum: ['utf8', 'hex', 'base64'],
					description: 'Body encoding (default: utf8)',
				},
				timestamp: {
					type: 'string',
					description: 'ISO8601 timestamp (default: now)',
				},
			},
			required: ['requestPath'],
		},
	},

	async execute(
		ctx: OneSatContext,
		input: AuthTokenRequest,
	): Promise<AuthTokenResponse> {
		try {
			const scheme = input.scheme ?? 'brc77'
			const bodyEncoding = input.bodyEncoding ?? 'utf8'
			const timestamp = input.timestamp ?? new Date().toISOString()

			const bodyHash = input.body
				? toHex(Hash.sha256(toArray(input.body, bodyEncoding)))
				: ''

			const message = `${input.requestPath}|${timestamp}|${bodyHash}`
			const messageBytes = toArray(message, 'utf8')

			const msgHash =
				scheme === 'bsm'
					? BSM.magicHash(messageBytes)
					: Hash.sha256(messageBytes)

			const { publicKey: pubKeyHex } = await ctx.wallet.getPublicKey({
				protocolID: AUTH_PROTOCOL_ID,
				keyID: AUTH_KEY_ID,
				forSelf: true,
			})

			const { signature: derSig } = await ctx.wallet.createSignature({
				protocolID: AUTH_PROTOCOL_ID,
				keyID: AUTH_KEY_ID,
				counterparty: 'self',
				hashToDirectlySign: Array.from(msgHash),
			})

			const signature = compactSign(derSig, msgHash, pubKeyHex)
			const authToken = `${pubKeyHex}|${scheme}|${timestamp}|${input.requestPath}|${signature}`
			return { authToken }
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) }
		}
	},
}
