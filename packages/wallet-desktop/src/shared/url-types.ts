const INTERNAL_PAGE_LIST = [
	'wallet/overview',
	'wallet/send',
	'wallet/receive',
	'wallet/history',
	'wallet/tx',
	'wallet/sweep',
	'wallet/downloads',
	'ordinals/gallery',
	'ordinals/detail',
	'ordinals/inscribe',
	'tokens/all',
	'tokens/detail',
	'collections/all',
	'locks/all',
	'opns/all',
	'social/feed',
	'chat',
	'dm',
	'identity/profile',
	'settings',
	'settings/security',
	'settings/network',
	'browser/new',
	'publish/new',
	'apps',
	'market',
	'onboarding/create',
	'onboarding/import',
	'onboarding/unlock',
] as const

export type InternalPage = (typeof INTERNAL_PAGE_LIST)[number]

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
	| { type: 'ai-chat'; query: string }

export const INTERNAL_PAGES: Set<string> = new Set(INTERNAL_PAGE_LIST)

const DISPLAY_LABELS: Record<InternalPage, string> = {
	'wallet/overview': 'Wallet',
	'wallet/send': 'Send',
	'wallet/receive': 'Receive',
	'wallet/history': 'History',
	'wallet/tx': 'Transaction',
	'wallet/sweep': 'Sweep',
	'wallet/downloads': 'Downloads',
	'ordinals/gallery': 'Ordinals',
	'ordinals/detail': 'Ordinal',
	'ordinals/inscribe': 'Inscribe',
	'tokens/all': 'Tokens',
	'tokens/detail': 'Token',
	'collections/all': 'Collections',
	'locks/all': 'Locks',
	'opns/all': 'OpNS',
	'social/feed': 'Social',
	chat: 'Chat',
	dm: 'Message',
	'identity/profile': 'Identity',
	settings: 'Settings',
	'settings/security': 'Security',
	'settings/network': 'Network',
	'browser/new': 'New Tab',
	'publish/new': 'Publish',
	apps: 'Apps',
	market: 'Market',
	'onboarding/create': 'Create Wallet',
	'onboarding/import': 'Import Wallet',
	'onboarding/unlock': 'Unlock',
}

export function getDisplayLabel(route: ParsedRoute): string {
	switch (route.type) {
		case 'internal':
			return DISPLAY_LABELS[route.page]
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
		case 'ai-chat':
			return route.query || 'AI Chat'
	}
}
