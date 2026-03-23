import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
	ArrowUp,
	ArrowUpRight,
	Bot,
	Loader2,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ParsedRoute } from '../../../shared/url-types'
import { getDisplayLabel } from '../../../shared/url-types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = "font-[family-name:var(--font-mono)]"
const SANS = "font-[family-name:var(--font-sans)]"

const SIDEBAR_WIDTH = 340

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRouteUrl(route: ParsedRoute): string {
	switch (route.type) {
		case 'internal':
			return `1sat://${route.page}`
		case 'onchain-outpoint':
			return `1sat://${route.partition}/${route.txid}_${route.vout}${route.path ?? ''}`
		case 'onchain-opns':
			return `1sat://${route.partition}/${route.name}${route.path ?? ''}`
		case 'web':
			return route.url
		case 'search':
			return route.url
		case 'ai-chat':
			return `ai://${route.query}`
		default:
			return ''
	}
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentSidebarProps {
	open: boolean
	onClose: () => void
	currentRoute: ParsedRoute
	onNavigate: (url: string) => void
}

// ---------------------------------------------------------------------------
// AgentSidebar
// ---------------------------------------------------------------------------

export function AgentSidebar({
	open,
	onClose,
	currentRoute,
	onNavigate,
}: AgentSidebarProps) {
	const [input, setInput] = useState('')
	const scrollRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const currentUrl = getRouteUrl(currentRoute)
	const currentLabel = getDisplayLabel(currentRoute)

	const { messages, sendMessage, status, error } = useChat({
		transport: new DefaultChatTransport({
			api: 'http://localhost:3321/api/chat',
			headers: { 'X-Requested-With': '1SatBrowser' },
			body: {
				model: 'llama3:latest',
				context: { url: currentUrl },
			},
		}),
	})

	// Auto-scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [messages.length])

	// Focus input when sidebar opens
	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [open])

	const handleSubmit = useCallback(() => {
		if (!input.trim() || status !== 'ready') return
		sendMessage({ text: input })
		setInput('')
	}, [input, status, sendMessage])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit],
	)

	const isStreaming = status === 'streaming'

	if (!open) return null

	return (
		<div
			className="flex flex-col shrink-0 bg-background border-l border-border overflow-hidden"
			style={{ width: SIDEBAR_WIDTH }}
			aria-label="Research Agent sidebar"
		>
			{/* Header */}
			<div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
				{/* Gradient avatar */}
				<div
					className="flex items-center justify-center size-6 shrink-0"
					style={{
						borderRadius: 12,
						background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
					}}
				>
					<Bot size={12} className="text-white" />
				</div>

				{/* Title */}
				<span className={cn('text-xs font-semibold text-foreground flex-1 min-w-0', SANS)}>
					Research Agent
				</span>

				{/* Switch to full view button */}
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={() => {
						onClose()
						onNavigate('1sat://chat')
					}}
					aria-label="Switch to full agent view"
					title="Open full view"
				>
					<ArrowUpRight size={13} className="text-muted-foreground" />
				</Button>

				{/* Close button */}
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={onClose}
					aria-label="Close agent sidebar"
				>
					<X size={13} className="text-muted-foreground" />
				</Button>
			</div>

			{/* Page context pill */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
				<div
					className="flex items-center gap-1.5 px-2 py-0.5 max-w-full overflow-hidden"
					style={{
						borderRadius: 4,
						background: 'oklch(0.22 0.05 260)',
						border: '1px solid oklch(0.32 0.1 260)',
					}}
				>
					<span
						className={cn('text-[9px] truncate', MONO)}
						style={{ color: 'oklch(0.72 0.18 260)' }}
					>
						{currentUrl || '1sat://browser/new'}
					</span>
				</div>
			</div>

			{/* Messages area */}
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
			>
				{messages.length === 0 && (
					<div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
						<div
							className="flex items-center justify-center size-10"
							style={{
								borderRadius: 20,
								background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
							}}
						>
							<Bot size={20} className="text-white" />
						</div>
						<div>
							<p className={cn('text-xs font-medium text-foreground mb-1', SANS)}>
								Research Agent
							</p>
							<p className={cn('text-[10px] text-muted-foreground max-w-[220px] leading-relaxed', SANS)}>
								Ask me anything about this page or any on-chain content.
							</p>
						</div>
						{/* Quick action chips */}
						<div className="flex flex-wrap gap-1.5 justify-center mt-1">
							{['Explain', 'Analyze', 'Summarize'].map((action) => (
								<button
									key={action}
									type="button"
									onClick={() => {
										const text = `${action} ${currentLabel || 'this page'}`
										setInput(text)
										inputRef.current?.focus()
									}}
									className={cn(
										'px-2 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-muted/30 transition-colors',
										SANS,
									)}
									style={{ borderRadius: 4 }}
								>
									{action}
								</button>
							))}
						</div>
					</div>
				)}

				{messages.map((message) => (
					<div
						key={message.id}
						className={cn(
							'flex gap-2',
							message.role === 'user' ? 'justify-end' : 'justify-start',
						)}
					>
						{message.role === 'assistant' && (
							<div
								className="shrink-0 flex items-center justify-center size-5 mt-0.5"
								style={{
									borderRadius: 10,
									background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
								}}
							>
								<Bot size={10} className="text-white" />
							</div>
						)}
						<div
							className={cn(
								'max-w-[85%] px-2.5 py-1.5 text-[11px] leading-relaxed',
								message.role === 'user'
									? 'bg-primary text-primary-foreground'
									: 'bg-muted/50 text-foreground',
								SANS,
							)}
							style={{
								borderRadius:
									message.role === 'user'
										? '8px 8px 2px 8px'
										: '8px 8px 8px 2px',
							}}
						>
							{message.parts.map((part, i) =>
								part.type === 'text' ? (
									<span
										key={`${message.id}-${i}`}
										className="whitespace-pre-wrap"
									>
										{part.text}
									</span>
								) : null,
							)}
						</div>
					</div>
				))}

				{isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 size={11} className="animate-spin" />
						<span className={cn('text-[10px]', SANS)}>Thinking...</span>
					</div>
				)}
			</div>

			{/* Error banner */}
			{error && (
				<div className="px-3 py-2 border-t border-destructive/30 bg-destructive/5 shrink-0">
					<p className={cn('text-[10px] text-destructive', SANS)}>
						{error.message.includes('ECONNREFUSED')
							? 'Ollama not running. Start with: ollama serve'
							: error.message}
					</p>
				</div>
			)}

			{/* Input bar */}
			<div className="px-3 py-2.5 border-t border-border shrink-0">
				{/* Context label above input */}
				<div className="flex items-center gap-1.5 mb-1.5">
					<div
						className="flex items-center gap-1 px-1.5 py-0.5"
						style={{
							borderRadius: 3,
							background: 'oklch(0.22 0.05 260)',
							border: '1px solid oklch(0.32 0.1 260)',
						}}
					>
						<Bot size={8} style={{ color: 'oklch(0.72 0.18 260)' }} />
						<span
							className={cn('text-[9px]', MONO)}
							style={{ color: 'oklch(0.72 0.18 260)' }}
						>
							Research Agent
						</span>
					</div>
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => {
							onClose()
							onNavigate('1sat://chat')
						}}
						className={cn(
							'text-[9px] text-muted-foreground hover:text-foreground transition-colors',
							MONO,
						)}
					>
						Browse agents
					</button>
				</div>

				<div className="flex items-end gap-1.5">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask about this page..."
						rows={1}
						className={cn(
							'flex-1 resize-none bg-muted/40 border border-border px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none',
							SANS,
						)}
						style={{ borderRadius: 6, maxHeight: 100 }}
						disabled={isStreaming}
					/>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={!input.trim() || status !== 'ready'}
						className="flex items-center justify-center size-7 shrink-0 bg-primary disabled:opacity-30 transition-opacity"
						style={{ borderRadius: 14 }}
						aria-label="Send"
					>
						<ArrowUp size={12} className="text-primary-foreground" />
					</button>
				</div>
			</div>
		</div>
	)
}
