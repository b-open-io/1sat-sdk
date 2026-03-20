/** Typed event union emitted by the monitor and wallet lifecycle hooks. */
export type MonitorEvent =
	| { type: 'broadcast'; txid: string; status: string }
	| {
			type: 'proven'
			txid: string
			blockHeight: number
			blockHash: string
	  }
	| { type: 'sync:progress'; stage: string; message: string }
	| { type: 'sync:backup'; message: string }
	| { type: 'task:run'; taskName: string; result: string }
	| { type: 'error'; source: string; message: string }
