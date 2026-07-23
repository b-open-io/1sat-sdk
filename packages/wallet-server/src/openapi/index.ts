/**
 * OpenAPI assembly for the host server. The spec is built per request from
 * the surfaces actually mounted, so a deployment's docs never advertise
 * routes it doesn't serve. Canonical paths only — the legacy root-mounted
 * messagebox aliases are undocumented by design.
 */

import type { Express } from 'express'
import {
	type PathsFragment,
	TAG_DOCS,
	accountPaths,
	authPaths,
	hostingPaths,
	messageboxPaths,
	paymailPaths,
	storagePaths,
} from './fragments'

export interface OpenApiSurfaces {
	storage?: boolean
	accounts?: boolean
	/** Getter so a live config toggle is reflected without restart. */
	hosting?: () => boolean
	paymail?: boolean
	messagebox?: boolean
}

export interface OpenApiOptions {
	serverIdentityKey: string
	surfaces: OpenApiSurfaces
	title?: string
	description?: string
	version?: string
}

export function buildOpenApiSpec(options: OpenApiOptions): object {
	const paths: PathsFragment = { ...authPaths() }
	const tags = new Set(['auth'])
	if (options.surfaces.storage) {
		Object.assign(paths, storagePaths())
		tags.add('storage')
	}
	if (options.surfaces.accounts) {
		Object.assign(paths, accountPaths())
		tags.add('account')
	}
	if (options.surfaces.hosting?.()) {
		Object.assign(paths, hostingPaths())
		tags.add('hosting')
	}
	if (options.surfaces.paymail) {
		Object.assign(paths, paymailPaths())
		tags.add('paymail')
	}
	if (options.surfaces.messagebox) {
		Object.assign(paths, messageboxPaths())
		tags.add('messagebox')
	}

	return {
		openapi: '3.0.3',
		info: {
			title: options.title ?? '1sat Wallet Host Server',
			version: options.version ?? '1.0.0',
			description:
				options.description ??
				'BRC-100 wallet storage host. Authenticated surfaces use BRC-103/104 mutual auth (one handshake at POST /.well-known/auth covers all of them); paid surfaces use the BRC-41 402 payment flow.',
		},
		'x-server-identity-key': options.serverIdentityKey,
		tags: TAG_DOCS.filter((t) => tags.has(t.name)),
		components: {
			securitySchemes: {
				brc104: {
					type: 'apiKey',
					in: 'header',
					name: 'x-bsv-auth-identity-key',
					description:
						'BRC-103/104 mutual authentication. Use an auth-capable client (e.g. AuthFetch from @bsv/sdk); requests are signed, not bearer-token authorized.',
				},
			},
		},
		paths,
	}
}

/** Scalar shell — renders /openapi.json client-side. Needs internet for the CDN script; the API itself does not. */
function docsShellHtml(title: string): string {
	const safeTitle = title
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
</head>
<body>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
<script>Scalar.createApiReference('#app', { url: '/openapi.json' })</script>
</body>
</html>`
}

export function mountOpenApiRoutes(
	app: Express,
	options: OpenApiOptions,
): void {
	app.get('/openapi.json', (_req, res) => {
		res.json(buildOpenApiSpec(options))
	})
	app.get('/', (_req, res) => {
		res
			.type('html')
			.send(docsShellHtml(options.title ?? '1sat Wallet Host Server'))
	})
}
