/**
 * AI Chat API handler for the BRC-100 HTTP server.
 *
 * Supports multiple AI providers via the AI SDK:
 * - Ollama (local, default)
 * - LM Studio (local, OpenAI-compatible)
 * - OpenAI, OpenRouter, Anthropic (remote, API key required)
 *
 * The frontend sends provider + baseUrl + apiKey + model in the request body
 * from the user's AI settings. The handler creates the appropriate provider
 * instance and passes MCP tools for tool-calling models.
 */
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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
// Provider factory
// ---------------------------------------------------------------------------

type ProviderType = 'ollama' | 'lmstudio' | 'openai' | 'openrouter' | 'anthropic'

function createModel(
	provider: ProviderType,
	modelName: string,
	baseUrl?: string,
	apiKey?: string,
) {
	switch (provider) {
		case 'ollama':
			return ollama(modelName)

		case 'lmstudio': {
			const lmstudio = createOpenAICompatible({
				name: 'lmstudio',
				baseURL: baseUrl || 'http://localhost:1234/v1',
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
			})
			return lmstudio.chatModel(modelName)
		}

		case 'openai': {
			const openai = createOpenAICompatible({
				name: 'openai',
				baseURL: baseUrl || 'https://api.openai.com/v1',
				headers: { Authorization: `Bearer ${apiKey || ''}` },
			})
			return openai.chatModel(modelName)
		}

		case 'openrouter': {
			const openrouter = createOpenAICompatible({
				name: 'openrouter',
				baseURL: baseUrl || 'https://openrouter.ai/api/v1',
				headers: { Authorization: `Bearer ${apiKey || ''}` },
			})
			return openrouter.chatModel(modelName)
		}

		case 'anthropic': {
			const anthropic = createOpenAICompatible({
				name: 'anthropic',
				baseURL: baseUrl || 'https://api.anthropic.com/v1',
				headers: { 'x-api-key': apiKey || '' },
			})
			return anthropic.chatModel(modelName)
		}

		default:
			return ollama(modelName)
	}
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
		const provider: ProviderType = body.provider ?? 'ollama'
		const baseUrl: string | undefined = body.baseUrl
		const apiKey: string | undefined = body.apiKey
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

		const model = createModel(provider, modelName, baseUrl, apiKey)

		const result = streamText({
			model,
			system: systemPrompt,
			messages: await convertToModelMessages(messages),
			tools: mcpTools,
			stopWhen: stepCountIs(15),
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
					error:
						'AI provider is not reachable. Check that Ollama or LM Studio is running.',
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
