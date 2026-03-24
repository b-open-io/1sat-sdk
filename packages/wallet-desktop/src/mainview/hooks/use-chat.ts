import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/types'
import { onChatMessageReceived, rpc } from '../rpc'

export interface UseChatReturn {
	/** Currently active channel */
	channel: string
	/** Set the active channel */
	setChannel: (channel: string) => void
	/** Available channels */
	channels: string[]
	/** Messages in the current channel */
	messages: ChatMessage[]
	/** Whether the initial load is in progress */
	isLoading: boolean
	/** Whether a message is being sent */
	isSending: boolean
	/** Error from the most recent operation */
	error: string | null
	/** Unread message counts keyed by channel name */
	unreadCounts: Record<string, number>
	/** Clear the unread count for a channel */
	clearUnread: (channel: string) => void
	/** Send a message to the current channel */
	sendMessage: (content: string) => Promise<void>
	/** Refresh messages for the current channel */
	refresh: () => Promise<void>
}

export function useChat(initialChannel = 'general'): UseChatReturn {
	const [channel, setChannelState] = useState(initialChannel)
	const [channels, setChannels] = useState<string[]>([])
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [isSending, setIsSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
	const prevChannelRef = useRef<string | null>(null)
	// Keep a ref to the active channel so the push listener closure always sees
	// the latest value without being re-registered on every channel change.
	const channelRef = useRef(channel)
	channelRef.current = channel

	// Fetch available channels on mount
	useEffect(() => {
		rpc.request.getChatChannels().then(
			(result) => setChannels(result.channels),
			(err) => console.error('Failed to get chat channels:', err),
		)
	}, [])

	// Fetch messages and manage SSE subscription when channel changes
	useEffect(() => {
		// Unsubscribe from previous channel
		if (prevChannelRef.current && prevChannelRef.current !== channel) {
			rpc.request
				.unsubscribeChatChannel({ channel: prevChannelRef.current })
				.catch(() => {})
		}
		prevChannelRef.current = channel

		// Subscribe to the new channel for SSE updates
		rpc.request.subscribeChatChannel({ channel }).catch(() => {})

		// Fetch history
		setIsLoading(true)
		setError(null)
		setMessages([])

		rpc.request
			.getChatMessages({ channel, limit: 50 })
			.then((result) => {
				setMessages(result.messages)
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : 'Failed to load messages')
			})
			.finally(() => {
				setIsLoading(false)
			})

		return () => {
			// Cleanup: unsubscribe on unmount
			rpc.request.unsubscribeChatChannel({ channel }).catch(() => {})
		}
	}, [channel])

	// Listen for real-time messages pushed from Bun — registered once, uses
	// channelRef so we never need to re-subscribe on channel changes.
	useEffect(() => {
		const unsub = onChatMessageReceived((msg) => {
			if (msg.channel === channelRef.current) {
				// Active channel: append (deduplicated by txid)
				setMessages((prev) => {
					if (prev.some((m) => m.txid === msg.txid)) return prev
					return [...prev, msg]
				})
			} else {
				// Background channel: increment unread count
				setUnreadCounts((prev) => ({
					...prev,
					[msg.channel]: (prev[msg.channel] ?? 0) + 1,
				}))
			}
		})
		return unsub
	}, [])

	const setChannel = useCallback((newChannel: string) => {
		setChannelState(newChannel)
	}, [])

	const sendMessage = useCallback(
		async (content: string) => {
			if (!content.trim()) return

			setIsSending(true)
			setError(null)

			try {
				const result = await rpc.request.sendChatMessage({
					channel,
					content: content.trim(),
				})

				if (result.error) {
					setError(result.error)
				}
				// The message will arrive via SSE push; no need to insert optimistically
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to send message')
			} finally {
				setIsSending(false)
			}
		},
		[channel],
	)

	const refresh = useCallback(async () => {
		setIsLoading(true)
		setError(null)

		try {
			const result = await rpc.request.getChatMessages({
				channel,
				limit: 50,
			})
			setMessages(result.messages)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load messages')
		} finally {
			setIsLoading(false)
		}
	}, [channel])

	return {
		channel,
		setChannel,
		channels,
		messages,
		isLoading,
		isSending,
		error,
		sendMessage,
		refresh,
	}
}
