import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft, MessageCircle, Send, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

// ============================================================================
// Constants
// ============================================================================

const MESSAGEBOX_URL = 'http://127.0.0.1:8080/1sat/messagebox/listMessages'

// ============================================================================
// Types
// ============================================================================

interface DmMessage {
	id: string
	content: string
	/** Unix seconds */
	timestamp: number
	/** true = sent by the local wallet user */
	fromSelf: boolean
}

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
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatFullTimestamp(timestampSeconds: number): string {
	return new Date(timestampSeconds * 1000).toLocaleString()
}

function truncateBapId(bapId: string): string {
	if (bapId.length <= 16) return bapId
	return `${bapId.slice(0, 8)}…${bapId.slice(-6)}`
}

// ============================================================================
// Message Bubble
// ============================================================================

function MessageBubble({ message }: { message: DmMessage }) {
	return (
		<div
			className={cn(
				'flex w-full px-4 py-1',
				message.fromSelf ? 'justify-end' : 'justify-start',
			)}
		>
			<div
				className={cn(
					'max-w-[72%] rounded-lg px-3 py-2',
					message.fromSelf
						? 'bg-primary/20 text-foreground rounded-br-sm'
						: 'bg-card text-foreground rounded-bl-sm border border-border',
				)}
			>
				<p className="text-[12px] whitespace-pre-wrap break-words leading-relaxed m-0">
					{message.content}
				</p>
				<time
					dateTime={new Date(message.timestamp * 1000).toISOString()}
					title={formatFullTimestamp(message.timestamp)}
					className={cn(
						'block mt-0.5 text-[9px] leading-none text-muted-foreground',
						message.fromSelf ? 'text-right' : 'text-left',
					)}
				>
					{formatTimestamp(message.timestamp)}
				</time>
			</div>
		</div>
	)
}

// ============================================================================
// Compose Bar
// ============================================================================

function DmComposeBar({
	recipientBapId,
	onAttemptSend,
}: {
	recipientBapId: string
	onAttemptSend: (content: string) => void
}) {
	const [content, setContent] = useState('')
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const contentRef = useRef(content)
	contentRef.current = content

	const handleSubmit = useCallback(() => {
		const text = contentRef.current.trim()
		if (!text) return
		onAttemptSend(text)
		setContent('')
		inputRef.current?.focus()
	}, [onAttemptSend])

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
		<div className="flex-none flex items-end gap-2 px-3 py-3 border-t border-border">
			<textarea
				ref={inputRef}
				value={content}
				rows={1}
				onChange={(e) => setContent(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={`Message ${truncateBapId(recipientBapId)}...`}
				autoComplete="off"
				className={cn(
					'flex-1 resize-none bg-muted/30 border border-border rounded-sm px-3 py-2',
					'text-[12px] text-foreground placeholder:text-muted-foreground',
					'focus:outline-none focus:ring-1 focus:ring-ring/50',
					'min-h-[34px] max-h-[120px] leading-relaxed',
				)}
				style={{ fontFamily: 'var(--font-sans)' }}
			/>
			<button
				type="button"
				onClick={handleSubmit}
				disabled={!content.trim()}
				aria-label="Send message"
				className={cn(
					'flex shrink-0 items-center justify-center rounded-full transition-colors',
					'bg-primary text-primary-foreground',
					'disabled:opacity-40 disabled:cursor-not-allowed',
				)}
				style={{ width: 34, height: 34 }}
			>
				<Send size={14} />
			</button>
		</div>
	)
}

// ============================================================================
// DmView
// ============================================================================

export function DmView({
	params,
	onNavigate,
}: {
	params: Record<string, string>
	onNavigate?: (url: string) => void
}) {
	const bapId = params.bapId ?? ''

	const [messages, setMessages] = useState<DmMessage[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [fetchError, setFetchError] = useState<string | null>(null)
	/** Shown when the user taps Send — cleared after 4 s */
	const [sendNotice, setSendNotice] = useState<string | null>(null)

	const messagesEndRef = useRef<HTMLDivElement>(null)
	const sendNoticeTimerRef = useRef<ReturnType<typeof setTimeout>>()
	const messageCount = messages.length

	// Clear the send-notice timer on unmount to prevent memory leaks
	useEffect(() => () => clearTimeout(sendNoticeTimerRef.current), [])

	// Scroll to bottom whenever the message count changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messageCount])

	// Fetch messages from the local messagebox service
	useEffect(() => {
		let cancelled = false

		async function fetchMessages() {
			setIsLoading(true)
			setFetchError(null)

			try {
				const res = await fetch(MESSAGEBOX_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						// BRC-103 auth headers go here once the integration is complete.
						// For V1 we attempt without them and handle 401 gracefully.
					},
					body: JSON.stringify({ messageBox: 'dm_inbox' }),
				})

				if (!res.ok) {
					throw new Error(`Server returned ${res.status}`)
				}

				const data = await res.json()

				if (cancelled) return

				// Normalise whatever shape the server returns into DmMessage[].
				// Expected shape: { messages: Array<{ id, sender, content, timestamp }> }
				const raw: unknown[] = Array.isArray(data?.messages)
					? data.messages
					: []

				const normalised: DmMessage[] = raw
					.filter(
						(m): m is Record<string, unknown> =>
							typeof m === 'object' && m !== null,
					)
					.map((m, i) => ({
						id: typeof m.id === 'string' ? m.id : String(i),
						content: typeof m.content === 'string' ? m.content : '',
						timestamp:
							typeof m.timestamp === 'number'
								? m.timestamp
								: Math.floor(Date.now() / 1000),
						// Messages where the sender matches the other person's bapId come
						// from them; everything else was sent by us.
						fromSelf: typeof m.sender === 'string' ? m.sender !== bapId : false,
					}))

				setMessages(normalised)
			} catch (err) {
				if (cancelled) return
				const msg = err instanceof Error ? err.message : 'Unknown error'
				setFetchError(msg)
			} finally {
				if (!cancelled) setIsLoading(false)
			}
		}

		if (bapId) {
			fetchMessages()
		} else {
			setIsLoading(false)
		}

		return () => {
			cancelled = true
		}
	}, [bapId])

	const handleBack = useCallback(() => {
		onNavigate?.('1sat://chat')
	}, [onNavigate])

	const handleProfileLink = useCallback(() => {
		if (bapId)
			onNavigate?.(`1sat://identity/profile?bapId=${encodeURIComponent(bapId)}`)
	}, [bapId, onNavigate])

	const handleAttemptSend = useCallback((_content: string) => {
		setSendNotice('Coming soon — messaging requires BRC-103 auth integration')
		clearTimeout(sendNoticeTimerRef.current)
		sendNoticeTimerRef.current = setTimeout(() => setSendNotice(null), 4000)
	}, [])

	// ── Missing bapId guard ──────────────────────────────────────────────────

	if (!bapId) {
		return (
			<div className="flex flex-col h-full bg-background">
				<div className="flex shrink-0 items-center gap-2 px-4 py-2.5 border-b border-border">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleBack}
						aria-label="Back to chat"
						className="size-7"
					>
						<ArrowLeft size={14} />
					</Button>
					<span className="text-[13px] font-semibold text-foreground">
						Direct Message
					</span>
				</div>
				<div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground px-6 text-center">
					<MessageCircle size={28} className="opacity-40" />
					<p className="text-[12px]">
						No identity specified. Navigate to a conversation via a profile
						link.
					</p>
				</div>
			</div>
		)
	}

	// ── Main layout ──────────────────────────────────────────────────────────

	return (
		<div className="flex flex-col h-full bg-background overflow-hidden">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between px-4 py-2.5 border-b border-border">
				<div className="flex items-center gap-2 min-w-0">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleBack}
						aria-label="Back to chat"
						className="size-7 shrink-0"
					>
						<ArrowLeft size={14} />
					</Button>

					{/* Avatar placeholder */}
					<div
						className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
						style={{ width: 24, height: 24 }}
					>
						<User size={13} />
					</div>

					<span
						className="text-[13px] font-semibold text-foreground truncate leading-none"
						title={bapId}
					>
						{truncateBapId(bapId)}
					</span>
				</div>

				{/* Profile link */}
				<Button
					variant="ghost"
					size="icon"
					onClick={handleProfileLink}
					aria-label="View profile"
					className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
				>
					<User size={13} />
				</Button>
			</div>

			{/* Send notice toast */}
			{sendNotice && (
				<output
					className="mx-4 mt-2 px-3 py-2 rounded-sm border border-border bg-muted text-[11px] text-muted-foreground block"
					aria-live="polite"
				>
					{sendNotice}
				</output>
			)}

			{/* Message list */}
			<ScrollArea className="flex-1">
				{isLoading ? (
					<div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
						<MessageCircle size={20} className="opacity-40 animate-pulse" />
						<span className="text-[12px]">Loading messages...</span>
					</div>
				) : fetchError || messageCount === 0 ? (
					<div className="flex flex-col items-center justify-center gap-1.5 py-16 text-center px-6">
						<MessageCircle
							size={24}
							className="text-muted-foreground opacity-40"
						/>
						<p className="text-[13px] font-semibold text-foreground">
							No messages yet
						</p>
						<p className="text-[12px] text-muted-foreground">
							{fetchError
								? 'Could not load messages. Start a conversation below.'
								: 'Send the first message to start your conversation.'}
						</p>
					</div>
				) : (
					<div className="flex flex-col py-2">
						{messages.map((msg) => (
							<MessageBubble key={msg.id} message={msg} />
						))}
					</div>
				)}

				{/* Scroll anchor — always rendered so the ref is always valid */}
				<div ref={messagesEndRef} aria-hidden="true" />
			</ScrollArea>

			{/* Compose bar */}
			<DmComposeBar recipientBapId={bapId} onAttemptSend={handleAttemptSend} />
		</div>
	)
}
