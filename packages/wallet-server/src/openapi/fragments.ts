/**
 * Per-surface OpenAPI path fragments. Each surface contributes its canonical
 * paths only — legacy root-mounted messagebox aliases are intentionally
 * undocumented. The assembler merges fragments for enabled surfaces.
 */

export type PathsFragment = Record<string, Record<string, unknown>>

export interface TagDoc {
	name: string
	'x-displayName': string
	description: string
}

/** Tag metadata rendered as section headings + intros on the docs page. */
export const TAG_DOCS: TagDoc[] = [
	{
		name: 'auth',
		'x-displayName': 'Authentication',
		description:
			'BRC-103/104 mutual authentication. Complete one handshake here and the resulting peer session authenticates you on every authed endpoint below — storage, account, hosting, and messagebox.',
	},
	{
		name: 'storage',
		'x-displayName': 'Wallet storage',
		description:
			'Remote storage for BRC-100 wallets. A wallet-toolbox client connects here to persist and sync its outputs, actions, and certificates.',
	},
	{
		name: 'account',
		'x-displayName': 'Storage account (billing)',
		description:
			'Metered billing for the wallet storage surface above: every identity gets a free byte baseline, and additional capacity is purchased in fixed-size chunks for a block-window term. Unrelated to paymail/messagebox hosting, which has its own flat-rate subscription below.',
	},
	{
		name: 'hosting',
		'x-displayName': 'Paymail + messagebox hosting',
		description:
			'Flat-rate subscription that covers both paymail hosting and messagebox delivery for an identity. While the subscription is active, this server answers paymail lookups for your alias and stores inbound messages for you. Billed separately from the storage account above.',
	},
	{
		name: 'paymail',
		'x-displayName': 'Paymail (bsvalias)',
		description:
			'Public bsvalias surface for receiving payments at alias@domain. Endpoints beyond capability discovery are resolved from the capability document. When hosting is enabled, aliases resolve only for identities with an active hosting subscription.',
	},
	{
		name: 'messagebox',
		'x-displayName': 'Messagebox',
		description:
			'Store-and-forward message delivery between identity keys, with live WebSocket delivery to connected recipients. When hosting is enabled, recipients must hold an active hosting subscription.',
	},
]

const brc104 = [{ brc104: [] }]

const errorSchema = {
	type: 'object',
	properties: {
		status: { type: 'string', example: 'error' },
		code: { type: 'string' },
		description: { type: 'string' },
	},
}

const paymentRequiredResponse = {
	description:
		'Payment required (BRC-41). Retry the request with an `x-bsv-payment` header containing `{derivationPrefix, derivationSuffix, transaction}` where `transaction` is a base64 AtomicBEEF paying the server.',
	headers: {
		'x-bsv-payment-satoshis-required': {
			schema: { type: 'string' },
			description: 'Sats owed for this request.',
		},
		'x-bsv-payment-derivation-prefix': {
			schema: { type: 'string' },
			description: 'Server nonce to use as the BRC-29 derivation prefix.',
		},
	},
	content: { 'application/json': { schema: errorSchema } },
}

export function authPaths(): PathsFragment {
	return {
		'/.well-known/auth': {
			post: {
				tags: ['auth'],
				summary: 'BRC-104 mutual-auth handshake',
				description:
					'Establishes a mutually authenticated peer session (BRC-103/104). One handshake authenticates the client for every authed surface on this server.',
				responses: {
					'200': { description: 'Handshake message accepted.' },
				},
			},
		},
	}
}

export function storagePaths(): PathsFragment {
	return {
		'/': {
			post: {
				tags: ['storage'],
				summary: 'Wallet storage JSON-RPC',
				description:
					'JSON-RPC 2.0 endpoint exposing wallet-toolbox storage methods (`createAction`, `listOutputs`, `findOrInsertUser`, …) to remote BRC-100 wallets. When account metering is enabled, requests from over-capacity accounts fail with JSON-RPC error `-32005` (insufficient capacity).',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['jsonrpc', 'id', 'method'],
								properties: {
									jsonrpc: { type: 'string', example: '2.0' },
									id: { type: 'integer' },
									method: { type: 'string' },
									params: { type: 'array', items: {} },
								},
							},
						},
					},
				},
				responses: {
					'200': {
						description: 'JSON-RPC response (result or error object).',
					},
				},
			},
		},
	}
}

export function accountPaths(): PathsFragment {
	const status = {
		type: 'object',
		properties: {
			identityKey: { type: 'string' },
			serverIdentityKey: { type: 'string' },
			accountsEnabled: { type: 'boolean' },
			currentBlock: { type: 'integer' },
			usedBytes: { type: 'integer' },
			baselineBytes: { type: 'integer' },
			paidBytes: { type: 'integer' },
			capacityBytes: { type: 'integer' },
			deficitBytes: { type: 'integer' },
			paidThroughBlock: { type: 'integer', nullable: true },
			pricing: {
				type: 'object',
				properties: {
					purchaseUnitBytes: { type: 'integer' },
					satsPerUnit: { type: 'integer' },
					durationBlocks: { type: 'integer' },
				},
			},
			nextPayment: {
				type: 'object',
				properties: {
					derivationPrefix: { type: 'string' },
					derivationSuffix: { type: 'string' },
				},
			},
		},
	}
	return {
		'/account/status': {
			get: {
				tags: ['account'],
				summary: 'Storage account status and pricing',
				description:
					'Capacity, usage, and pricing for the authenticated identity. Capacity/pricing fields are present only when `accountsEnabled` is true.',
				security: brc104,
				responses: {
					'200': {
						description: 'Account status.',
						content: { 'application/json': { schema: status } },
					},
					'401': { description: 'Unauthenticated.' },
				},
			},
		},
		'/account/payment': {
			post: {
				tags: ['account'],
				summary: 'Purchase storage capacity',
				description:
					'BRC-41 payment endpoint. Call without payment to receive a 402 quote for the sats owed (full price for needed capacity minus prorated credit for the active payment), then retry with the `x-bsv-payment` header.',
				security: brc104,
				responses: {
					'200': {
						description: 'Payment accepted; returns updated account status.',
						content: { 'application/json': { schema: status } },
					},
					'402': paymentRequiredResponse,
				},
			},
		},
	}
}

export function hostingPaths(): PathsFragment {
	const statusSchema = {
		type: 'object',
		properties: {
			enabled: { type: 'boolean' },
			identityKey: { type: 'string' },
			active: { type: 'boolean' },
			expiresAt: {
				type: 'integer',
				description: 'Unix seconds when the subscription expires.',
			},
			priceSats: { type: 'integer' },
			priceUsd: { type: 'number' },
			periodSeconds: { type: 'integer' },
		},
	}
	return {
		'/hosting/price': {
			get: {
				tags: ['hosting'],
				summary: 'Hosting subscription price',
				description:
					'Public. Current price of a paymail + messagebox hosting subscription. `priceUsd` is the configured USD target price and is present only when the operator sets one.',
				responses: {
					'200': {
						description: 'Current price.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['priceSats', 'periodSeconds'],
									properties: {
										priceSats: { type: 'integer' },
										priceUsd: { type: 'number' },
										periodSeconds: { type: 'integer' },
									},
								},
							},
						},
					},
					'404': { description: 'Hosting disabled on this server.' },
				},
			},
		},
		'/hosting/status': {
			get: {
				tags: ['hosting'],
				summary: 'Hosting subscription status',
				security: brc104,
				responses: {
					'200': {
						description: 'Subscription status for the authenticated identity.',
						content: { 'application/json': { schema: statusSchema } },
					},
					'401': { description: 'Unauthenticated.' },
				},
			},
		},
		'/hosting/subscribe': {
			post: {
				tags: ['hosting'],
				summary: 'Buy or renew a hosting subscription',
				description:
					'BRC-41 payment endpoint (402 flow, price from `/hosting/price`). On success the server mints a receipt extending the subscription by one period from the later of now or the current expiry.',
				security: brc104,
				responses: {
					'200': {
						description: 'Subscription active.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										status: { type: 'string', example: 'ok' },
										identityKey: { type: 'string' },
										expiresAt: { type: 'integer' },
										txid: { type: 'string' },
									},
								},
							},
						},
					},
					'402': paymentRequiredResponse,
					'404': { description: 'Hosting disabled on this server.' },
				},
			},
		},
	}
}

export function messageboxPaths(): PathsFragment {
	return {
		'/messagebox/sendMessage': {
			post: {
				tags: ['messagebox'],
				summary: 'Send a message to a recipient inbox',
				description:
					'Stores a message for the recipient and delivers it live over WebSocket when connected. When hosting is enabled, every recipient must hold an active hosting subscription (403 `ERR_HOSTING_REQUIRED` otherwise).',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['message'],
								properties: {
									message: {
										type: 'object',
										required: ['recipient', 'messageBox', 'messageId', 'body'],
										properties: {
											recipient: {
												type: 'string',
												description: 'Recipient identity key (hex).',
											},
											messageBox: {
												type: 'string',
												description: 'Inbox name, e.g. `payment_inbox`.',
											},
											messageId: { type: 'string' },
											body: {
												description: 'Message payload (string or object).',
											},
										},
									},
								},
							},
						},
					},
				},
				responses: {
					'200': { description: 'Message stored.' },
					'403': {
						description:
							'Recipient has no active hosting subscription (`ERR_HOSTING_REQUIRED`).',
						content: { 'application/json': { schema: errorSchema } },
					},
				},
			},
		},
		'/messagebox/listMessages': {
			post: {
				tags: ['messagebox'],
				summary: 'List messages in one of your inboxes',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['messageBox'],
								properties: { messageBox: { type: 'string' } },
							},
						},
					},
				},
				responses: { '200': { description: 'Messages in the box.' } },
			},
		},
		'/messagebox/acknowledgeMessage': {
			post: {
				tags: ['messagebox'],
				summary: 'Acknowledge (delete) received messages',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['messageIds'],
								properties: {
									messageIds: { type: 'array', items: { type: 'string' } },
								},
							},
						},
					},
				},
				responses: { '200': { description: 'Messages acknowledged.' } },
			},
		},
		'/messagebox/registerDevice': {
			post: {
				tags: ['messagebox'],
				summary: 'Register a device for push notifications',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['fcmToken'],
								properties: {
									fcmToken: { type: 'string' },
									deviceId: { type: 'string' },
									platform: { type: 'string' },
								},
							},
						},
					},
				},
				responses: { '200': { description: 'Device registered.' } },
			},
		},
		'/messagebox/devices': {
			get: {
				tags: ['messagebox'],
				summary: 'List your registered devices',
				security: brc104,
				responses: { '200': { description: 'Registered devices.' } },
			},
		},
	}
}

export function paymailPaths(): PathsFragment {
	return {
		'/.well-known/bsvalias': {
			get: {
				tags: ['paymail'],
				summary: 'Paymail capability discovery',
				description:
					'Public bsvalias capability document. Paymail clients discover the PKI, public-profile, payment-destination, and receive-transaction endpoint templates from here rather than hardcoding paths.',
				responses: {
					'200': { description: 'Capability document.' },
				},
			},
		},
	}
}
