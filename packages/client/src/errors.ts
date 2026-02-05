/**
 * HTTP error with status code for granular error handling
 */
export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message)
		this.name = 'HttpError'
	}
}
