declare module '@bopen-io/messagebox-server' {
	import type { Server as HttpServer } from 'node:http'
	export const http: HttpServer
	export const io: {
		close(cb?: () => void): void
	} | null
	export const HTTP_PORT: number
	export const ROUTING_PREFIX: string
	export function start(): Promise<void>
}
