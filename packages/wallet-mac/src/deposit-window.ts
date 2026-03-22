import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMacOS } from './platform'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function showDepositWindow(
	address: string,
	amountSats?: number,
): { pid: number; waitForClose: () => Promise<'funded' | 'cancelled'> } {
	assertMacOS()
	const enclavePath = resolve(__dirname, '../swift/enclave')
	const args = ['deposit', address]
	if (amountSats != null) args.push(String(amountSats))

	const proc = Bun.spawn([enclavePath, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	})

	return {
		pid: proc.pid,
		async waitForClose(): Promise<'funded' | 'cancelled'> {
			const stdout = await new Response(proc.stdout).text()
			await proc.exited
			try {
				const result = JSON.parse(stdout.trim())
				if (result.success && result.data === 'funded') return 'funded'
			} catch {
				// Parse failure means cancelled or unexpected output
			}
			return 'cancelled'
		},
	}
}

export function signalDepositReceived(pid: number): void {
	try {
		process.kill(pid, 'SIGUSR1')
	} catch {
		// Process may have already exited
	}
}
