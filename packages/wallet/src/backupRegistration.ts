export interface BackupRegistrationOptions {
	urls: string[]
	register: (url: string) => Promise<void>
	onError?: (url: string, err: unknown) => void
}

/**
 * Fires one async registration attempt per backup URL out of band from
 * factory boot. No retry: in long-lived processes the periodic
 * `BackupSync` monitor task handles ongoing reconciliation; in transient
 * processes (CLI invocations, service worker wakes) the next wake provides
 * the retry cadence. Repeated retry inside a single process duplicates
 * those existing mechanisms.
 *
 * `stop()` aborts the work if the wallet is destroyed before in-flight
 * registrations complete (the in-flight promise is allowed to settle but
 * its result is ignored).
 */
export class BackupRegistration {
	private stopped = false

	constructor(private readonly opts: BackupRegistrationOptions) {}

	start(): void {
		for (const url of this.opts.urls) this.attempt(url)
	}

	stop(): void {
		this.stopped = true
	}

	private attempt(url: string): void {
		void (async () => {
			try {
				await this.opts.register(url)
			} catch (err) {
				if (!this.stopped && this.opts.onError) this.opts.onError(url, err)
			}
		})()
	}
}
