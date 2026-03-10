/**
 * ProcessedTxStore — tracks which transactions have been internalized
 * by the address sync process, and the last sync score for resumption.
 */

export interface ProcessedTxStore {
	has(txid: string): Promise<boolean>
	add(txid: string): Promise<void>
	getLastScore(): Promise<number>
	setLastScore(score: number): Promise<void>
	close(): Promise<void>
}
