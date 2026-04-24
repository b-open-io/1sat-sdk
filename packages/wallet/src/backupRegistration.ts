export interface BackupRegistrationOptions {
	urls: string[]
	register: (url: string) => Promise<void>
	retryMsecs: number
	onError?: (url: string, err: unknown, attempts: number) => void
}

/**
 * Drives first-time registration of backup storage URLs out of band from
 * factory boot. Each URL is tried once on start; failures schedule a retry
 * at `retryMsecs`. Only one attempt per URL runs at a time — if a previous
 * attempt is still in flight when a retry fires, the retry is skipped.
 */
export class BackupRegistration {
	private readonly pending: Set<string>
	private readonly attempting: Set<string> = new Set()
	private readonly attempts: Map<string, number> = new Map()
	private readonly timers: Map<string, ReturnType<typeof setTimeout>> =
		new Map()
	private stopped = false

	constructor(private readonly opts: BackupRegistrationOptions) {
		this.pending = new Set(opts.urls)
	}

	start(): void {
		for (const url of this.pending) this.attempt(url)
	}

	stop(): void {
		this.stopped = true
		for (const t of this.timers.values()) clearTimeout(t)
		this.timers.clear()
	}

	private attempt(url: string): void {
		if (this.stopped) return
		if (!this.pending.has(url)) return
		if (this.attempting.has(url)) return

		this.attempting.add(url)
		const count = (this.attempts.get(url) ?? 0) + 1
		this.attempts.set(url, count)

		void (async () => {
			try {
				await this.opts.register(url)
				this.pending.delete(url)
				this.attempts.delete(url)
			} catch (err) {
				if (this.opts.onError) this.opts.onError(url, err, count)
				if (!this.stopped && this.pending.has(url)) {
					const t = setTimeout(() => {
						this.timers.delete(url)
						this.attempt(url)
					}, this.opts.retryMsecs)
					this.timers.set(url, t)
				}
			} finally {
				this.attempting.delete(url)
			}
		})()
	}
}
