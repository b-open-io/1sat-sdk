import { P1SAT_MODULE_PROTOCOL } from '@1sat/types'
import type { WalletInterface } from '@bsv/sdk'

/**
 * Probe whether the wallet routes scheme `1sat` through a registered
 * permission module (WPM) via BRC-165 `p 1sat probe`.
 *
 * - Module present → `getPublicKey` under {@link P1SAT_MODULE_PROTOCOL} succeeds
 *   (1sat module pass-through; no user prompt).
 * - WPM without module → throws `Unsupported P-module scheme: …`.
 * - Bare wallet (no WPM) may still succeed; treat as “no module” only when
 *   the unsupported-scheme error is seen. Callers should still **opt in**
 *   with `useModule: true` rather than auto-switching.
 */
export async function hasOneSatModule(
	wallet: WalletInterface,
): Promise<boolean> {
	try {
		await wallet.getPublicKey({
			protocolID: P1SAT_MODULE_PROTOCOL,
			keyID: '1sat-module-probe',
			counterparty: 'self',
			seekPermission: false,
		})
		return true
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (/Unsupported P-module scheme/i.test(msg)) return false
		// Other errors (network, user deny on non-WPM, etc.) — not a positive detect
		return false
	}
}
