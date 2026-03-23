import React, { type ReactElement } from 'react'
import type { InternalPage, ParsedRoute } from '../../shared/url-types'
import { AppsView } from '../views/apps/index'
import { BrowserView } from '../views/browser/index'
import { ChatView } from '../views/chat/index'
import { CollectionsView } from '../views/collections/index'
import { OverviewView } from '../views/dashboard/index'
import { HistoryView } from '../views/history/index'
import { HomeView } from '../views/home/index'
import { IdentityView } from '../views/identity/index'
import { InscribeView } from '../views/inscribe/index'
import { LocksView } from '../views/locks/index'
import { OpnsView } from '../views/opns/index'
import { OrdinalsView } from '../views/ordinals/index'
import { PublishView } from '../views/publish/index'
import { SettingsView } from '../views/settings/index'
import { SocialView } from '../views/social/index'
import { TokensView } from '../views/tokens/index'

// ─── Placeholder components for pages without dedicated views ─────────────────

function ComingSoonView({ page }: { page: InternalPage }): ReactElement {
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				height: '100%',
				gap: '8px',
			}}
		>
			<p style={{ fontSize: '1.125rem', fontWeight: 600 }}>Coming Soon</p>
			<p style={{ fontSize: '0.875rem', opacity: 0.6 }}>{page}</p>
		</div>
	)
}

function SendView(): ReactElement {
	return <ComingSoonView page="wallet/send" />
}

function ReceiveView(): ReactElement {
	return <ComingSoonView page="wallet/receive" />
}

function OnboardingCreateView(): ReactElement {
	return <ComingSoonView page="onboarding/create" />
}

function OnboardingImportView(): ReactElement {
	return <ComingSoonView page="onboarding/import" />
}

function OnboardingUnlockView(): ReactElement {
	return <ComingSoonView page="onboarding/unlock" />
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Props passed by renderPage to every registered page component.
 * Individual views may declare only the props they need — extra props
 * are silently ignored by React at runtime.
 */
export interface PageProps {
	params: Record<string, string>
	onNavigate?: (url: string) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageComponent = React.ComponentType<any>

const PAGE_REGISTRY: Record<InternalPage, PageComponent> = {
	'wallet/overview': OverviewView,
	'wallet/send': SendView,
	'wallet/receive': ReceiveView,
	'wallet/history': HistoryView,
	'ordinals/gallery': OrdinalsView,
	'ordinals/inscribe': InscribeView,
	'tokens/all': TokensView,
	'collections/all': CollectionsView,
	'locks/all': LocksView,
	'opns/all': OpnsView,
	'social/feed': SocialView,
	chat: ChatView,
	'identity/profile': IdentityView,
	settings: SettingsView,
	'browser/new': HomeView,
	'publish/new': PublishView,
	apps: AppsView,
	'onboarding/create': OnboardingCreateView,
	'onboarding/import': OnboardingImportView,
	'onboarding/unlock': OnboardingUnlockView,
}

/**
 * Render the React element for the given parsed route.
 *
 * Returns the page element when route.type === 'internal' and the page is
 * in the registry. Returns null for all other route types (web, onchain,
 * search) — BrowserLayout is responsible for rendering those.
 */
export function renderPage(
	route: ParsedRoute,
	onNavigate?: (url: string) => void,
): ReactElement | null {
	if (route.type !== 'internal') return null
	const Component = PAGE_REGISTRY[route.page]
	if (!Component) return null
	const params = route.params ?? {}
	return <Component params={params} onNavigate={onNavigate} />
}
