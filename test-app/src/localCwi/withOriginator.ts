import type { WalletInterface } from '@bsv/sdk'

/**
 * Bind a fixed originator as the 2nd arg to every wallet method (BRC-100).
 * Same pattern as yours-wallet admin wrap.
 */
export function withOriginator(
	wallet: WalletInterface,
	originator: string,
): WalletInterface {
	return new Proxy(wallet, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver)
			if (typeof value !== 'function') return value
			return (...args: unknown[]) => {
				if (args.length < 2 || args[1] === undefined) {
					return (value as (...a: unknown[]) => unknown).call(
						target,
						args[0],
						originator,
					)
				}
				return (value as (...a: unknown[]) => unknown).apply(target, args)
			}
		},
	}) as WalletInterface
}
