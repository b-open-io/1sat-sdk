/**
 * Sigma OAuth — wraps @sigma-auth/better-auth-plugin/client for the
 * standard Sigma Identity OAuth flow (PKCE, redirect, callback).
 */

import {
	type SigmaSignInOptions,
	sigmaClient,
} from '@sigma-auth/better-auth-plugin/client'
import { createAuthClient } from 'better-auth/client'

/** Sigma Identity server URL */
export const SIGMA_URL = 'https://auth.sigmaidentity.com'

export interface SigmaOAuthConfig {
	/** OAuth client ID registered with Sigma */
	clientId: string
	/** Local callback URL path (default: /auth/sigma/callback) */
	callbackURL?: string
}

export interface SigmaOAuthResult {
	/** BAP ID returned from the callback */
	bapId: string
	/** Public key hex */
	pubkey: string
	/** Full user object from the server callback */
	user: Record<string, unknown>
	/** Access token */
	accessToken: string
}

type AuthClientOptions = NonNullable<Parameters<typeof createAuthClient>[0]>
type AuthClientPlugin = NonNullable<AuthClientOptions['plugins']>[number]

type SigmaPluginActions = ReturnType<
	ReturnType<typeof sigmaClient>['getActions']
>
type SigmaAugmentedClient = {
	sigma: SigmaPluginActions['sigma']
	signIn: {
		sigma: SigmaPluginActions['signIn']['sigma']
	}
}

const baseAuthClient = createAuthClient({
	baseURL: SIGMA_URL,
	plugins: [sigmaClient() as unknown as AuthClientPlugin],
})

export const sigmaAuthClient = baseAuthClient as typeof baseAuthClient &
	SigmaAugmentedClient

/**
 * Initiate Sigma OAuth by redirecting to the authorize endpoint.
 * Uses the better-auth-plugin's signIn.sigma() which handles PKCE,
 * sessionStorage, wallet-check gate, and redirect.
 *
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
 * Complete Sigma OAuth callback. Uses the better-auth-plugin's
 * handleCallback() which verifies state, exchanges code via the
 * server-side callback route, and returns user data.
 */
export async function completeSigmaOAuth(
	searchParams: URLSearchParams,
): Promise<SigmaOAuthResult> {
	const result = await sigmaAuthClient.sigma.handleCallback(searchParams)

	const bapId = result.user?.bap_id as string | undefined
	if (!bapId) {
		throw new Error('Sigma callback response missing bap_id')
	}

	const pubkey = result.user?.pubkey as string | undefined
	if (!pubkey) {
		throw new Error('Sigma callback response missing pubkey')
	}

	return {
		bapId,
		pubkey,
		user: result.user as unknown as Record<string, unknown>,
		accessToken: (result.access_token as string) ?? '',
	}
}

/**
 * Set the active Sigma identity on the auth client.
 * Must be called after OAuth to enable iframe signing.
 */
export function setSigmaIdentity(bapId: string): void {
	sigmaAuthClient.sigma.setIdentity(bapId)
}
