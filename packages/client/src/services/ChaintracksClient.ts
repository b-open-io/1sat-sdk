import type { ClientOptions } from '@1sat/types'
import type { ChainTracker } from '@bsv/sdk'
import type {
	BaseBlockHeader,
	BlockHeader,
	Chain,
} from '@bsv/wallet-toolbox-mobile'
import { BaseClient } from './BaseClient'

/**
 * Convert bytes to hex string (big-endian / natural order)
 */
function toHex(data: Uint8Array): string {
	return Array.from(data)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Client for /1sat/chaintracks/* routes.
 * Implements ChaintracksClientApi interface from @bsv/wallet-toolbox.
 *
 * Routes:
 * - GET /tip - Get chain tip
 * - GET /tip/stream - SSE stream of new blocks
 * - GET /network - Get network type
 * - GET /headers?height=N&count=M - Get raw header bytes
 * - GET /header/height/:height - Get header by height
 * - GET /header/hash/:hash - Get header by hash
 */
export class ChaintracksClient extends BaseClient implements ChainTracker {
	private eventSource: EventSource | null = null
	private subscribers: Set<(header: BlockHeader) => void> = new Set()

	// Chain tip cache (30 second TTL)
	private cachedTip: BlockHeader | null = null
	private cachedTipTime = 0
	private static readonly TIP_CACHE_TTL_MS = 30_000

	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/chaintracks`, options)
	}

	/**
	 * Get current blockchain height (ChainTracker interface)
	 */
	async currentHeight(): Promise<number> {
		const tip = await this.findChainTipHeader()
		return tip.height
	}

	/**
	 * Validate merkle root for a given height (ChainTracker interface)
	 */
	async isValidRootForHeight(root: string, height: number): Promise<boolean> {
		try {
			const header = await this.findHeaderForHeight(height)
			return header?.merkleRoot === root
		} catch (e) {
			console.error(`isValidRootForHeight(${height}) failed:`, e)
			return false
		}
	}

	/**
	 * Get the blockchain network (main or test)
	 */
	async getChain(): Promise<Chain> {
		const data = await this.request<{ network: Chain }>('/network')
		return data.network
	}

	/**
	 * Get service info - synthetic for remote client
	 */
	async getInfo(): Promise<{
		chain: Chain
		heightBulk: number
		heightLive: number
		storage: string
		bulkIngestors: string[]
		liveIngestors: string[]
		packages: { name: string; version: string }[]
	}> {
		const tip = await this.findChainTipHeader()
		const chain = await this.getChain()
		return {
			chain,
			heightBulk: tip.height,
			heightLive: tip.height,
			storage: 'remote',
			bulkIngestors: [],
			liveIngestors: [],
			packages: [],
		}
	}

	/**
	 * Get current chain height
	 */
	async getPresentHeight(): Promise<number> {
		return this.currentHeight()
	}

	/**
	 * Get headers as serialized 80-byte hex string
	 */
	async getHeaders(height: number, count: number): Promise<string> {
		const data = await this.requestBinary(
			`/headers?height=${height}&count=${count}`,
		)
		return toHex(data)
	}

	/**
	 * Get the current chain tip header (cached for 30 seconds)
	 */
	async findChainTipHeader(): Promise<BlockHeader> {
		const now = Date.now()
		if (
			this.cachedTip &&
			now - this.cachedTipTime < ChaintracksClient.TIP_CACHE_TTL_MS
		) {
			return this.cachedTip
		}

		const header = await this.request<BlockHeader>('/tip')
		console.log(
			'[ChaintracksClient] findChainTipHeader:',
			header.height,
			header.hash,
		)
		this.cachedTip = header
		this.cachedTipTime = now
		return header
	}

	/**
	 * Get the current chain tip hash
	 */
	async findChainTipHash(): Promise<string> {
		const tip = await this.findChainTipHeader()
		return tip.hash
	}

	/**
	 * Get block header by height
	 */
	async findHeaderForHeight(height: number): Promise<BlockHeader | undefined> {
		try {
			return await this.request<BlockHeader>(`/header/height/${height}`)
		} catch {
			return undefined
		}
	}

	/**
	 * Get block header by hash
	 */
	async findHeaderForBlockHash(hash: string): Promise<BlockHeader | undefined> {
		try {
			return await this.request<BlockHeader>(`/header/hash/${hash}`)
		} catch {
			return undefined
		}
	}

	/** No-op: Remote server tracks the chain */
	async addHeader(_header: BaseBlockHeader): Promise<void> {}

	/** No-op: Client is always ready */
	async startListening(): Promise<void> {}

	/** No-op: Resolves immediately */
	async listening(): Promise<void> {}

	/** Always true for remote client */
	async isListening(): Promise<boolean> {
		return true
	}

	/** Always true for remote client */
	async isSynchronized(): Promise<boolean> {
		return true
	}

	/** Not implemented for remote client */
	async subscribeReorgs(
		_listener: (
			depth: number,
			oldTip: BlockHeader,
			newTip: BlockHeader,
			deactivatedHeaders?: BlockHeader[],
		) => void,
	): Promise<string> {
		throw new Error('Method not implemented.')
	}

	/** Unsubscribe from events */
	async unsubscribe(_subscriptionId: string): Promise<boolean> {
		return false
	}

	/** Subscribe to new header events */
	async subscribeHeaders(
		listener: (header: BlockHeader) => void,
	): Promise<string> {
		this.subscribers.add(listener)

		if (!this.eventSource) {
			this.eventSource = new EventSource(`${this.baseUrl}/tip/stream`)
			this.eventSource.onmessage = (event) => {
				try {
					const header = JSON.parse(event.data) as BlockHeader
					for (const cb of this.subscribers) {
						cb(header)
					}
				} catch {
					// Ignore parse errors
				}
			}
			this.eventSource.onerror = () => {
				this.eventSource?.close()
				this.eventSource = null
			}
		}

		return 'subscription'
	}

	/**
	 * Get raw header bytes for one or more headers
	 */
	async getHeaderBytes(height: number, count = 1): Promise<number[]> {
		const data = await this.requestBinary(
			`/headers?height=${height}&count=${count}`,
		)
		return Array.from(data)
	}

	/**
	 * Subscribe to new block notifications via SSE
	 * Returns unsubscribe function
	 */
	subscribe(callback: (header: BlockHeader) => void): () => void {
		this.subscribers.add(callback)

		if (!this.eventSource) {
			this.eventSource = new EventSource(`${this.baseUrl}/tip/stream`)
			this.eventSource.onmessage = (event) => {
				try {
					const header = JSON.parse(event.data) as BlockHeader
					for (const cb of this.subscribers) {
						cb(header)
					}
				} catch {
					// Ignore parse errors (e.g., keepalive messages)
				}
			}
			this.eventSource.onerror = () => {
				this.eventSource?.close()
				this.eventSource = null
			}
		}

		return () => {
			this.subscribers.delete(callback)
			if (this.subscribers.size === 0 && this.eventSource) {
				this.eventSource.close()
				this.eventSource = null
			}
		}
	}

	/**
	 * Close all connections
	 */
	close(): void {
		if (this.eventSource) {
			this.eventSource.close()
			this.eventSource = null
		}
		this.subscribers.clear()
	}
}
