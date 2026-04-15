import { Message, MessageContent } from '@/components/ai-elements/message'
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader } from '@/components/ai-elements/tool'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart } from 'ai'
import { ArrowUp, ArrowUpRight, Bot, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WALLET_HTTP_URL } from '../../../shared/constants'
import type { ParsedRoute } from '../../../shared/url-types'
import { getDisplayLabel } from '../../../shared/url-types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = 'font-[family-name:var(--font-mono)]'
const SANS = 'font-[family-name:var(--font-sans)]'

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

	// Load AI settings — re-read every time sidebar opens
	const [aiSettings, setAiSettings] = useState<{
		provider?: string
		baseUrl?: string
		apiKey?: string
		model?: string
	}>({})
	useEffect(() => {
		try {
			const raw = localStorage.getItem('1sat-ai-settings')
			if (raw) setAiSettings(JSON.parse(raw))
		} catch {}
	}, [open])

	const selectedModel = aiSettings.model ?? 'qwen3:14b'

	const { messages, sendMessage, status, error } = useChat({
		transport: useMemo(
			() =>
				new DefaultChatTransport({
					api: WALLET_HTTP_URL + '/api/chat',
					headers: { 'X-Requested-With': '1SatBrowser' },
					body: {
						model: selectedModel,
						provider: aiSettings.provider,
						baseUrl: aiSettings.baseUrl,
						apiKey: aiSettings.apiKey,
						context: { url: currentUrl },
					},
				}),
			[
				selectedModel,
				aiSettings.provider,
				aiSettings.baseUrl,
				aiSettings.apiKey,
				currentUrl,
			],
		),
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
			className="flex flex-col shrink-0 bg-background border-l border-border overflow-hidden min-h-0"
			style={{ width: SIDEBAR_WIDTH }}
			aria-label="Research Agent sidebar"
		>
			{/* Header */}
			<div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
				{/* Agent avatar */}
				<div className="flex items-center justify-center size-6 shrink-0 rounded-xl bg-primary">
					<Bot size={12} className="text-primary-foreground" />
				</div>

				{/* Title + model */}
				<div className="flex flex-col flex-1 min-w-0">
					<span className={cn('text-xs font-semibold text-foreground', SANS)}>
						Research Agent
					</span>
					<span
						className={cn('text-[9px] text-muted-foreground truncate', MONO)}
					>
						{selectedModel}
					</span>
				</div>

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
				<div className="flex items-center gap-1.5 px-2 py-0.5 max-w-full overflow-hidden rounded bg-muted border border-border">
					<span
						className={cn('text-[9px] truncate text-muted-foreground', MONO)}
					>
						{currentUrl || '1sat://browser/new'}
					</span>
				</div>
			</div>

			{/* Messages area */}
			<ScrollArea className="flex-1 overflow-hidden">
				<div ref={scrollRef} className="px-3 py-3 space-y-3">
					{messages.length === 0 && (
						<div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
							<div className="flex items-center justify-center size-10 rounded-full bg-primary">
								<Bot size={20} className="text-primary-foreground" />
							</div>
							<div>
								<p
									className={cn(
										'text-xs font-medium text-foreground mb-1',
										SANS,
									)}
								>
									Research Agent
								</p>
								<p
									className={cn(
										'text-[10px] text-muted-foreground max-w-[220px] leading-relaxed',
										SANS,
									)}
								>
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
											'px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-muted/30 transition-colors',
											SANS,
										)}
									>
										{action}
									</button>
								))}
							</div>
						</div>
					)}

					{messages.map((message) => (
						<Message
							key={message.id}
							from={message.role}
							className="text-[11px]"
						>
							<MessageContent>
								{message.parts.map((part, i) => {
									if (part.type === 'text') {
										return (
											<span
												key={`${message.id}-${i}`}
												className="whitespace-pre-wrap"
											>
												{part.text}
											</span>
										)
									}
									if (part.type === 'reasoning') {
										return (
											<Reasoning
												key={`${message.id}-${i}`}
												isStreaming={isStreaming}
											>
												<ReasoningTrigger />
												<ReasoningContent>{part.text}</ReasoningContent>
											</Reasoning>
										)
									}
									if (isToolUIPart(part)) {
										return (
											<Tool key={`${message.id}-${i}`}>
												<ToolHeader
													type={part.type}
													state={part.state}
													title={part.toolName}
												/>
											</Tool>
										)
									}
									return null
								})}
							</MessageContent>
						</Message>
					))}

					{isStreaming &&
						messages[messages.length - 1]?.role !== 'assistant' && (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Loader2 size={11} className="animate-spin" />
								<span className={cn('text-[10px]', SANS)}>Thinking...</span>
							</div>
						)}
				</div>
			</ScrollArea>

			{/* Error banner */}
			{error && (
				<div className="px-3 py-2 border-t border-destructive/30 bg-destructive/5 shrink-0">
					<p className={cn('text-[10px] text-destructive', SANS)}>
						{error.message.includes('Ollama is not running') ||
						error.message.includes('ECONNREFUSED')
							? 'Ollama not running. Start with: ollama serve'
							: error.message}
					</p>
				</div>
			)}

			{/* Input bar */}
			<div className="px-3 py-2.5 border-t border-border shrink-0">
				{/* Context label above input */}
				<div className="flex items-center gap-1.5 mb-1.5">
					<div className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-muted border border-border">
						<Bot size={8} className="text-muted-foreground" />
						<span className={cn('text-[9px] text-muted-foreground', MONO)}>
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
							'flex-1 resize-none bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none max-h-[100px]',
							SANS,
						)}
						disabled={isStreaming}
					/>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={!input.trim() || status !== 'ready'}
						className="flex items-center justify-center size-7 shrink-0 rounded-full bg-primary disabled:opacity-30 transition-opacity"
						aria-label="Send"
					>
						<ArrowUp size={12} className="text-primary-foreground" />
					</button>
				</div>
			</div>
		</div>
	)
}
