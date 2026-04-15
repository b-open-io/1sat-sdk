/**
 * Sigma Identity — OAuth flow + CWI wallet connection.
 *
 * The full flow: initiateSigmaOAuth() redirects to Sigma Identity →
 * user authenticates → redirect back → completeSigmaOAuth() exchanges
 * code → connectSigmaWallet() opens CWI iframe with the authenticated
 * identity. After that, the wallet is a standard WalletInterface.
 */

import { type SigmaCWIConfig, createSigmaCWI } from '@1sat/wallet'
import {
	type SigmaSignInOptions,
	sigmaClient,
} from '@sigma-auth/better-auth-plugin/client'
import { createAuthClient } from 'better-auth/client'
import type { ConnectWalletResult, WalletProviderConfig } from './connectWallet'

export const SIGMA_URL = 'https://auth.sigmaidentity.com'

export interface SigmaOAuthConfig {
	clientId: string
	callbackURL?: string
}

export interface SigmaOAuthResult {
	bapId: string
	pubkey: string
	user: Record<string, unknown>
	accessToken: string
}

export interface SigmaProviderConfig extends WalletProviderConfig {
	type: 'sigma'
	clientId: string
	callbackURL?: string
}

type AuthClientOptions = NonNullable<Parameters<typeof createAuthClient>[0]>
type AuthClientPlugin = NonNullable<AuthClientOptions['plugins']>[number]

type SigmaPluginActions = ReturnType<
	ReturnType<typeof sigmaClient>['getActions']
>
type SigmaAugmentedClient = {
	sigma: SigmaPluginActions['sigma']
	signIn: { sigma: SigmaPluginActions['signIn']['sigma'] }
}

const baseAuthClient = createAuthClient({
	baseURL: SIGMA_URL,
	plugins: [sigmaClient() as unknown as AuthClientPlugin],
})

export const sigmaAuthClient = baseAuthClient as typeof baseAuthClient &
	SigmaAugmentedClient

/**
 * Redirect to Sigma Identity authorize endpoint.
 * Handles PKCE, sessionStorage, wallet-check gate.
 * Returns a never-resolving Promise since the page navigates away.
 */
export async function initiateSigmaOAuth(
	config: SigmaOAuthConfig,
	options?: Omit<SigmaSignInOptions, 'clientId' | 'callbackURL'>,
): Promise<never> {
	await sigmaAuthClient.signIn.sigma({
		clientId: config.clientId,
		callbackURL: config.callbackURL ?? '/auth/sigma/callback',
		...options,
	})
	return new Promise<never>(() => {})
}

/**
 * Complete the OAuth callback. Verifies state, exchanges code,
 * returns user data with bapId and pubkey.
 */
export async function completeSigmaOAuth(
	searchParams: URLSearchParams,
): Promise<SigmaOAuthResult> {
	const result = await sigmaAuthClient.sigma.handleCallback(searchParams)

	const bapId = result.user?.bap_id as string | undefined
	if (!bapId) throw new Error('Sigma callback response missing bap_id')

	const pubkey = result.user?.pubkey as string | undefined
	if (!pubkey) throw new Error('Sigma callback response missing pubkey')

	return {
		bapId,
		pubkey,
		user: result.user as unknown as Record<string, unknown>,
		accessToken: (result.access_token as string) ?? '',
	}
}

export function setSigmaIdentity(bapId: string): void {
	sigmaAuthClient.sigma.setIdentity(bapId)
}

/**
 * Connect to a Sigma wallet via CWI iframe.
 * Call after completing OAuth — sets the identity and waits for
 * the iframe to authenticate. Returns a standard ConnectWalletResult.
 */
export async function connectSigmaWallet(
	bapId: string,
): Promise<ConnectWalletResult> {
	const cwiConfig: SigmaCWIConfig = { sigmaUrl: SIGMA_URL }
	const { wallet, destroy, sendCustomMessage } = createSigmaCWI(cwiConfig)

	setSigmaIdentity(bapId)
	await sendCustomMessage('SET_IDENTITY', { bapId })

	await wallet.waitForAuthentication({})
	const { publicKey } = await wallet.getPublicKey({ identityKey: true })

	return {
		wallet,
		provider: 'sigma',
		identityKey: publicKey,
		disconnect: destroy,
	}
}
