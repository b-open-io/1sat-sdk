/**
 * BRC-100 application-facing wallet method table.
 *
 * Mirrors the 28 `WalletInterface` methods exposed by the desktop's dApp
 * connectivity server (`packages/wallet-desktop/src/bun/http-server.ts`) so a
 * headless wallet can answer the same endpoints dApps expect. Which of them
 * an app may call is decided by the served wallet's permissions manager, not
 * by this table.
 */

/** All 28 BRC-100 WalletInterface method names. */
export const WALLET_METHODS = [
	'createAction',
	'signAction',
	'abortAction',
	'listActions',
	'internalizeAction',
	'listOutputs',
	'relinquishOutput',
	'getPublicKey',
	'revealCounterpartyKeyLinkage',
	'revealSpecificKeyLinkage',
	'encrypt',
	'decrypt',
	'createHmac',
	'verifyHmac',
	'createSignature',
	'verifySignature',
	'acquireCertificate',
	'listCertificates',
	'proveCertificate',
	'relinquishCertificate',
	'discoverByIdentityKey',
	'discoverByAttributes',
	'isAuthenticated',
	'waitForAuthentication',
	'getHeight',
	'getHeaderForHeight',
	'getNetwork',
	'getVersion',
] as const

export type WalletMethod = (typeof WALLET_METHODS)[number]

export const walletMethodSet: ReadonlySet<string> = new Set<string>(
	WALLET_METHODS,
)

/** Methods that take no meaningful args — `{}` is substituted when absent. */
export const NO_ARG_METHODS: ReadonlySet<WalletMethod> = new Set<WalletMethod>([
	'isAuthenticated',
	'waitForAuthentication',
	'getHeight',
	'getNetwork',
	'getVersion',
])
