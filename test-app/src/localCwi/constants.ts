export const ADMIN_ORIGINATOR = 'test-app-admin'
/**
 * Simulated dApp originator when using local CWI directly (not via WalletClient).
 *
 * Host only, no scheme — yours-wallet rejects anything else, cross-checking the
 * originator against `new URL(sender.origin).host` before forwarding. Sending an
 * origin here instead splits permission grants across two keys, because the
 * permissions manager normalizes originators and the 1Sat module does not.
 */
export const DAPP_ORIGINATOR =
	typeof window !== 'undefined' ? window.location.host : 'localhost:5174'

/** localStorage key for this profile's wallet-toolbox store id. */
export const STORAGE_IDENTITY_STORAGE_KEY = '1sat-test-app-storage-id'
/** @deprecated Shared store id — collided on remote sync_state. Use loadOrCreate. */
export const STORAGE_IDENTITY_KEY = '1sat-test-app'
/**
 * Remote backup for the embedded wallet. Local stays active; this exists so the
 * wallet's rows survive losing the browser profile.
 */
export const REMOTE_BACKUP_URL = 'https://wallet.1sat.app'
export const WIF_STORAGE_KEY = '1sat-test-app-wif'
/** sessionStorage — see LocalCwiHost */
export const TOGGLE_LOCAL_KEY = '1sat-test-app-local-cwi'
export const TOGGLE_ADMIN_KEY = '1sat-test-app-admin-originator'
/** sessionStorage — 1sat module labels on actions (useOneSatModule) */
export const TOGGLE_ONESAT_MODULE_KEY = '1sat-test-app-use-onesat-module'
