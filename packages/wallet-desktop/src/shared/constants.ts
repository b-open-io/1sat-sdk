/** BRC-100 wallet server ports — shared between Bun and WebView */
export const WALLET_HTTP_PORT = 3321
export const WALLET_HTTPS_PORT = 2121
export const WALLET_HOST = '127.0.0.1'

/** Base URL for the wallet HTTP server (used by AI chat transport, model fetch, etc.) */
export const WALLET_HTTP_URL = `http://${WALLET_HOST}:${WALLET_HTTP_PORT}`
