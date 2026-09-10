import type { Knex } from 'knex'

export interface IssuedHandleCert {
	handle: string
	domain: string
	subject: string
	revocationOutpoint: string
	serialNumber: string
	type: string
	certifier: string
	signature: string
	fields: Record<string, string>
	keyringForSubject: Record<string, string>
	createdAt: Date
}

export interface HandleCertStore {
	get(handle: string, domain: string): Promise<IssuedHandleCert | null>
	listBySubject(subject: string): Promise<IssuedHandleCert[]>
	put(cert: IssuedHandleCert): Promise<void>
}

interface CertRow {
	handle: string
	domain: string
	subject: string
	revocation_outpoint: string
	serial_number: string
	type: string
	certifier: string
	signature: string
	fields_json: string
	keyring_json: string
	created_at: string
}

function rowToCert(row: CertRow): IssuedHandleCert {
	return {
		handle: row.handle,
		domain: row.domain,
		subject: row.subject,
		revocationOutpoint: row.revocation_outpoint,
		serialNumber: row.serial_number,
		type: row.type,
		certifier: row.certifier,
		signature: row.signature,
		fields: JSON.parse(row.fields_json) as Record<string, string>,
		keyringForSubject: JSON.parse(row.keyring_json) as Record<string, string>,
		createdAt: new Date(row.created_at),
	}
}

export class KnexHandleCertStore implements HandleCertStore {
	constructor(private db: Knex) {}

	async init(): Promise<void> {
		const has = await this.db.schema.hasTable('handle_certs')
		if (has) return
		await this.db.schema.createTable('handle_certs', (t) => {
			t.string('handle').notNullable()
			t.string('domain').notNullable()
			t.string('subject').notNullable()
			t.string('revocation_outpoint').notNullable()
			t.string('serial_number').notNullable()
			t.string('type').notNullable()
			t.string('certifier').notNullable()
			t.string('signature').notNullable()
			t.text('fields_json').notNullable()
			t.text('keyring_json').notNullable()
			t.string('created_at').notNullable()
			t.primary(['domain', 'handle'])
			t.index('subject', 'idx_handle_certs_subject')
		})
	}

	async get(handle: string, domain: string): Promise<IssuedHandleCert | null> {
		const row = await this.db<CertRow>('handle_certs')
			.where({
				handle: handle.toLowerCase(),
				domain: domain.toLowerCase(),
			})
			.first()
		return row ? rowToCert(row) : null
	}

	async listBySubject(subject: string): Promise<IssuedHandleCert[]> {
		const rows = await this.db<CertRow>('handle_certs').where({ subject })
		return rows.map(rowToCert)
	}

	async put(cert: IssuedHandleCert): Promise<void> {
		const row: CertRow = {
			handle: cert.handle.toLowerCase(),
			domain: cert.domain.toLowerCase(),
			subject: cert.subject,
			revocation_outpoint: cert.revocationOutpoint,
			serial_number: cert.serialNumber,
			type: cert.type,
			certifier: cert.certifier,
			signature: cert.signature,
			fields_json: JSON.stringify(cert.fields),
			keyring_json: JSON.stringify(cert.keyringForSubject),
			created_at: cert.createdAt.toISOString(),
		}
		const existing = await this.get(row.handle, row.domain)
		if (existing) {
			await this.db('handle_certs')
				.where({ handle: row.handle, domain: row.domain })
				.update({
					subject: row.subject,
					revocation_outpoint: row.revocation_outpoint,
					serial_number: row.serial_number,
					type: row.type,
					certifier: row.certifier,
					signature: row.signature,
					fields_json: row.fields_json,
					keyring_json: row.keyring_json,
					created_at: row.created_at,
				})
			return
		}
		await this.db('handle_certs').insert(row)
	}
}

export function toDirectAcquireArgs(cert: IssuedHandleCert) {
	return {
		type: cert.type,
		certifier: cert.certifier,
		acquisitionProtocol: 'direct' as const,
		fields: cert.fields,
		serialNumber: cert.serialNumber,
		revocationOutpoint: cert.revocationOutpoint,
		signature: cert.signature,
		keyringRevealer: 'certifier' as const,
		keyringForSubject: cert.keyringForSubject,
		subject: cert.subject,
	}
}
