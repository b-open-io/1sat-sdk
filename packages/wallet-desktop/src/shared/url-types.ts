export type InternalPage =
	| 'wallet/overview'
	| 'wallet/send'
	| 'wallet/receive'
	| 'wallet/history'
	| 'ordinals/gallery'
	| 'ordinals/inscribe'
	| 'tokens/all'
	| 'collections/all'
	| 'locks/all'
	| 'opns/all'
	| 'social/feed'
	| 'chat'
	| 'identity/profile'
	| 'settings'
	| 'browser/new'
	| 'publish/new'
	| 'apps'
	| 'onboarding/create'
	| 'onboarding/import'
	| 'onboarding/unlock'

export type ParsedRoute =
	| {
			type: 'internal'
			page: InternalPage
			params: Record<string, string>
	  }
	| {
			type: 'onchain-outpoint'
			txid: string
			vout: number
			path?: string
			partition: string
	  }
	| {
			type: 'onchain-opns'
			name: string
			path?: string
			partition: string
	  }
	| { type: 'web'; url: string }
	| { type: 'search'; query: string; url: string }

export const INTERNAL_PAGES: Set<string> = new Set([
	'wallet/overview',
	'wallet/send',
	'wallet/receive',
	'wallet/history',
	'ordinals/gallery',
	'ordinals/inscribe',
	'tokens/all',
	'collections/all',
	'locks/all',
	'opns/all',
	'social/feed',
	'chat',
	'identity/profile',
	'settings',
	'browser/new',
	'publish/new',
	'apps',
	'onboarding/create',
	'onboarding/import',
	'onboarding/unlock',
])

const DISPLAY_LABELS: Record<string, string> = {
	'wallet/overview': 'Wallet',
	'wallet/send': 'Send',
	'wallet/receive': 'Receive',
	'wallet/history': 'History',
	'ordinals/gallery': 'Ordinals',
	'ordinals/inscribe': 'Inscribe',
	'tokens/all': 'Tokens',
	'collections/all': 'Collections',
	'locks/all': 'Locks',
	'opns/all': 'OpNS',
	'social/feed': 'Social',
	chat: 'Chat',
	'identity/profile': 'Identity',
	settings: 'Settings',
	'browser/new': 'New Tab',
	'publish/new': 'Publish',
	apps: 'Apps',
	'onboarding/create': 'Create Wallet',
	'onboarding/import': 'Import Wallet',
	'onboarding/unlock': 'Unlock',
}

export function getDisplayLabel(route: ParsedRoute): string {
	switch (route.type) {
		case 'internal':
			return DISPLAY_LABELS[route.page] ?? route.page
		case 'onchain-outpoint': {
			const txid = route.txid
			return `${txid.slice(0, 6)}...${txid.slice(-3)}_${route.vout}`
		}
		case 'onchain-opns':
			return route.name
		case 'web': {
			try {
				return new URL(route.url).hostname
			} catch {
				return route.url
			}
		}
		case 'search':
			return route.query
	}
}
