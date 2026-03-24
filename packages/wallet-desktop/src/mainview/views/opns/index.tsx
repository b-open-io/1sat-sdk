import { useCallback, useEffect, useState } from 'react'
import { Globe, Loader2, RefreshCw } from 'lucide-react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const SECTION_HEADER =
	'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'
const MONO = 'font-mono'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpnsName {
	outpoint: string
	name: string
	registered: boolean
}

interface OperationResult {
	txid?: string
	error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateOutpoint(outpoint: string): string {
	if (outpoint.length <= 22) return outpoint
	return `${outpoint.slice(0, 10)}...${outpoint.slice(-8)}`
}

// ---------------------------------------------------------------------------
// NameRow
// ---------------------------------------------------------------------------

interface NameRowProps {
	name: OpnsName
	isOperating: boolean
	onRequest: (name: OpnsName) => void
	onNavigate?: (url: string) => void
	isLast: boolean
}

function NameRow({ name, isOperating, onRequest, onNavigate, isLast }: NameRowProps) {
	return (
		<>
			<div className="flex items-center gap-4 px-5 py-3">
				{/* Clickable name + outpoint area */}
				<div
					className="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer rounded-sm px-1 -mx-1 py-0.5 hover:bg-card transition-colors"
					onClick={() => onNavigate?.(`1sat://${name.name}`)}
					title={`Browse 1sat://${name.name}`}
				>
					{/* Status dot */}
					<span
						className={`shrink-0 size-2 rounded-full ${name.registered ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
					/>
					<div className="flex flex-col gap-0.5 min-w-0">
						<span className="text-sm font-bold leading-tight truncate">{name.name}</span>
						<span className={`text-[9px] text-muted-foreground ${MONO} truncate`}>
							{truncateOutpoint(name.outpoint)}
						</span>
					</div>
				</div>

				{/* Status badge */}
				<Badge
					variant={name.registered ? 'default' : 'secondary'}
					className="shrink-0 rounded-none px-1.5 py-0 h-5 text-[10px]"
				>
					{name.registered ? 'Registered' : 'Unregistered'}
				</Badge>

				{/* Action */}
				<Button
					variant={name.registered ? 'outline' : 'default'}
					size="sm"
					disabled={isOperating}
					onClick={() => onRequest(name)}
					className="shrink-0 rounded-none h-7 text-xs"
				>
					{isOperating ? <Loader2 className="size-3 animate-spin" /> : null}
					{name.registered ? 'Deregister' : 'Register'}
				</Button>
			</div>
			{!isLast && <div className="h-px bg-border mx-0" />}
		</>
	)
}

function SkeletonRow({ isLast }: { isLast: boolean }) {
	return (
		<>
			<div className="flex items-center gap-4 px-5 py-3">
				<div className="flex-1 flex flex-col gap-1.5">
					<Skeleton className="h-4 w-28 rounded-none" />
					<Skeleton className="h-3 w-40 rounded-none" />
				</div>
				<Skeleton className="h-5 w-20 rounded-none" />
				<Skeleton className="h-7 w-20 rounded-none" />
			</div>
			{!isLast && <div className="h-px bg-border" />}
		</>
	)
}

// ---------------------------------------------------------------------------
// Confirmation dialog
// ---------------------------------------------------------------------------

type ConfirmAction = 'register' | 'deregister'

interface ConfirmState {
	open: boolean
	action: ConfirmAction
	name: OpnsName | null
}

const INITIAL_CONFIRM: ConfirmState = { open: false, action: 'register', name: null }

// ---------------------------------------------------------------------------
// OpnsView
// ---------------------------------------------------------------------------

interface OpnsViewProps {
	onNavigate?: (url: string) => void
}

export function OpnsView({ onNavigate }: OpnsViewProps = {}) {
	const [names, setNames] = useState<OpnsName[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [operating, setOperating] = useState(false)
	const [confirm, setConfirm] = useState<ConfirmState>(INITIAL_CONFIRM)
	const [opResult, setOpResult] = useState<OperationResult | null>(null)

	const fetchNames = useCallback(async () => {
		setLoading(true)
		try {
			const result = await rpc.request.getOpnsNames()
			setNames(
				result.names.map((n) => ({
					outpoint: n.outpoint,
					name: n.name,
					registered: n.tags.includes('opns:published'),
				})),
			)
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err : new Error('Failed to load OpNS names'))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchNames()
	}, [fetchNames])

	const handleRequest = useCallback((name: OpnsName) => {
		setOpResult(null)
		setConfirm({
			open: true,
			action: name.registered ? 'deregister' : 'register',
			name,
		})
	}, [])

	const handleConfirm = useCallback(async () => {
		if (!confirm.name) return
		setOperating(true)
		try {
			const res =
				confirm.action === 'register'
					? await rpc.request.opnsRegister({ outpoint: confirm.name.outpoint })
					: await rpc.request.opnsDeregister({ outpoint: confirm.name.outpoint })
			setOpResult(res)
			if (!res.error) await fetchNames()
		} finally {
			setOperating(false)
			setConfirm(INITIAL_CONFIRM)
		}
	}, [confirm, fetchNames])

	const handleCancel = useCallback(() => {
		setConfirm(INITIAL_CONFIRM)
	}, [])

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div className="p-6 max-w-[800px]">
			{/* Header row */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h1 className="text-xl font-bold leading-tight">OpNS Names</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Manage your on-chain name bindings
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="size-8 rounded-none"
					onClick={fetchNames}
					disabled={loading}
					aria-label="Refresh names"
				>
					<RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/* Operation result banner */}
			{opResult?.txid && (
				<div className="mb-4 border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-2">
					<span className="text-xs font-medium text-primary">Transaction submitted</span>
					<span className={`text-[10px] text-muted-foreground truncate ${MONO}`}>
						{opResult.txid}
					</span>
				</div>
			)}
			{opResult?.error && (
				<div className="mb-4 border border-destructive/20 bg-destructive/5 px-4 py-2.5">
					<span className="text-xs font-medium text-destructive">{opResult.error}</span>
				</div>
			)}

			{/* List */}
			<div className="border border-border">
				{/* Column headers */}
				<div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-muted/30">
					<span className={`flex-1 ${SECTION_HEADER}`}>Name</span>
					<span className={`w-20 text-right ${SECTION_HEADER}`}>Status</span>
					<span className={`w-20 text-right ${SECTION_HEADER}`}>Action</span>
				</div>

				{/* Loading state */}
				{loading && names.length === 0 ? (
					<>
						{[0, 1, 2].map((i) => (
							<SkeletonRow key={i} isLast={i === 2} />
						))}
					</>
				) : error && names.length === 0 ? (
					/* Error state */
					<div className="flex flex-col items-center gap-2 py-12">
						<Globe className="size-8 text-destructive/50" />
						<p className="text-sm font-medium text-destructive">Failed to load names</p>
						<p className="text-xs text-muted-foreground">{error.message}</p>
					</div>
				) : names.length === 0 ? (
					/* Empty state */
					<div className="flex flex-col items-center gap-2 py-12">
						<Globe className="size-8 text-muted-foreground/30" />
						<p className="text-sm text-muted-foreground">No OpNS names</p>
					</div>
				) : (
					/* Name list */
					names.map((name, index) => (
						<NameRow
							key={name.outpoint}
							name={name}
							isOperating={operating}
							onRequest={handleRequest}
							isLast={index === names.length - 1}
						/>
					))
				)}
			</div>

			{/* Confirmation dialog */}
			<Dialog
				open={confirm.open}
				onOpenChange={(open) => {
					if (!open) handleCancel()
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{confirm.action === 'register'
								? 'Register Identity'
								: 'Remove Identity Binding'}
						</DialogTitle>
						<DialogDescription>
							{confirm.action === 'register'
								? `Bind your wallet's identity key to "${confirm.name?.name ?? ''}". This creates an on-chain transaction.`
								: `Remove the identity binding from "${confirm.name?.name ?? ''}". This creates an on-chain transaction.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="flex gap-2 sm:gap-0">
						<Button
							variant="outline"
							onClick={handleCancel}
							disabled={operating}
							className="rounded-none"
						>
							Cancel
						</Button>
						<Button
							variant={confirm.action === 'deregister' ? 'destructive' : 'default'}
							onClick={handleConfirm}
							disabled={operating}
							className="rounded-none"
						>
							{operating ? <Loader2 className="size-4 animate-spin" /> : null}
							{confirm.action === 'register' ? 'Register' : 'Deregister'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
