import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	AlertCircle,
	Hash,
	Loader2,
	MessageCircle,
	RefreshCw,
	Send,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { useChat } from '../../hooks/use-chat'
import { cn } from '../../lib/utils'

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(timestampSeconds: number): string {
	const now = Date.now() / 1000
	const diff = now - timestampSeconds

	if (diff < 60) return 'now'
	if (diff < 3600) {
		const mins = Math.floor(diff / 60)
		return `${mins}m`
	}
	if (diff < 86400) {
		const hours = Math.floor(diff / 3600)
		return `${hours}h`
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

function getInitials(name: string): string {
	if (name === 'Anonymous') return '?'
	if (name.includes('...')) return name.slice(0, 2).toUpperCase()
	const parts = name.trim().split(/\s+/)
	if (parts.length >= 2) {
		return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
	}
	return name.slice(0, 2).toUpperCase()
}

// ============================================================================
// Message Bubble
// ============================================================================

function ChatBubble({ message }: { message: ChatMessage }) {
	const displayName = getDisplayName(message)
	const initials = getInitials(displayName)

	return (
		<div className="group flex gap-3 px-4 py-2 hover:bg-accent/30 transition-colors duration-100">
			<div className="shrink-0 pt-0.5">
				<Avatar className="size-8">
					<AvatarFallback className="text-xs">{initials}</AvatarFallback>
				</Avatar>
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-baseline gap-2 min-w-0">
					<span className="text-sm font-semibold text-foreground truncate">
						{displayName}
					</span>
					<time
						dateTime={new Date(message.timestamp * 1000).toISOString()}
						className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
						title={formatFullTimestamp(message.timestamp)}
					>
						{formatTimestamp(message.timestamp)}
					</time>
				</div>
				<div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
					{message.content}
				</div>
			</div>
		</div>
	)
}

// ============================================================================
// Channel List
// ============================================================================

function ChannelList({
	channels,
	activeChannel,
	onSelectChannel,
}: {
	channels: string[]
	activeChannel: string
	onSelectChannel: (channel: string) => void
}) {
	return (
		<div className="flex flex-col w-48 shrink-0 border-r border-border bg-card">
			<div className="px-3 py-3 border-b border-border">
				<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Channels
				</span>
			</div>
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-0.5 p-2">
					{channels.map((ch) => (
						<button
							key={ch}
							type="button"
							className={cn(
								'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-left transition-colors',
								activeChannel === ch
									? 'bg-secondary text-secondary-foreground font-medium'
									: 'text-muted-foreground hover:text-foreground hover:bg-accent',
							)}
							onClick={() => onSelectChannel(ch)}
						>
							<Hash className="size-3.5 shrink-0" />
							<span className="truncate">{ch}</span>
						</button>
					))}
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
	const inputRef = useRef<HTMLInputElement>(null)

	const handleSubmit = useCallback(async () => {
		if (!content.trim() || isSending) return
		const text = content
		setContent('')
		await onSend(text)
		inputRef.current?.focus()
	}, [content, isSending, onSend])

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
		<div className="flex-none border-t border-border bg-card px-4 py-3">
			<div className="flex items-center gap-2">
				<Input
					ref={inputRef}
					value={content}
					onChange={(e) => setContent(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={`Message #${channel}`}
					disabled={isSending}
					className="flex-1"
					autoComplete="off"
				/>
				<Button
					size="icon"
					onClick={handleSubmit}
					disabled={!content.trim() || isSending}
					aria-label="Send message"
				>
					{isSending ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Send className="size-4" />
					)}
				</Button>
			</div>
		</div>
	)
}

// ============================================================================
// Chat View
// ============================================================================

export function ChatView() {
	const chat = useChat('general')
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to bottom when new messages arrive
	const messageCount = chat.messages.length
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messageCount])

	return (
		<div className="flex h-full">
			{/* Channel sidebar */}
			<ChannelList
				channels={chat.channels}
				activeChannel={chat.channel}
				onSelectChannel={chat.setChannel}
			/>

			{/* Main chat area */}
			<div className="flex flex-1 flex-col min-w-0">
				{/* Channel header */}
				<div className="flex-none flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
					<div className="flex items-center gap-2">
						<Hash className="size-4 text-muted-foreground" />
						<span className="text-sm font-semibold text-foreground">
							{chat.channel}
						</span>
					</div>
					<div className="flex items-center gap-1">
						{chat.error && (
							<span className="text-xs text-destructive mr-2 flex items-center gap-1">
								<AlertCircle className="size-3" />
								{chat.error}
							</span>
						)}
						<Button
							variant="ghost"
							size="icon"
							onClick={chat.refresh}
							disabled={chat.isLoading}
							aria-label="Refresh messages"
							className="size-8"
						>
							<RefreshCw
								className={cn('size-3.5', chat.isLoading && 'animate-spin')}
							/>
						</Button>
					</div>
				</div>

				{/* Messages area */}
				<ScrollArea ref={scrollAreaRef} className="flex-1">
					{chat.isLoading && chat.messages.length === 0 ? (
						<div className="flex items-center justify-center h-full py-16">
							<div className="flex flex-col items-center gap-2 text-muted-foreground">
								<Loader2 className="size-6 animate-spin" />
								<span className="text-sm">Loading messages...</span>
							</div>
						</div>
					) : chat.messages.length === 0 ? (
						<div className="flex items-center justify-center h-full py-16">
							<div className="flex flex-col items-center gap-2 text-center">
								<div className="flex size-12 items-center justify-center rounded-full bg-muted">
									<MessageCircle className="size-6 text-muted-foreground" />
								</div>
								<p className="text-sm font-medium text-foreground">
									No messages yet
								</p>
								<p className="text-sm text-muted-foreground">
									Be the first to say something in #{chat.channel}
								</p>
							</div>
						</div>
					) : (
						<div className="flex flex-col py-2">
							{chat.messages.map((msg) => (
								<ChatBubble key={msg.txid} message={msg} />
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
