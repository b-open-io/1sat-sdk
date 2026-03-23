import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
	ArrowUp,
	Bot,
	ChevronDown,
	Loader2,
	Settings,
	Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MONO = "font-[family-name:var(--font-mono)]"
const SANS = "font-[family-name:var(--font-sans)]"

/** Available Ollama models — fetched dynamically */
interface OllamaModel {
	name: string
	size: string
}

function useOllamaModels() {
	const [models, setModels] = useState<OllamaModel[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		async function fetchModels() {
			try {
				const res = await fetch('http://localhost:11434/api/tags')
				if (res.ok) {
					const data = await res.json()
					setModels(
						(data.models ?? []).map((m: { name: string; size: number }) => ({
							name: m.name,
							size: `${(m.size / 1e9).toFixed(1)} GB`,
						})),
					)
				}
			} catch {
				// Ollama not running
			} finally {
				setLoading(false)
			}
		}
		fetchModels()
	}, [])

	return { models, loading }
}

function ModelSelector({
	value,
	onChange,
	models,
}: {
	value: string
	onChange: (model: string) => void
	models: OllamaModel[]
}) {
	const [open, setOpen] = useState(false)

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					'flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-muted/50 transition-colors',
					MONO,
				)}
				style={{ borderRadius: 4 }}
			>
				<Sparkles size={10} style={{ color: 'var(--agent-accent-muted)' }} />
				<span className="text-muted-foreground">{value.replace(':latest', '')}</span>
				<ChevronDown size={8} className="text-muted-foreground" />
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div
						className="absolute top-full left-0 mt-1 z-50 border border-border bg-card shadow-lg min-w-[180px]"
						style={{ borderRadius: 4 }}
					>
						{models.map((m) => (
							<button
								key={m.name}
								type="button"
								onClick={() => {
									onChange(m.name)
									setOpen(false)
								}}
								className={cn(
									'flex items-center justify-between w-full px-3 py-1.5 text-[10px] hover:bg-muted/50 transition-colors',
									m.name === value
										? 'text-foreground'
										: 'text-muted-foreground',
									MONO,
								)}
							>
								<span>{m.name.replace(':latest', '')}</span>
								<span className="text-muted-foreground/60">{m.size}</span>
							</button>
						))}
						{models.length === 0 && (
							<div className="px-3 py-2 text-[10px] text-muted-foreground">
								No models found. Is Ollama running?
							</div>
						)}
					</div>
				</>
			)}
		</div>
	)
}

interface AiChatViewProps {
	initialQuery?: string
	pageContext?: { url?: string; content?: string }
	onNavigate?: (url: string) => void
}

export function AiChatView({ initialQuery, pageContext, onNavigate }: AiChatViewProps) {
	const { models } = useOllamaModels()
	const [selectedModel, setSelectedModel] = useState('llama3:latest')
	const [input, setInput] = useState(initialQuery ?? '')
	const scrollRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const transport = useMemo(
		() =>
			new DefaultChatTransport({
				api: 'http://localhost:3321/api/chat',
				headers: { 'X-Requested-With': '1SatBrowser' },
				body: {
					model: selectedModel,
					context: pageContext,
				},
			}),
		[selectedModel, pageContext],
	)

	const { messages, sendMessage, status, error } = useChat({ transport })

	// Auto-scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [messages.length])

	// Send initial query if provided
	useEffect(() => {
		if (initialQuery && messages.length === 0) {
			sendMessage({ text: initialQuery })
		}
	}, [initialQuery, sendMessage])

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

	return (
		<div className="flex flex-col h-full bg-background">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
				<div className="flex items-center gap-2">
					<div
						className="flex items-center justify-center w-6 h-6"
						style={{
							borderRadius: 12,
							background: 'linear-gradient(135deg, var(--agent-gradient-from), var(--agent-gradient-to))',
						}}
					>
						<Bot size={12} className="text-primary-foreground" />
					</div>
					<span className={cn('text-xs font-semibold text-foreground', SANS)}>
						AI Chat
					</span>
					<ModelSelector
						value={selectedModel}
						onChange={setSelectedModel}
						models={models}
					/>
				</div>
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={() => onNavigate?.('1sat://settings')}
					aria-label="AI Settings"
				>
					<Settings size={13} className="text-muted-foreground" />
				</Button>
			</div>

			{/* Page context banner */}
			{pageContext?.url && (
				<div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b border-primary/20 shrink-0">
					<span className={cn('text-[9px] text-primary', MONO)}>
						Context: {pageContext.url}
					</span>
				</div>
			)}

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
				{messages.length === 0 && !initialQuery && (
					<div className="flex flex-col items-center justify-center h-full gap-3 text-center">
						<div
							className="flex items-center justify-center w-12 h-12"
							style={{
								borderRadius: 24,
								background: 'linear-gradient(135deg, var(--agent-gradient-from), var(--agent-gradient-to))',
							}}
						>
							<Bot size={24} className="text-primary-foreground" />
						</div>
						<p className={cn('text-sm font-medium text-foreground', SANS)}>
							Ask anything
						</p>
						<p className={cn('text-xs text-muted-foreground max-w-[280px]', SANS)}>
							Powered by local AI via Ollama. Your conversations stay on your machine.
						</p>
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
								className="shrink-0 flex items-center justify-center w-6 h-6 mt-0.5"
								style={{
									borderRadius: 12,
									background: 'linear-gradient(135deg, var(--agent-gradient-from), var(--agent-gradient-to))',
								}}
							>
								<Bot size={11} className="text-primary-foreground" />
							</div>
						)}
						<div
							className={cn(
								'max-w-[80%] px-3 py-2 text-[11px] leading-relaxed',
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
									<span key={`${message.id}-${i}`} className="whitespace-pre-wrap">
										{part.text}
									</span>
								) : null,
							)}
						</div>
					</div>
				))}

				{isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 size={12} className="animate-spin" />
						<span className="text-[10px]">Thinking...</span>
					</div>
				)}
			</div>

			{/* Error */}
			{error && (
				<div className="px-4 py-2 border-t border-destructive/30 bg-destructive/5 shrink-0">
					<p className="text-[10px] text-destructive">
						{error.message.includes('ECONNREFUSED')
							? 'Ollama is not running. Start it with: ollama serve'
							: error.message}
					</p>
				</div>
			)}

			{/* Input */}
			<div className="px-4 py-3 border-t border-border shrink-0">
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask anything..."
						rows={1}
						className={cn(
							'flex-1 resize-none bg-muted/40 border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none',
							SANS,
						)}
						style={{ borderRadius: 6, maxHeight: 120 }}
						disabled={isStreaming}
					/>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={!input.trim() || status !== 'ready'}
						className="flex items-center justify-center w-8 h-8 shrink-0 bg-primary disabled:opacity-30 transition-opacity"
						style={{ borderRadius: 16 }}
						aria-label="Send"
					>
						<ArrowUp size={14} className="text-primary-foreground" />
					</button>
				</div>
			</div>
		</div>
	)
}
