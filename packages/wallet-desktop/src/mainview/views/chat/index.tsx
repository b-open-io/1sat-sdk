import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	AlertCircle,
	ArrowUp,
	Hash,
	Loader2,
	Plus,
	RefreshCw,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { useChat } from '../../hooks/use-chat'
import { cn } from '../../lib/utils'

const MONO = 'font-[family-name:var(--font-mono)]'
const SANS = 'font-[family-name:var(--font-sans)]'

const SUGGESTED_CHANNELS = [
	{ name: 'general', desc: 'General discussion' },
	{ name: 'trading', desc: 'BSV trading talk' },
	{ name: 'dev', desc: 'Developer chat' },
	{ name: 'memes', desc: 'Memes and fun' },
	{ name: 'ordinals', desc: '1Sat Ordinals discussion' },
	{ name: 'help', desc: 'Get help from the community' },
	{ name: 'marketplace', desc: 'Buy and sell ordinals' },
	{ name: 'tokens', desc: 'BSV-21 token discussion' },
]

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(timestampSeconds: number): string {
	const now = Date.now() / 1000
	const diff = now - timestampSeconds

	if (diff < 60) return 'now'
	if (diff < 3600) {
		const mins = Math.floor(diff / 60)
		return `${mins}m ago`
	}
	if (diff < 86400) {
		const hours = Math.floor(diff / 3600)
		return `${hours}h ago`
	}

	const date = new Date(timestampSeconds * 1000)
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	})
}

function formatFullTimestamp(timestampSeconds: number): string {
	return new Date(timestampSeconds * 1000).toLocaleString()
}

function getDisplayName(msg: ChatMessage): string {
	if (msg.authorName) return msg.authorName
	if (msg.author && msg.author !== 'anonymous') {
		return `${msg.author.slice(0, 6)}...${msg.author.slice(-4)}`
	}
	return 'Anonymous'
}

function getInitial(name: string): string {
	if (name === 'Anonymous') return '?'
	return name.charAt(0).toUpperCase()
}

/** Deterministic hue from a display name string */
function getAvatarHue(name: string): number {
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		hash = (hash << 5) - hash + name.charCodeAt(i)
		hash |= 0
	}
	return Math.abs(hash) % 360
}

// ============================================================================
// Message Row
// ============================================================================

function MessageRow({ message }: { message: ChatMessage }) {
	const displayName = getDisplayName(message)
	const initial = getInitial(displayName)
	const hue = getAvatarHue(displayName)

	return (
		<div className="flex items-start gap-2.5 px-4 py-2 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors duration-75">
			{/* Avatar */}
			<div
				className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none"
				style={{
					width: 28,
					height: 28,
					marginTop: 1,
					backgroundColor: `oklch(0.35 0.12 ${hue})`,
					color: `oklch(0.92 0.06 ${hue})`,
				}}
			>
				{initial}
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				<div className="flex items-baseline gap-1.5 mb-0.5">
					<span className="text-[11px] font-bold text-foreground leading-none">
						{displayName}
					</span>
					<time
						dateTime={new Date(message.timestamp * 1000).toISOString()}
						title={formatFullTimestamp(message.timestamp)}
						className="text-[9px] text-muted-foreground leading-none shrink-0"
					>
						{formatTimestamp(message.timestamp)}
					</time>
				</div>
				<p className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words leading-relaxed m-0">
					{message.content}
				</p>
			</div>
		</div>
	)
}

// ============================================================================
// Join Channel Dialog
// ============================================================================

function JoinChannelDialog({
	open,
	currentChannels,
	onJoin,
	onClose,
}: {
	open: boolean
	currentChannels: string[]
	onJoin: (channel: string) => void
	onClose: () => void
}) {
	const [customName, setCustomName] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) setTimeout(() => inputRef.current?.focus(), 50)
	}, [open])

	if (!open) return null

	const currentSet = new Set(currentChannels)
	const available = SUGGESTED_CHANNELS.filter((ch) => !currentSet.has(ch.name))

	const handleJoinCustom = () => {
		const name = customName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-_]/g, '')
		if (!name) return
		onJoin(name)
		setCustomName('')
	}

	return (
		<>
			<div
				className="absolute inset-0 z-40 bg-background/60"
				onClick={onClose}
				onKeyDown={(e) => e.key === 'Escape' && onClose()}
				role="button"
				tabIndex={-1}
				aria-label="Close dialog"
			/>
			<div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
				<div
					className="pointer-events-auto bg-card border border-border shadow-xl flex flex-col max-h-[400px] w-[320px]"
					style={{ borderRadius: 0 }}
				>
					{/* Header */}
					<div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
						<span
							className={cn('text-[13px] font-semibold text-foreground', SANS)}
						>
							Join Channel
						</span>
						<button
							type="button"
							onClick={onClose}
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							<X size={14} />
						</button>
					</div>

					{/* Custom channel input */}
					<div className="px-4 py-3 border-b border-border shrink-0">
						<div className="flex items-center gap-2">
							<Hash size={13} className="text-muted-foreground shrink-0" />
							<input
								ref={inputRef}
								value={customName}
								onChange={(e) => setCustomName(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleJoinCustom()}
								placeholder="Enter channel name..."
								className={cn(
									'flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none',
									MONO,
								)}
							/>
							<Button
								size="sm"
								onClick={handleJoinCustom}
								disabled={!customName.trim()}
								className="h-6 px-2.5 text-[10px]"
							>
								Join
							</Button>
						</div>
					</div>

					{/* Suggested channels */}
					<ScrollArea className="flex-1 overflow-hidden">
						<div className="px-2 py-2">
							{available.length === 0 ? (
								<p
									className={cn(
										'text-[11px] text-muted-foreground text-center py-4',
										SANS,
									)}
								>
									You&apos;ve joined all suggested channels
								</p>
							) : (
								available.map((ch) => (
									<button
										key={ch.name}
										type="button"
										onClick={() => onJoin(ch.name)}
										className="flex items-center gap-2.5 w-full px-2.5 py-2 hover:bg-muted/30 transition-colors text-left"
									>
										<Hash
											size={12}
											className="text-muted-foreground shrink-0"
										/>
										<div className="flex-1 min-w-0">
											<p
												className={cn(
													'text-[12px] font-medium text-foreground',
													MONO,
												)}
											>
												{ch.name}
											</p>
											<p
												className={cn(
													'text-[10px] text-muted-foreground',
													SANS,
												)}
											>
												{ch.desc}
											</p>
										</div>
									</button>
								))
							)}
						</div>
					</ScrollArea>
				</div>
			</div>
		</>
	)
}

// ============================================================================
// Channel Sidebar
// ============================================================================

function ChannelSidebar({
	channels,
	activeChannel,
	unreadCounts,
	onSelectChannel,
	onAddChannel,
}: {
	channels: string[]
	activeChannel: string
	unreadCounts: Record<string, number>
	onSelectChannel: (channel: string) => void
	onAddChannel: () => void
}) {
	return (
		<div
			className="flex flex-col shrink-0 border-r border-border bg-card overflow-hidden"
			style={{ width: 220 }}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
				<span
					className={cn(
						'text-[10px] font-semibold uppercase tracking-widest text-muted-foreground',
						MONO,
					)}
				>
					Channels
				</span>
				<button
					type="button"
					aria-label="Join channel"
					onClick={onAddChannel}
					className="flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
					style={{ width: 18, height: 18 }}
				>
					<Plus size={11} />
				</button>
			</div>

			{/* Channel list */}
			<ScrollArea className="flex-1">
				<div className="flex flex-col px-1.5 pb-2">
					{channels.map((ch) => {
						const unread = unreadCounts[ch] ?? 0
						const isActive = activeChannel === ch
						return (
							<button
								key={ch}
								type="button"
								onClick={() => onSelectChannel(ch)}
								className={cn(
									'flex items-center gap-1.5 w-full px-2 py-1.5 text-left transition-colors rounded-sm',
									isActive
										? 'bg-muted/50 text-foreground'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
								)}
							>
								<span
									className={cn(
										'shrink-0 text-[12px] font-bold leading-none',
										isActive ? 'text-primary' : 'text-muted-foreground',
									)}
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									#
								</span>
								<span
									className="flex-1 text-[12px] font-medium truncate leading-none"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{ch}
								</span>
								{unread > 0 && !isActive && (
									<span
										className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none px-1 bg-primary text-primary-foreground"
										style={{
											minWidth: 16,
											height: 16,
										}}
									>
										{unread > 99 ? '99+' : unread}
									</span>
								)}
							</button>
						)
					})}
				</div>
			</ScrollArea>
		</div>
	)
}

// ============================================================================
// Compose Bar
// ============================================================================

function ComposeBar({
	channel,
	isSending,
	onSend,
}: {
	channel: string
	isSending: boolean
	onSend: (content: string) => Promise<void>
}) {
	const [content, setContent] = useState('')
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const contentRef = useRef(content)
	contentRef.current = content

	const handleSubmit = useCallback(async () => {
		const text = contentRef.current.trim()
		if (!text || isSending) return
		setContent('')
		await onSend(text)
		inputRef.current?.focus()
	}, [isSending, onSend])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit],
	)

	return (
		<div className="flex-none flex items-end gap-2 px-4 py-3 border-t border-border">
			<textarea
				ref={inputRef}
				value={content}
				rows={1}
				onChange={(e) => setContent(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={`Message #${channel}...`}
				disabled={isSending}
				autoComplete="off"
				className={cn(
					'flex-1 resize-none bg-muted/30 border border-border rounded-sm px-3 py-2',
					'text-[12px] text-foreground placeholder:text-muted-foreground',
					'focus:outline-none focus:ring-1 focus:ring-ring/50',
					'min-h-[34px] max-h-[120px] leading-relaxed',
					'disabled:opacity-50',
				)}
				style={{ fontFamily: 'var(--font-sans)' }}
			/>
			<button
				type="button"
				onClick={handleSubmit}
				disabled={!content.trim() || isSending}
				aria-label="Send message"
				className={cn(
					'flex shrink-0 items-center justify-center rounded-full transition-colors',
					'disabled:opacity-40 disabled:cursor-not-allowed',
					'bg-primary text-primary-foreground',
				)}
				style={{
					width: 34,
					height: 34,
				}}
			>
				{isSending ? (
					<Loader2 size={14} className="animate-spin" />
				) : (
					<ArrowUp size={14} />
				)}
			</button>
		</div>
	)
}

// ============================================================================
// Chat View
// ============================================================================

export function ChatView() {
	const chat = useChat('general')
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const [dialogOpen, setDialogOpen] = useState(false)

	// Apply rerender-dependencies rule: use primitive messageCount, not array
	const messageCount = chat.messages.length

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messageCount])

	return (
		<div className="relative flex h-full overflow-hidden">
			{/* Channel sidebar — 220px, bg-card, border-right */}
			<ChannelSidebar
				channels={chat.channels}
				activeChannel={chat.channel}
				unreadCounts={chat.unreadCounts}
				onSelectChannel={chat.setChannel}
				onAddChannel={() => setDialogOpen(true)}
			/>

			{/* Join channel dialog — centered over the full chat layout */}
			<JoinChannelDialog
				open={dialogOpen}
				currentChannels={chat.channels}
				onJoin={(ch) => {
					chat.setChannel(ch)
					setDialogOpen(false)
				}}
				onClose={() => setDialogOpen(false)}
			/>

			{/* Main area */}
			<div className="flex flex-1 flex-col min-w-0 bg-background overflow-hidden">
				{/* Header */}
				<div className="flex shrink-0 items-center justify-between px-4 py-2.5 border-b border-border">
					<div className="flex items-center gap-2">
						<span className="text-[14px] font-bold text-foreground leading-none">
							<span
								className="text-primary"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								#
							</span>
							{chat.channel}
						</span>
						{chat.messages.length > 0 && (
							<span
								className="inline-flex items-center justify-center rounded-full text-[9px] font-semibold px-1.5 leading-none"
								style={{
									height: 16,
									backgroundColor: 'var(--muted)',
									color: 'var(--muted-foreground)',
								}}
							>
								{chat.messages.length}
							</span>
						)}
					</div>

					<div className="flex items-center gap-1">
						{chat.error && (
							<span className="flex items-center gap-1 text-[11px] text-destructive mr-2">
								<AlertCircle size={12} />
								{chat.error}
							</span>
						)}
						<Button
							variant="ghost"
							size="icon"
							onClick={chat.refresh}
							disabled={chat.isLoading}
							aria-label="Refresh messages"
							className="size-7"
						>
							<RefreshCw
								size={13}
								className={cn(chat.isLoading && 'animate-spin')}
							/>
						</Button>
					</div>
				</div>

				{/* Messages — fills remaining space */}
				<ScrollArea className="flex-1">
					{chat.isLoading && messageCount === 0 ? (
						<div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
							<Loader2 size={20} className="animate-spin" />
							<span className="text-[12px]">Loading messages...</span>
						</div>
					) : messageCount === 0 ? (
						<div className="flex flex-col items-center justify-center gap-1.5 py-16 text-center px-6">
							<p className="text-[13px] font-semibold text-foreground">
								No messages yet
							</p>
							<p className="text-[12px] text-muted-foreground">
								Be the first to say something in{' '}
								<span
									className="font-medium text-primary"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									#{chat.channel}
								</span>
							</p>
						</div>
					) : (
						<div className="flex flex-col">
							{chat.messages.map((msg) => (
								<MessageRow key={msg.txid} message={msg} />
							))}
							<div ref={messagesEndRef} aria-hidden="true" />
						</div>
					)}
				</ScrollArea>

				{/* Compose bar */}
				<ComposeBar
					channel={chat.channel}
					isSending={chat.isSending}
					onSend={chat.sendMessage}
				/>
			</div>
		</div>
	)
}
