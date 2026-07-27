/// <reference types="vite/client" />

import type { WalletInterface } from '@bsv/sdk'

declare global {
	interface Window {
		/** BRC-100 substrate — local gated host or extension injects this. */
		CWI?: WalletInterface
	}
}

export {}
