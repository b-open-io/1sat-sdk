/**
 * AI Chat API handler for the BRC-100 HTTP server.
 * Proxies chat requests to a local Ollama instance via the AI SDK.
 *
 * Security:
 * - Requires `X-Requested-With: 1SatBrowser` header (enforced by CORS preflight)
 * - Context fields are truncated and sanitized to limit prompt injection
 * - Rate limited to 1 request per second per client
 */
import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'

const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_MODEL = 'llama3'

/** Required custom header value — external sites cannot send this without CORS preflight approval. */
export const CHAT_REQUIRED_HEADER = 'X-Requested-With'
export const CHAT_REQUIRED_HEADER_VALUE = '1SatBrowser'

// ---------------------------------------------------------------------------
// Rate limiting (simple per-second timestamp check)
// ---------------------------------------------------------------------------

let lastRequestTime = 0
const MIN_REQUEST_INTERVAL_MS = 1_000

// ---------------------------------------------------------------------------
// Context sanitization
// ---------------------------------------------------------------------------

const CONTEXT_MAX_LENGTH = 500

/** Patterns that look like prompt injection attempts */
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
// Provider
// ---------------------------------------------------------------------------

/** Create an Ollama-compatible provider via the OpenAI adapter */
function getOllamaProvider() {
	return createOpenAI({
		baseURL: OLLAMA_BASE_URL,
		apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
	})
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

/**
 * Validate the required auth header.
 * Returns an error Response if invalid, or null if OK.
 */
export function validateChatAuth(req: Request): Response | null {
	const headerValue = req.headers.get(CHAT_REQUIRED_HEADER)
	if (headerValue !== CHAT_REQUIRED_HEADER_VALUE) {
		return new Response(
			JSON.stringify({ error: 'Forbidden: missing or invalid X-Requested-With header' }),
			{ status: 403, headers: { 'Content-Type': 'application/json' } },
		)
	}
	return null
}

/**
 * Handle a POST request to /api/chat.
 * Expects JSON body: { messages: UIMessage[], context?: { url?: string, content?: string } }
 * Returns a streaming response compatible with useChat's DefaultChatTransport.
 *
 * Callers must run `validateChatAuth` before invoking this handler.
 */
export async function handleChatRequest(req: Request): Promise<Response> {
	// Rate limit check
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
		const rawContext = body.context as
			| { url?: unknown; content?: unknown }
			| undefined

		// Sanitize context fields
		const contextUrl = sanitizeContextField(rawContext?.url)
		const contextContent = sanitizeContextField(rawContext?.content)

		const ollama = getOllamaProvider()

		// Build system prompt with page context if available
		let systemPrompt =
			'You are a helpful AI assistant built into the 1Sat Browser, a BSV blockchain wallet and on-chain content browser. You help users understand blockchain content, transactions, inscriptions, and navigate the BSV ecosystem.'

		if (contextUrl) {
			systemPrompt += `\n\nThe user is currently viewing: ${contextUrl}`
		}
		if (contextContent) {
			systemPrompt += `\n\nPage content summary: ${contextContent}`
		}

		const result = streamText({
			model: ollama(DEFAULT_MODEL),
			system: systemPrompt,
			messages: await convertToModelMessages(messages),
		})

		return result.toUIMessageStreamResponse()
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown error'

		// Check if Ollama is running
		if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
			return new Response(
				JSON.stringify({
					error:
						'Ollama is not running. Start it with: ollama serve',
				}),
				{ status: 503, headers: { 'Content-Type': 'application/json' } },
			)
		}

		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
