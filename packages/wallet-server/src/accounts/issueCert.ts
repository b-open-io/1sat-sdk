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
	try {
		await opts.store.put(issued)
	} catch (err) {
		// Two requests can issue the same cert at once (a paymail lookup
		// backfilling it while the wallet re-registers). The loser's insert
		// hits the (domain, handle) key; the winner's cert is the one to use.
		const winner = await opts.store.get(handle, domain)
		if (
			winner &&
			winner.subject === opts.subject &&
			winner.revocationOutpoint === opts.revocationOutpoint
		) {
			return winner
		}
		throw err
	}
	return issued
}

/**
 * The user-domain cert for a registered username, issued if missing.
 * Idempotent: an existing cert for the same identity is returned as is.
 */
export async function ensureUserDomainCert(
	certs: { store: HandleCertStore; hostPrivateKey: PrivateKey },
	userDomain: string,
	identityKey: string,
	username: string,
) {
	return issueHandleCert({
		store: certs.store,
		hostPrivateKey: certs.hostPrivateKey,
		subject: identityKey,
		handle: username,
		domain: userDomain,
		revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
	})
}

export { DISABLED_REVOCATION_OUTPOINT }
