/**
 * Main popup page script
 *
 * Handles wallet setup, unlock, and display of wallet info.
 * Uses KeyStore for encrypted key management.
 */
import './popup' // Load popup utilities

async function init() {
	const {
		getWalletAddress,
		getWalletState,
		getConnectedSites,
		disconnectSite,
		fetchBalance,
		generateNewWallet,
		importWif,
		unlockWallet,
		lockWallet,
		exportBackup,
	} = window.popup

	const state = await getWalletState()

	// Get section elements
	const setupSection = document.getElementById('setup-section')!
	const unlockSection = document.getElementById('unlock-section')!
	const walletSection = document.getElementById('wallet-section')!

	// Hide all sections first
	setupSection.style.display = 'none'
	unlockSection.style.display = 'none'
	walletSection.style.display = 'none'

	// Show appropriate section based on state
	if (state === 'empty') {
		setupSection.style.display = 'block'
		setupSetupListeners()
		return
	}

	if (state === 'locked') {
		unlockSection.style.display = 'block'
		setupUnlockListeners()
		return
	}

	// State is 'unlocked' - show wallet info
	walletSection.style.display = 'block'

	// Load address
	const address = await getWalletAddress()
	document.getElementById('address')!.textContent = address

	// Load balance
	if (address !== 'No wallet yet') {
		const satoshis = await fetchBalance(address)
		const balanceEl = document.getElementById('balance')!
		balanceEl.className = 'balance'
		balanceEl.textContent = `${satoshis.toLocaleString()} sats`
	} else {
		document.getElementById('balance')!.textContent = '0 sats'
	}

	// Load connected sites
	const sites = await getConnectedSites()
	const sitesEl = document.getElementById('sites')!

	if (sites.length === 0) {
		sitesEl.innerHTML = '<li class="no-sites">No connected sites</li>'
	} else {
		sitesEl.innerHTML = sites
			.map(
				(site) => `
      <li>
        <span class="site-origin">${site}</span>
        <button class="disconnect-btn" data-origin="${site}">Disconnect</button>
      </li>
    `,
			)
			.join('')

		// Add disconnect handlers
		for (const btn of sitesEl.querySelectorAll('.disconnect-btn')) {
			btn.addEventListener('click', async (e) => {
				const origin = (e.target as HTMLElement).dataset.origin!
				await disconnectSite(origin)
				init() // Refresh
			})
		}
	}

	// Lock button
	document.getElementById('lock-btn')?.addEventListener('click', async () => {
		await lockWallet()
		init()
	})

	// Export backup button
	document.getElementById('export-btn')?.addEventListener('click', async () => {
		const passphrase = prompt('Enter passphrase for backup encryption:')
		if (!passphrase) return

		const result = await exportBackup(passphrase)
		if (result.backup) {
			const backupDisplay = document.getElementById('backup-display')!
			backupDisplay.textContent = result.backup
			backupDisplay.style.display = 'block'
		} else {
			alert(`Error: ${result.error}`)
		}
	})

	function setupSetupListeners() {
		// Generate new wallet
		document
			.getElementById('generate-btn')
			?.addEventListener('click', async () => {
				const passphraseInput = document.getElementById(
					'setup-passphrase',
				) as HTMLInputElement
				const passphrase = passphraseInput.value.trim()

				if (passphrase.length < 8) {
					alert('Passphrase must be at least 8 characters')
					return
				}

				const result = await generateNewWallet(passphrase)
				if (result.addresses) {
					alert(
						`Generated new wallet!\n\nAddress: ${result.addresses.paymentAddress}`,
					)
					init()
				} else {
					alert(`Error: ${result.error}`)
				}
			})

		// Import WIF
		document
			.getElementById('import-btn')
			?.addEventListener('click', async () => {
				const wifInput = document.getElementById(
					'wif-input',
				) as HTMLInputElement
				const passphraseInput = document.getElementById(
					'setup-passphrase',
				) as HTMLInputElement

				const wif = wifInput.value.trim()
				const passphrase = passphraseInput.value.trim()

				if (!wif) {
					alert('Please enter a WIF')
					return
				}

				if (passphrase.length < 8) {
					alert('Passphrase must be at least 8 characters')
					return
				}

				const result = await importWif(wif, passphrase)
				if (result.addresses) {
					alert(`Imported wallet!\nAddress: ${result.addresses.paymentAddress}`)
					init()
				} else {
					alert(`Error: ${result.error}`)
				}
			})
	}

	function setupUnlockListeners() {
		document
			.getElementById('unlock-btn')
			?.addEventListener('click', async () => {
				const passphraseInput = document.getElementById(
					'unlock-passphrase',
				) as HTMLInputElement
				const passphrase = passphraseInput.value.trim()

				if (!passphrase) {
					alert('Please enter your passphrase')
					return
				}

				const result = await unlockWallet(passphrase)
				if (result.success) {
					init()
				} else {
					alert(`Error: ${result.error}`)
					passphraseInput.value = ''
				}
			})
	}
}

init()
