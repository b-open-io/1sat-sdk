/**
 * Address sync queue types for background transaction processing.
 */

/**
 * Address sync state tracks SSE stream progress.
 */
export interface AddressSyncState {
	/** Highest score received from SSE, used to resume stream */
	lastQueuedScore: number
	/** Timestamp of last sync activity */
	lastSyncedAt?: number
}

/**
 * Status of a queue item.
 */
export type AddressSyncQueueItemStatus =
	| 'pending'
	| 'processing'
	| 'done'
	| 'failed'

/**
 * A single item in the address sync queue.
 */
export interface AddressSyncQueueItem {
	/** Unique per record: `${outpoint}:${score}` */
	id: string
	/** Outpoint in txid_vout format */
	outpoint: string
	/** Score from SSE stream (ordering) */
	score: number
	/** If this is a spend event, the txid that spent it */
	spendTxid?: string
	/** Current processing status */
	status: AddressSyncQueueItemStatus
	/** Number of processing attempts */
	attempts: number
	/** Last error message if failed */
	lastError?: string
	/** Timestamp when item was queued */
	createdAt: number
	/** Timestamp of last status update */
	updatedAt: number
}

/**
 * Input for enqueueing new items (fields auto-populated by enqueue).
 */
export interface AddressSyncQueueInput {
	outpoint: string
	score: number
	spendTxid?: string
}

/**
 * Queue statistics (transaction-level counts).
 */
export interface AddressSyncQueueStats {
	pending: number
	processing: number
	done: number
	failed: number
}

/**
 * Storage interface for the address sync queue.
 * Implementations: IndexedDB (browser), SQLite (Node/Bun).
 */
export interface AddressSyncQueueStorage {
	/**
	 * Add items to the queue.
	 * Items are created with status 'pending'.
	 */
	enqueue(items: AddressSyncQueueInput[]): Promise<void>

	/**
	 * Claim items for processing.
	 * Finds pending items, gathers all related items by txid, marks them all
	 * as 'processing', and returns them grouped by txid.
	 * @param count - Maximum number of seed items to start from (default: 1)
	 * @returns Map of txid -> items for that txid
	 */
	claim(count?: number): Promise<Map<string, AddressSyncQueueItem[]>>

	/**
	 * Mark an item as complete.
	 * @param id - Queue item ID
	 */
	complete(id: string): Promise<void>

	/**
	 * Mark multiple items as complete.
	 * @param ids - Queue item IDs
	 */
	completeMany(ids: string[]): Promise<void>

	/**
	 * Mark an item as failed.
	 * @param id - Queue item ID
	 * @param error - Error message
	 */
	fail(id: string, error: string): Promise<void>

	/**
	 * Get all queue items for a given txid.
	 * Used to gather spend info before ingesting a transaction.
	 * @param txid - Transaction ID (first 64 chars of outpoint)
	 */
	getByTxid(txid: string): Promise<AddressSyncQueueItem[]>

	/**
	 * Get queue items by status.
	 * @param status - Status to filter by
	 * @param limit - Maximum number of items to return (default: 100)
	 */
	getByStatus(
		status: AddressSyncQueueItemStatus,
		limit?: number,
	): Promise<AddressSyncQueueItem[]>

	/**
	 * Get queue statistics.
	 */
	getStats(): Promise<AddressSyncQueueStats>

	/**
	 * Get sync state.
	 */
	getState(): Promise<AddressSyncState>

	/**
	 * Update sync state.
	 */
	setState(state: Partial<AddressSyncState>): Promise<void>

	/**
	 * Reset any items stuck in "processing" back to "pending".
	 * Called at sync start to recover from crashed sessions.
	 */
	resetProcessing(): Promise<number>

	/**
	 * Clear all queue items and reset state.
	 * Next sync will start from score 0.
	 */
	clear(): Promise<void>

	/**
	 * Close the storage connection.
	 */
	close(): Promise<void>
}
