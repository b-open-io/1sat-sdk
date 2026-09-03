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
			'BRC-103/104 mutual authentication. Complete one handshake here and the resulting peer session authenticates you on every authed endpoint below — storage, account, and messagebox.',
	},
	{
		name: 'storage',
		'x-displayName': 'Wallet storage',
		description:
			'Remote storage for BRC-100 wallets. TypeScript clients use JSON-RPC `POST /`. Go `go-wallet-toolbox` v0.184+ uses REST `GET/POST /storage/v1/*`. Both require the same BRC-103/104 session.',
	},
	{
		name: 'account',
		'x-displayName': 'Account',
		description:
			"The authenticated identity's account on this host. Registration claims a username and profile (the identity's paymail handle on the host's user domain; also what entitles the identity to paymail resolution and messagebox delivery here). Storage metering, when enabled, is billed on the same account: every identity gets a free byte baseline, and additional capacity is purchased in fixed-size chunks for a block-window term.",
	},
	{
		name: 'paymail',
		'x-displayName': 'Paymail (bsvalias)',
		description:
			'Public bsvalias surface for receiving payments at alias@domain. Endpoints beyond capability discovery are resolved from the capability document. When the host runs an account registry, aliases resolve only for identities holding a registered account.',
	},
	{
		name: 'messagebox',
		'x-displayName': 'Messagebox',
		description:
			'Store-and-forward message delivery between identity keys, with live WebSocket delivery to connected recipients. When the host runs an account registry, recipients must hold a registered account.',
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
		...storageV1Paths(),
	}
}

const v1Error = {
	type: 'object',
	required: ['error'],
	properties: { error: { type: 'string' } },
}

const tableSettings = {
	type: 'object',
	properties: {
		storageIdentityKey: { type: 'string' },
		storageName: { type: 'string' },
		chain: { type: 'string' },
		dbtype: { type: 'string' },
		maxOutputScript: { type: 'integer' },
		created_at: { type: 'string', format: 'date-time' },
		updated_at: { type: 'string', format: 'date-time' },
	},
}

function storageV1Paths(): PathsFragment {
	const v1ErrorResponse = {
		description: 'Go v1adapter error envelope.',
		content: { 'application/json': { schema: v1Error } },
	}
	const argsBody = {
		required: true,
		content: {
			'application/json': {
				schema: {
					type: 'object',
					description:
						'Argument struct at the JSON root, or `{ "args": { … } }` as sent by the Go V1 client.',
				},
			},
		},
	}
	const ok = { description: 'Provider result JSON.' }
	return {
		'/storage/v1/settings': {
			get: {
				tags: ['storage'],
				summary: 'Storage settings (MakeAvailable)',
				description:
					'Authenticated `makeAvailable` / TableSettings. Required by Go `storage.NewClient` boot (`InitWalletCore`). Unauthenticated requests are 401.',
				security: brc104,
				responses: {
					'200': {
						description: 'TableSettings.',
						content: { 'application/json': { schema: tableSettings } },
					},
					'401': v1ErrorResponse,
				},
			},
		},
		'/storage/v1/users': {
			post: {
				tags: ['storage'],
				summary: 'Find or insert the authenticated user',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['identityKey'],
								properties: { identityKey: { type: 'string' } },
							},
						},
					},
				},
				responses: {
					'200': ok,
					'401': v1ErrorResponse,
				},
			},
		},
		'/storage/v1/migrate': {
			post: {
				tags: ['storage'],
				summary: 'Migrate storage settings (if the provider supports it)',
				security: brc104,
				responses: {
					'200': ok,
					'400': v1ErrorResponse,
					'401': v1ErrorResponse,
				},
			},
		},
		'/storage/v1/actions': {
			post: {
				tags: ['storage'],
				summary: 'createAction',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['args'],
								properties: { args: { type: 'object' } },
							},
						},
					},
				},
				responses: {
					'200': ok,
					'400': v1ErrorResponse,
					'401': v1ErrorResponse,
				},
			},
		},
		'/storage/v1/actions/process': {
			post: {
				tags: ['storage'],
				summary: 'processAction',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/actions/abort': {
			post: {
				tags: ['storage'],
				summary: 'abortAction',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/actions/internalize': {
			post: {
				tags: ['storage'],
				summary: 'internalizeAction',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/list/actions': {
			post: {
				tags: ['storage'],
				summary: 'listActions',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/list/outputs': {
			post: {
				tags: ['storage'],
				summary: 'listOutputs',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/list/certificates': {
			post: {
				tags: ['storage'],
				summary: 'listCertificates',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/list/transactions': {
			post: {
				tags: ['storage'],
				summary: 'listTransactions',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/balance': {
			post: {
				tags: ['storage'],
				summary: 'getBalance',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/certificates': {
			post: {
				tags: ['storage'],
				summary: 'insertCertificateAuth',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/certificates/relinquish': {
			post: {
				tags: ['storage'],
				summary: 'relinquishCertificate',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/outputs/relinquish': {
			post: {
				tags: ['storage'],
				summary: 'relinquishOutput',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/sync/active': {
			post: {
				tags: ['storage'],
				summary: 'setActive',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
			},
		},
		'/storage/v1/sync/chunk': {
			post: {
				tags: ['storage'],
				summary: 'getSyncChunk',
				security: brc104,
				requestBody: argsBody,
				responses: {
					'200': ok,
					'401': v1ErrorResponse,
					'403': v1ErrorResponse,
				},
			},
		},
		'/storage/v1/sync/state': {
			post: {
				tags: ['storage'],
				summary: 'findOrInsertSyncStateAuth',
				security: brc104,
				requestBody: argsBody,
				responses: { '200': ok, '401': v1ErrorResponse },
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
			registrationEnabled: { type: 'boolean' },
			account: {
				type: 'object',
				nullable: true,
				properties: {
					username: { type: 'string' },
					displayName: { type: 'string' },
					avatarOrigin: { type: 'string' },
					createdAt: { type: 'string', format: 'date-time' },
				},
			},
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
				summary: 'Account status',
				description:
					'Registration and storage status for the authenticated identity. `account` is the registered username and profile (null when unregistered) and is present only when `registrationEnabled` is true. Capacity/pricing fields are present only when `accountsEnabled` is true.',
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

export function registrationPaths(): PathsFragment {
	const accountSchema = {
		type: 'object',
		required: ['identityKey', 'username', 'createdAt'],
		properties: {
			identityKey: { type: 'string' },
			username: { type: 'string' },
			displayName: { type: 'string' },
			avatarOrigin: {
				type: 'string',
				description: 'Origin outpoint (`txid_vout`) of an image ordinal.',
			},
			createdAt: { type: 'string', format: 'date-time' },
		},
	}
	const profileFields = {
		displayName: {
			type: 'string',
			nullable: true,
			maxLength: 64,
			description:
				'Presentation name for paymail public-profile. `null` clears it.',
		},
		avatarOrigin: {
			type: 'string',
			nullable: true,
			description:
				'Origin outpoint (`txid_vout`) of an image ordinal, served through ORDFS as the paymail avatar. `null` clears it.',
		},
	}
	return {
		'/account/register': {
			post: {
				tags: ['account'],
				summary: 'Register a username',
				description:
					"Claims a username for the authenticated identity. Free and permanent: one username per identity, one identity per username, no renames. The username becomes the identity's paymail handle on the host's user domain, and holding an account is what lets OpNS names bound to this identity resolve as paymail here and lets messagebox accept messages for it. Re-posting the same username is idempotent.",
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['username'],
								properties: {
									username: {
										type: 'string',
										pattern: '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$',
										description:
											'Lowercase letters, digits, hyphens; 3-63 chars, no leading/trailing hyphen. Case-folded before storage.',
									},
									...profileFields,
								},
							},
						},
					},
				},
				responses: {
					'200': {
						description:
							'Account registered (or already held under this username).',
						content: { 'application/json': { schema: accountSchema } },
					},
					'400': { description: 'Invalid username or profile field.' },
					'401': { description: 'Unauthenticated.' },
					'409': {
						description:
							'Username held by another identity, or this identity already holds a different username.',
					},
				},
			},
		},
		'/account/profile': {
			put: {
				tags: ['account'],
				summary: 'Update profile',
				description:
					'Edits the presentation fields on the registered account. Fields absent from the body are left unchanged; `null` clears a field.',
				security: brc104,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { type: 'object', properties: profileFields },
						},
					},
				},
				responses: {
					'200': {
						description: 'Updated account.',
						content: { 'application/json': { schema: accountSchema } },
					},
					'400': { description: 'Invalid profile field.' },
					'401': { description: 'Unauthenticated.' },
					'404': { description: 'Identity has no registered account.' },
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
					'Stores a message for the recipient and delivers it live over WebSocket when connected. When the host runs an account registry, every recipient must hold a registered account (403 `ERR_ACCOUNT_REQUIRED` otherwise).',
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
							'Recipient has no account on this host (`ERR_ACCOUNT_REQUIRED`).',
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
