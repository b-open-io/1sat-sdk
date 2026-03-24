/**
 * AI Chat API handler for the BRC-100 HTTP server.
 * Proxies chat requests to a local Ollama instance via the AI SDK
 * using ai-sdk-ollama (wraps official ollama-js library).
 *
 * Security:
 * - Requires `X-Requested-With: 1SatBrowser` header (enforced by CORS preflight)
 * - Context fields are truncated and sanitized to limit prompt injection
 * - Rate limited to 1 request per second per client
 */
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { ollama } from 'ai-sdk-ollama'
import { getMcpTools } from './mcp/client'

const DEFAULT_MODEL = 'llama3'

/** Required custom header value */
export const CHAT_REQUIRED_HEADER = 'X-Requested-With'
export const CHAT_REQUIRED_HEADER_VALUE = '1SatBrowser'

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

let lastRequestTime = 0
const MIN_REQUEST_INTERVAL_MS = 1_000

// ---------------------------------------------------------------------------
// Context sanitization
// ---------------------------------------------------------------------------

const CONTEXT_MAX_LENGTH = 500

const INSTRUCTION_PATTERNS = [
	/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/i,
	/you\s+are\s+now\s+/i,
	/system\s*:\s*/i,
	/\[INST\]/i,
	/<<\s*SYS\s*>>/i,
	/\bdo\s+not\s+follow\b/i,
	/\brole\s*:\s*(system|assistant)\b/i,
]

function sanitizeContextField(value: unknown): string {
	if (typeof value !== 'string') return ''
	let cleaned = value.slice(0, CONTEXT_MAX_LENGTH)
	for (const pattern of INSTRUCTION_PATTERNS) {
		cleaned = cleaned.replace(pattern, '[redacted]')
	}
	return cleaned
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function validateChatAuth(req: Request): Response | null {
	const headerValue = req.headers.get(CHAT_REQUIRED_HEADER)
	if (headerValue !== CHAT_REQUIRED_HEADER_VALUE) {
		return new Response(
			JSON.stringify({
				error: 'Forbidden: missing or invalid X-Requested-With header',
			}),
			{ status: 403, headers: { 'Content-Type': 'application/json' } },
		)
	}
	return null
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleChatRequest(req: Request): Promise<Response> {
	const now = Date.now()
	if (now - lastRequestTime < MIN_REQUEST_INTERVAL_MS) {
		return new Response(
			JSON.stringify({ error: 'Rate limited: max 1 request per second' }),
			{ status: 429, headers: { 'Content-Type': 'application/json' } },
		)
	}
	lastRequestTime = now

	try {
		const body = await req.json()
		const messages: UIMessage[] = body.messages ?? []
		const modelName: string = body.model ?? DEFAULT_MODEL
		const rawContext = body.context as
			| { url?: unknown; content?: unknown }
			| undefined

		const contextUrl = sanitizeContextField(rawContext?.url)
		const contextContent = sanitizeContextField(rawContext?.content)

		let systemPrompt =
			'You are a helpful AI assistant built into 1Sat, a BSV blockchain wallet and on-chain content browser. ' +
			'You have access to tools that can open and navigate browser windows/tabs, query blockchain data ' +
			'(inscriptions, tokens, listings), check wallet balance, list ordinals and tokens, and execute ' +
			'marketplace operations. Use these tools when the user asks about their wallet, assets, or wants to browse content.'

		if (contextUrl) {
			systemPrompt += `\n\nThe user is currently viewing: ${contextUrl}`
		}
		if (contextContent) {
			systemPrompt += `\n\nPage content summary: ${contextContent}`
		}

		// Get MCP tools (authenticated via BRC-31 to local MCP server)
		const mcpTools = await getMcpTools()

		const result = streamText({
			model: ollama(modelName),
			system: systemPrompt,
			messages: await convertToModelMessages(messages),
			tools: mcpTools,
			maxSteps: 15,
		})

		return result.toUIMessageStreamResponse()
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown error'

		if (
			message.includes('ECONNREFUSED') ||
			message.includes('fetch failed')
		) {
			return new Response(
				JSON.stringify({
					error: 'Ollama is not running. Start it with: ollama serve',
				}),
				{
					status: 503,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
