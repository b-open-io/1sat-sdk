/**
 * Registered-users store — the 1sat.app name→identity backend.
 * Knex-backed like paymail_pending, sharing the host's DB (sqlite or pg).
 */

import type { Knex } from 'knex'
import type { RegisteredUser, UserStore } from './types'

/** Lowercase label: 3-63 chars, alphanumeric ends, no leading/trailing hyphen. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

export function normalizeUsername(input: unknown): string | null {
	if (typeof input !== 'string') return null
	const name = input.trim().toLowerCase()
	return USERNAME_RE.test(name) ? name : null
}

export class UsernameTakenError extends Error {
	constructor(username: string) {
		super(`username "${username}" is already registered`)
		this.name = 'UsernameTakenError'
	}
}

export class KnexUserStore implements UserStore {
	constructor(private db: Knex) {}

	async init(): Promise<void> {
		const has = await this.db.schema.hasTable('paymail_users')
		if (!has) {
			await this.db.schema.createTable('paymail_users', (t) => {
				t.string('username').primary()
				t.string('identity_key').notNullable()
				t.string('created_at').notNullable()
				t.index('identity_key', 'idx_paymail_users_identity')
			})
		}
	}

	async get(alias: string): Promise<RegisteredUser | null> {
		const row = await this.db('paymail_users')
			.where({ username: alias.toLowerCase() })
			.first()
		if (!row) return null
		return {
			username: row.username,
			identityKey: row.identity_key,
			createdAt: new Date(row.created_at),
		}
	}

	async getByIdentity(identityKey: string): Promise<RegisteredUser | null> {
		const row = await this.db('paymail_users')
			.where({ identity_key: identityKey })
			.orderBy('created_at', 'asc')
			.first()
		if (!row) return null
		return {
			username: row.username,
			identityKey: row.identity_key,
			createdAt: new Date(row.created_at),
		}
	}

	async claim(username: string, identityKey: string): Promise<RegisteredUser> {
		const existing = await this.get(username)
		if (existing) {
			if (existing.identityKey !== identityKey) {
				throw new UsernameTakenError(username)
			}
			return existing
		}
		const createdAt = new Date()
		try {
			await this.db('paymail_users').insert({
				username: username.toLowerCase(),
				identity_key: identityKey,
				created_at: createdAt.toISOString(),
			})
		} catch (err) {
			// PK race: someone claimed it between get() and insert().
			const winner = await this.get(username)
			if (winner) {
				if (winner.identityKey === identityKey) return winner
				throw new UsernameTakenError(username)
			}
			throw err
		}
		return { username: username.toLowerCase(), identityKey, createdAt }
	}
}
