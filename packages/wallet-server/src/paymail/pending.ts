/**
 * In-flight P2P payment refs — port of 1sat-stack/pkg/paymail store (15m TTL).
 * Knex-backed so it shares the host's DB (sqlite or pg) like messagebox.
 */

import type { Knex } from 'knex'
import type { PendingPayment, PendingStore } from './types.js'

export const DEFAULT_TTL_MS = 15 * 60 * 1000

export function generateReference(): string {
	const b = new Uint8Array(16)
	crypto.getRandomValues(b)
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export class KnexPendingStore implements PendingStore {
	constructor(private db: Knex) {}

	async init(): Promise<void> {
		const has = await this.db.schema.hasTable('paymail_pending')
		if (!has) {
			await this.db.schema.createTable('paymail_pending', (t) => {
				t.string('reference').primary()
				t.string('alias').notNullable()
				t.string('domain').notNullable()
				t.string('identity_pub_key').notNullable()
				t.string('derivation_prefix').notNullable()
				t.string('derivation_suffix').notNullable()
				t.bigInteger('satoshis').notNullable()
				t.text('output_script').notNullable()
				t.string('txid').nullable()
				t.string('created_at').notNullable()
				t.string('expires_at').notNullable()
				t.index('expires_at', 'idx_paymail_pending_expires')
			})
		}
	}

	async create(p: PendingPayment): Promise<void> {
		await this.db('paymail_pending').insert({
			reference: p.reference,
			alias: p.alias,
			domain: p.domain,
			identity_pub_key: p.identityPubKey,
			derivation_prefix: p.derivationPrefix,
			derivation_suffix: p.derivationSuffix,
			satoshis: p.satoshis,
			output_script: p.outputScript,
			txid: p.txid ?? null,
			created_at: p.createdAt.toISOString(),
			expires_at: p.expiresAt.toISOString(),
		})
	}

	async get(reference: string): Promise<PendingPayment | null> {
		const row = await this.db('paymail_pending').where({ reference }).first()
		if (!row) return null
		const expiresAt = new Date(row.expires_at)
		if (expiresAt.getTime() < Date.now() && !row.txid) {
			await this.delete(reference)
			return null
		}
		return {
			reference: row.reference,
			alias: row.alias,
			domain: row.domain,
			identityPubKey: row.identity_pub_key,
			derivationPrefix: row.derivation_prefix,
			derivationSuffix: row.derivation_suffix,
			satoshis: Number(row.satoshis),
			outputScript: row.output_script,
			txid: row.txid ?? undefined,
			createdAt: new Date(row.created_at),
			expiresAt,
		}
	}

	async update(p: PendingPayment): Promise<void> {
		await this.db('paymail_pending')
			.where({ reference: p.reference })
			.update({
				txid: p.txid ?? null,
			})
	}

	async delete(reference: string): Promise<void> {
		await this.db('paymail_pending').where({ reference }).delete()
	}

	async purgeExpired(): Promise<void> {
		await this.db('paymail_pending')
			.where('expires_at', '<', new Date().toISOString())
			.whereNull('txid')
			.delete()
	}
}
