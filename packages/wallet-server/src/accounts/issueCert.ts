import { DISABLED_REVOCATION_OUTPOINT, HANDLE_CERT_TYPE } from '@1sat/types'
import { MasterCertificate, type PrivateKey, ProtoWallet } from '@bsv/sdk'
import type { HandleCertStore, IssuedHandleCert } from './certs.js'

export async function issueHandleCert(opts: {
	store: HandleCertStore
	hostPrivateKey: PrivateKey
	subject: string
	handle: string
	domain: string
	revocationOutpoint: string
}): Promise<IssuedHandleCert> {
	const handle = opts.handle.toLowerCase()
	const domain = opts.domain.toLowerCase()
	const existing = await opts.store.get(handle, domain)
	if (
		existing &&
		existing.subject === opts.subject &&
		existing.revocationOutpoint === opts.revocationOutpoint
	) {
		return existing
	}

	const wallet = new ProtoWallet(opts.hostPrivateKey)
	const master = await MasterCertificate.issueCertificateForSubject(
		wallet,
		opts.subject,
		{ handle, domain },
		HANDLE_CERT_TYPE,
		async () => opts.revocationOutpoint,
	)
	if (!master.signature) throw new Error('certificate missing signature')

	const issued: IssuedHandleCert = {
		handle,
		domain,
		subject: opts.subject,
		revocationOutpoint: opts.revocationOutpoint,
		serialNumber: master.serialNumber,
		type: master.type,
		certifier: master.certifier,
		signature: master.signature,
		fields: master.fields,
		keyringForSubject: master.masterKeyring,
		createdAt: new Date(),
	}
	await opts.store.put(issued)
	return issued
}

export { DISABLED_REVOCATION_OUTPOINT }
