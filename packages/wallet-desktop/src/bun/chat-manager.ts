/**
 * BitChat Nitro — Chat Manager
 *
 * Manages SSE connections to the BMAP API for real-time chat messages
 * and provides methods for fetching history and posting messages.
 *
 * Runs in the Bun process so the connection persists across view changes.
 */

import type { ChatMessage } from '../shared/types'

// ============================================================================
// Constants
// ============================================================================

const BMAP_API = 'https://bmap-api-production.up.railway.app'

/** Default channels shown in the channel list */
const DEFAULT_CHANNELS = [
	'general',
	'trading',
	'dev',
	'memes',
	'ordinals',
	'help',
]

// ============================================================================
// BMAP response types
// ============================================================================

interface BmapTransaction {
	tx?: { h?: string }
	blk?: { t?: number }
	timestamp?: number
	B?: Array<{
		content?: string
		'content-type'?: string
		encoding?: string
	}>
	MAP?: Array<{
		app?: string
		type?: string
		context?: string
		channel?: string
	}>
	AIP?: Array<{
		algorithm?: string
		address?: string
		bapId?: string
	}>
	SIGMA?: Array<{
		address?: string
	}>
}

// ============================================================================
// Parser
// ============================================================================

function parseChatMessage(data: BmapTransaction): ChatMessage | null {
	const txid = data.tx?.h
	if (!txid) return null

	const bContent = data.B?.[0]
	const mapData = data.MAP?.[0]
	const aipData = data.AIP?.[0]
	const sigmaData = data.SIGMA?.[0]

	const content = bContent?.content ?? ''
	if (!content) return null

	const channel = mapData?.channel ?? mapData?.context ?? 'general'
	const author =
		aipData?.bapId ?? aipData?.address ?? sigmaData?.address ?? 'anonymous'
	const authorName = aipData?.bapId
		? `${aipData.bapId.slice(0, 6)}...${aipData.bapId.slice(-4)}`
		: undefined
	const timestamp =
		data.blk?.t ?? data.timestamp ?? Math.floor(Date.now() / 1000)

	return {
		txid,
		content,
		channel,
		author,
		authorName,
		timestamp,
		encrypted: false,
	}
}

// ============================================================================
// SSE Subscription
// ============================================================================

type MessageCallback = (msg: ChatMessage) => void

let activeAbortController: AbortController | null = null
let messageCallback: MessageCallback | null = null
const subscribedChannels: Set<string> = new Set()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Set the callback that receives incoming chat messages.
 * Called from the main Bun entry point to wire messages to the WebView.
 */
export function setChatMessageCallback(cb: MessageCallback): void {
	messageCallback = cb
}

/**
 * Start the SSE connection to BMAP API for real-time messages.
 * The connection listens for all message-type BSocial transactions
 * and filters by subscribed channels client-side.
 */
function startSSE(): void {
	// Close any existing connection
	stopSSE()

	const query = {
		v: 3,
		q: {
			find: {
				'MAP.type': { $in: ['message', 'post'] },
				'MAP.app': 'bitchatnitro.com',
			},
		},
	}

	const b64 = btoa(JSON.stringify(query))
	const url = `${BMAP_API}/s/bmap/${b64}`

	const controller = new AbortController()
	activeAbortController = controller

	connectSSE(url, controller.signal)
}

async function connectSSE(url: string, signal: AbortSignal): Promise<void> {
	try {
		const response = await fetch(url, {
			headers: { Accept: 'text/event-stream' },
			signal,
		})

		if (!response.ok || !response.body) {
			console.error(`[chat-manager] SSE connection failed: ${response.status}`)
			scheduleReconnect()
			return
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })

			// Process complete SSE events (double newline delimited)
			const events = buffer.split('\n\n')
			// Keep the last partial chunk in the buffer
			buffer = events.pop() ?? ''

			for (const event of events) {
				if (!event.trim()) continue

				// Extract the data field from the SSE event
				const dataLine = event
					.split('\n')
					.find((line) => line.startsWith('data:'))
				if (!dataLine) continue

				const jsonStr = dataLine.slice(5).trim()
				if (!jsonStr) continue

				try {
					const parsed = JSON.parse(jsonStr)
					// BMAP API can return arrays or single objects
					const items = Array.isArray(parsed) ? parsed : [parsed]

					for (const item of items) {
						const msg = parseChatMessage(item)
						if (!msg) continue

						// Only forward messages for channels we're subscribed to
						if (
							subscribedChannels.size === 0 ||
							subscribedChannels.has(msg.channel)
						) {
							messageCallback?.(msg)
						}
					}
				} catch {
					// Skip malformed JSON — common with SSE keep-alive lines
				}
			}
		}

		// Stream ended cleanly — reconnect
		if (!signal.aborted) {
			scheduleReconnect()
		}
	} catch (err) {
		if (signal.aborted) return
		console.error('[chat-manager] SSE error:', err)
		scheduleReconnect()
	}
}

function scheduleReconnect(): void {
	if (reconnectTimer) clearTimeout(reconnectTimer)
	reconnectTimer = setTimeout(() => {
		console.log('[chat-manager] Reconnecting SSE...')
		startSSE()
	}, 3000)
}

function stopSSE(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}
	if (activeAbortController) {
		activeAbortController.abort()
		activeAbortController = null
	}
}

// ============================================================================
// Channel management
// ============================================================================

export function subscribeChannel(channel: string): void {
	const wasEmpty = subscribedChannels.size === 0
	subscribedChannels.add(channel)

	// Start SSE on first subscription
	if (wasEmpty) {
		startSSE()
	}
}

export function unsubscribeChannel(channel: string): void {
	subscribedChannels.delete(channel)

	// Stop SSE when no channels are subscribed
	if (subscribedChannels.size === 0) {
		stopSSE()
	}
}

export function getSubscribedChannels(): string[] {
	return Array.from(subscribedChannels)
}

// ============================================================================
// Fetch channel history
// ============================================================================

export async function fetchChannelMessages(
	channel: string,
	limit = 50,
): Promise<ChatMessage[]> {
	const query = {
		v: 3,
		q: {
			find: {
				'MAP.type': { $in: ['message', 'post'] },
				'MAP.app': 'bitchatnitro.com',
				'MAP.channel': channel,
			},
			sort: { 'blk.t': -1 },
			limit,
		},
	}

	const b64 = btoa(JSON.stringify(query))
	const url = `${BMAP_API}/q/bmap/${b64}`

	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(
			`Failed to fetch messages: ${response.status} ${response.statusText}`,
		)
	}

	const data = await response.json()

	// BMAP API returns { c: confirmed[], u: unconfirmed[] }
	const confirmed: BmapTransaction[] = data.c ?? []
	const unconfirmed: BmapTransaction[] = data.u ?? []
	const all = [...unconfirmed, ...confirmed]

	const messages: ChatMessage[] = []
	for (const tx of all) {
		const msg = parseChatMessage(tx)
		if (msg) messages.push(msg)
	}

	// Sort oldest-first for display
	messages.sort((a, b) => a.timestamp - b.timestamp)
	return messages
}

// ============================================================================
// Channel list
// ============================================================================

export function getChatChannels(): string[] {
	return DEFAULT_CHANNELS
}

// ============================================================================
// Cleanup
// ============================================================================

export function shutdownChatManager(): void {
	stopSSE()
	subscribedChannels.clear()
	messageCallback = null
}
