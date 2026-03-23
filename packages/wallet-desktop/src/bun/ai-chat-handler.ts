/**
 * AI Chat API handler for the BRC-100 HTTP server.
 * Proxies chat requests to a local Ollama instance via the AI SDK.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'

const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_MODEL = 'llama3'

/** Create an Ollama-compatible provider via the OpenAI adapter */
function getOllamaProvider() {
	return createOpenAI({
		baseURL: OLLAMA_BASE_URL,
		apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
	})
}

/**
 * Handle a POST request to /api/chat.
 * Expects JSON body: { messages: UIMessage[], context?: { url?: string, content?: string } }
 * Returns a streaming response compatible with useChat's DefaultChatTransport.
 */
export async function handleChatRequest(req: Request): Promise<Response> {
	try {
		const body = await req.json()
		const messages: UIMessage[] = body.messages ?? []
		const context = body.context as
			| { url?: string; content?: string }
			| undefined

		const ollama = getOllamaProvider()

		// Build system prompt with page context if available
		let systemPrompt =
			'You are a helpful AI assistant built into the 1Sat Browser, a BSV blockchain wallet and on-chain content browser. You help users understand blockchain content, transactions, inscriptions, and navigate the BSV ecosystem.'

		if (context?.url) {
			systemPrompt += `\n\nThe user is currently viewing: ${context.url}`
		}
		if (context?.content) {
			systemPrompt += `\n\nPage content summary: ${context.content}`
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
