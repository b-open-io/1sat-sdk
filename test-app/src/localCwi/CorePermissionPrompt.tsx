/**
 * Plain card for core WalletPermissionsManager requests (protocol, basket,
 * certificate, spending, grouped, counterparty) — the prompts yours-wallet
 * renders in its popup. Deliberately low fidelity: this exists so the WPM can
 * be exercised and tweaked, not to match production chrome. 1Sat intent cards
 * render through OneSatPermissionPrompt instead.
 */

/** Structural subset of the toolbox request types (avoids a direct toolbox dep). */
export interface CorePermissionRequest {
	type: 'protocol' | 'basket' | 'certificate' | 'spending'
	requestID: string
	originator: string
	displayOriginator?: string
	usageType?: string
	privileged?: boolean
	protocolID?: [number, string]
	counterparty?: string
	basket?: string
	certificate?: { verifier: string; certType: string; fields: string[] }
	spending?: {
		satoshis: number
		lineItems?: Array<{ type: string; description: string; satoshis: number }>
	}
	reason?: string
	renewal?: boolean
}

export interface GroupedRequest {
	requestID: string
	originator: string
	permissions: Record<string, unknown>
}

export interface CounterpartyRequest {
	requestID: string
	originator: string
	counterparty: string
	counterpartyLabel?: string
	permissions: Record<string, unknown>
}

export type PendingCore =
	| { kind: 'single'; request: CorePermissionRequest }
	| { kind: 'grouped'; request: GroupedRequest }
	| { kind: 'counterparty'; request: CounterpartyRequest }

const TITLES: Record<CorePermissionRequest['type'], string> = {
	protocol: 'Protocol access',
	basket: 'Basket access',
	certificate: 'Certificate access',
	spending: 'Spending authorization',
}

function rows(request: CorePermissionRequest): Array<[string, string]> {
	const out: Array<[string, string]> = [['Usage', request.usageType ?? '—']]
	if (request.protocolID) {
		out.push([
			'Protocol',
			`[${request.protocolID[0]}, '${request.protocolID[1]}']`,
		])
	}
	if (request.counterparty) out.push(['Counterparty', request.counterparty])
	if (request.basket) out.push(['Basket', request.basket])
	if (request.certificate) {
		out.push(['Cert type', request.certificate.certType])
		out.push(['Verifier', request.certificate.verifier])
		out.push(['Fields', request.certificate.fields.join(', ')])
	}
	if (request.spending) {
		out.push(['Amount', `${request.spending.satoshis.toLocaleString()} sat`])
		for (const li of request.spending.lineItems ?? []) {
			out.push([
				`  ${li.type}`,
				`${li.description} — ${li.satoshis.toLocaleString()} sat`,
			])
		}
	}
	if (request.privileged) out.push(['Privileged', 'yes'])
	if (request.renewal) out.push(['Renewal', 'yes'])
	if (request.reason) out.push(['Reason', request.reason])
	return out
}

export function CorePermissionPrompt({
	pending,
	onApprove,
	onReject,
}: {
	pending: PendingCore
	onApprove: () => void
	onReject: () => void
}) {
	const { kind, request } = pending

	const title =
		kind === 'single'
			? TITLES[(request as CorePermissionRequest).type]
			: kind === 'grouped'
				? 'Grouped permissions'
				: 'Counterparty pact'

	return (
		<div style={cardStyle}>
			<div style={badgeStyle}>WPM · core</div>
			<div style={titleStyle}>{title}</div>
			<div style={originatorStyle}>
				{(request as { displayOriginator?: string }).displayOriginator ??
					request.originator}
			</div>

			<div style={{ marginTop: '0.75rem' }}>
				{kind === 'single' &&
					rows(request as CorePermissionRequest).map(([k, v]) => (
						<div key={k + v} style={rowStyle}>
							<span style={keyStyle}>{k}</span>
							<span style={valStyle}>{v}</span>
						</div>
					))}
				{kind !== 'single' && (
					<pre style={preStyle}>
						{JSON.stringify(
							(request as GroupedRequest | CounterpartyRequest).permissions,
							null,
							2,
						)}
					</pre>
				)}
				{kind === 'counterparty' && (
					<div style={rowStyle}>
						<span style={keyStyle}>Counterparty</span>
						<span style={valStyle}>
							{(request as CounterpartyRequest).counterparty}
						</span>
					</div>
				)}
			</div>

			<div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
				<button type="button" style={rejectStyle} onClick={onReject}>
					Reject
				</button>
				<button type="button" style={approveStyle} onClick={onApprove}>
					Approve
				</button>
			</div>

			<div style={idStyle}>{request.requestID}</div>
		</div>
	)
}

const cardStyle: React.CSSProperties = {
	background: '#141414',
	border: '1px solid #3a3a3a',
	borderRadius: 10,
	padding: '1rem',
	color: '#e0e0e0',
	fontFamily: 'system-ui, sans-serif',
}
const badgeStyle: React.CSSProperties = {
	display: 'inline-block',
	fontSize: '0.65rem',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: '#fbbf24',
	border: '1px solid #78350f',
	background: '#251a06',
	borderRadius: 999,
	padding: '0.15rem 0.5rem',
	marginBottom: '0.5rem',
}
const titleStyle: React.CSSProperties = { fontSize: '1.05rem', fontWeight: 600 }
const originatorStyle: React.CSSProperties = {
	fontSize: '0.8rem',
	color: '#888',
	marginTop: '0.15rem',
	wordBreak: 'break-all',
}
const rowStyle: React.CSSProperties = {
	display: 'flex',
	justifyContent: 'space-between',
	gap: '0.75rem',
	padding: '0.3rem 0',
	borderBottom: '1px solid #1f1f1f',
	fontSize: '0.8rem',
}
const keyStyle: React.CSSProperties = { color: '#888', whiteSpace: 'pre' }
const valStyle: React.CSSProperties = {
	fontFamily: 'monospace',
	textAlign: 'right',
	wordBreak: 'break-all',
}
const preStyle: React.CSSProperties = {
	fontSize: '0.72rem',
	background: '#0d0d0d',
	border: '1px solid #262626',
	borderRadius: 6,
	padding: '0.5rem',
	maxHeight: 220,
	overflow: 'auto',
}
const approveStyle: React.CSSProperties = {
	flex: 1,
	padding: '0.55rem',
	background: '#2563eb',
	color: '#fff',
	border: 'none',
	borderRadius: 6,
	cursor: 'pointer',
	fontWeight: 500,
}
const rejectStyle: React.CSSProperties = {
	flex: 1,
	padding: '0.55rem',
	background: 'transparent',
	color: '#e0e0e0',
	border: '1px solid #3a3a3a',
	borderRadius: 6,
	cursor: 'pointer',
}
const idStyle: React.CSSProperties = {
	marginTop: '0.6rem',
	fontFamily: 'monospace',
	fontSize: '0.65rem',
	color: '#4b5563',
	wordBreak: 'break-all',
}
