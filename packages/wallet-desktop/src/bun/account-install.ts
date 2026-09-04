export async function installIfAccountMissing<
	TAccount extends { identityKey: string },
	TInstalled,
>(args: {
	existing: TAccount | undefined
	identityKey: string
	install: () => Promise<TInstalled>
}): Promise<
	| { alreadyExists: true; account: TAccount }
	| { alreadyExists: false; installed: TInstalled }
> {
	if (args.existing) {
		if (args.existing.identityKey !== args.identityKey) {
			throw new Error('Registered account does not match the requested key')
		}
		return { alreadyExists: true, account: args.existing }
	}

	return { alreadyExists: false, installed: await args.install() }
}
