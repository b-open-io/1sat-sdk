import React, { type ReactElement, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { InternalPage, ParsedRoute } from '../../shared/url-types'
import { AppsView } from '../views/apps/index'
import { BrowserView } from '../views/browser/index'
import { ChatView } from '../views/chat/index'
import { DmView } from '../views/dm/index'
import { CollectionsView } from '../views/collections/index'
import { OverviewView } from '../views/dashboard/index'
import { HistoryView } from '../views/history/index'
import { HomeView } from '../views/home/index'
import { IdentityView } from '../views/identity/index'
import { InscribeView } from '../views/inscribe/index'
import { LocksView } from '../views/locks/index'
import { OpnsView } from '../views/opns/index'
import { OrdinalsView } from '../views/ordinals/index'
import { MarketView } from '../views/market/index'
import { PublishView } from '../views/publish/index'
import { ReceiveView } from '../views/receive/index'
import { SendView } from '../views/send/index'
import { OrdinalDetailView } from '../views/ordinal-detail/index'
import { SettingsView } from '../views/settings/index'
import { SocialView } from '../views/social/index'
import { SweepView } from '../views/sweep/index'
import { TokensView } from '../views/tokens/index'
import { TokenDetailView } from '../views/token-detail/index'
import { TxDetailView } from '../views/tx-detail/index'
import { CreateWallet } from '../views/onboarding/create-wallet'
import { ImportWallet } from '../views/onboarding/import-wallet'
import { UnlockWallet } from '../views/onboarding/unlock-wallet'

function SettingsSecurityView(): ReactElement {
	return <SettingsView params={{ tab: 'security' }} />
}

function SettingsNetworkView(): ReactElement {
	return <SettingsView params={{ tab: 'network' }} />
}

// ─── Onboarding pages ─────────────────────────────────────────────────────────

type OnboardingStep = 'choice' | 'create'

function OnboardingCreateView({
	onNavigate,
}: { onNavigate?: (url: string) => void }): ReactElement {
	const [step, setStep] = useState<OnboardingStep>('choice')

	if (step === 'create') {
		return (
			<CreateWallet onCancel={() => setStep('choice')} />
		)
	}

	return (
		<div className="flex items-center justify-center h-full">
			<div className="max-w-sm w-full p-6">
				<h1 className="text-2xl font-bold text-foreground mb-1 text-center">
					1Sat
				</h1>
				<p className="text-sm text-muted-foreground mb-8 text-center">
					Get started
				</p>
				<div className="space-y-3">
					<Button
						className="w-full"
						size="lg"
						onClick={() => setStep('create')}
					>
						Create New Wallet
					</Button>
					<Button
						variant="secondary"
						className="w-full"
						size="lg"
						onClick={() => onNavigate?.('1sat://onboarding/import')}
					>
						Import Existing Wallet
					</Button>
				</div>
			</div>
		</div>
	)
}

function OnboardingImportView({
	onNavigate,
}: { onNavigate?: (url: string) => void }): ReactElement {
	return (
		<ImportWallet onCancel={() => onNavigate?.('1sat://onboarding/create')} />
	)
}

function OnboardingUnlockView(): ReactElement {
	return <UnlockWallet />
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
	'wallet/tx': TxDetailView,
	'wallet/sweep': SweepView,
	'ordinals/gallery': OrdinalsView,
	'ordinals/detail': OrdinalDetailView,
	'ordinals/inscribe': InscribeView,
	'tokens/all': TokensView,
	'tokens/detail': TokenDetailView,
	'collections/all': CollectionsView,
	'locks/all': LocksView,
	'opns/all': OpnsView,
	'social/feed': SocialView,
	chat: ChatView,
	dm: DmView,
	'identity/profile': IdentityView,
	settings: SettingsView,
	'settings/security': SettingsSecurityView,
	'settings/network': SettingsNetworkView,
	'browser/new': HomeView,
	'publish/new': PublishView,
	apps: AppsView,
	market: MarketView,
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
