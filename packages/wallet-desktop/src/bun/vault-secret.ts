export interface RootKeySecretSummary {
	label: string
	metadata?: Record<string, string>
}

export async function protectRootKeyOnce(args: {
	existing?: RootKeySecretSummary
	accountId: string
	identityKey: string
	label: string
	rootIdentityKey: string
	rootKeyHex: string
	unlock: (label: string) => Promise<{ plaintext: string }>
	protect: (
		label: string,
		plaintext: string,
		metadata: Record<string, string>,
	) => Promise<void>
}): Promise<void> {
	const {
		existing,
		accountId,
		identityKey,
		label,
		rootIdentityKey,
		rootKeyHex,
		unlock,
		protect,
	} = args

	if (existing) {
		const { plaintext } = await unlock(label)
		if (plaintext !== rootKeyHex) {
			throw new Error('Vault account already contains a different root key')
		}
		if (
			existing.metadata &&
			(existing.metadata.accountId !== accountId ||
				existing.metadata.identityKey !== identityKey ||
				existing.metadata.rootIdentityKey !== rootIdentityKey)
		) {
			throw new Error(
				'Vault account metadata does not match the wallet identity',
			)
		}
		if (!existing.metadata && identityKey !== rootIdentityKey) {
			throw new Error('Vault account is missing its identity relationship')
		}
		return
	}

	await protect(label, rootKeyHex, {
		accountId,
		identityKey,
		rootIdentityKey,
	})
}
