import { Hash, Random, Utils } from '@bsv/sdk'
import type { Action, OneSatContext } from '../types.js'

const { toArray, toBase64, toHex } = Utils

const BRC77_VERSION = [0x42, 0x42, 0x33, 0x01]
const BRC77_PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'message signing']

export interface AuthTokenRequest {
	requestPath: string
	body?: string
	bodyEncoding?: 'utf8' | 'hex' | 'base64'
	timestamp?: string
}

export interface AuthTokenResponse {
	authToken?: string
	error?: string
}

export const getAuthToken: Action<AuthTokenRequest, AuthTokenResponse> = {
	meta: {
		name: 'getAuthToken',
		description: 'Generate a BRC-77 auth token for HTTP request signing',
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
			const bodyEncoding = input.bodyEncoding ?? 'utf8'
			const timestamp = input.timestamp ?? new Date().toISOString()

			const bodyHash = input.body
				? toHex(Hash.sha256(toArray(input.body, bodyEncoding)))
				: ''

			const message = `${input.requestPath}|${timestamp}|${bodyHash}`
			const messageBytes = toArray(message, 'utf8')

			const keyID = Random(32)
			const keyIDBase64 = toBase64(keyID)

			const { publicKey: senderPubKeyHex } = await ctx.wallet.getPublicKey({
				identityKey: true,
			})

			const { signature: derSig } = await ctx.wallet.createSignature({
				protocolID: BRC77_PROTOCOL_ID,
				keyID: keyIDBase64,
				counterparty: 'anyone',
				data: Array.from(messageBytes),
			})

			const senderPubKeyBytes = toArray(senderPubKeyHex, 'hex')
			const envelope = [
				...BRC77_VERSION,
				...senderPubKeyBytes,
				0x00,
				...keyID,
				...derSig,
			]

			const signatureBase64 = toBase64(envelope)
			const authToken = `${senderPubKeyHex}|brc77|${timestamp}|${input.requestPath}|${signatureBase64}`
			return { authToken }
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) }
		}
	},
}
