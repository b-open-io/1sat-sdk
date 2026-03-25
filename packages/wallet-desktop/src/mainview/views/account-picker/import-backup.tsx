import { Button } from '@/components/ui/button'
import { ChevronLeft, FileKey, KeyRound, Loader2, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AccountInfo } from '../../../shared/types'
import { rpc } from '../../rpc'

interface ImportBackupProps {
	onComplete: (accounts: AccountInfo[]) => void
	onCancel: () => void
}

type Step = 'choose' | 'mnemonic' | 'file-password' | 'importing' | 'done'

export function ImportBackup({ onComplete, onCancel }: ImportBackupProps) {
	const [step, setStep] = useState<Step>('choose')
	const [inputData, setInputData] = useState('')
	const [fileName, setFileName] = useState<string | null>(null)
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [importedAccounts, setImportedAccounts] = useState<AccountInfo[]>([])
	const [importErrors, setImportErrors] = useState<string[]>([])

	const handleImport = useCallback(async (data: string, pw: string) => {
		setError(null)
		setStep('importing')
		try {
			const result = await rpc.request.importBackup({
				encryptedData: data,
				password: pw,
			})
			if (!result.success) {
				setError(result.errors[0] ?? 'Import failed')
				setStep(pw ? 'file-password' : 'mnemonic')
				return
			}
			setImportedAccounts(result.accounts)
			setImportErrors(result.errors)
			setStep('done')
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setStep(pw ? 'file-password' : 'mnemonic')
		}
	}, [])

	const handlePickFile = useCallback(async () => {
		setError(null)
		const result = await rpc.request.pickFile({ allowedFileTypes: '*' })
		if ('error' in result) {
			if (result.error !== 'No file selected') setError(result.error)
			return
		}
		setFileName(result.filename)
		try {
			const bytes = Uint8Array.from(atob(result.base64Content), (c) => c.charCodeAt(0))
			const text = new TextDecoder().decode(bytes)
			setInputData(text)

			// Check if the file is unencrypted JSON — if so, import directly
			try {
				JSON.parse(text)
				handleImport(text, '')
			} catch {
				// Not JSON — likely encrypted, ask for password
				setStep('file-password')
			}
		} catch {
			setError('Failed to read file')
		}
	}, [handleImport])

	// ---- Done screen ----
	if (step === 'done') {
		return (
			<CenteredContainer>
				<div className="flex flex-col items-center mb-8">
					<div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
						<FileKey className="size-8 text-green-500" />
					</div>
					<h2 className="text-lg font-semibold text-foreground">
						Import Complete
					</h2>
					<p className="text-sm text-muted-foreground mt-1">
						{importedAccounts.length === 1
							? '1 account imported'
							: `${importedAccounts.length} accounts imported`}
					</p>
				</div>

				{importedAccounts.length > 0 && (
					<div className="space-y-2 mb-6">
						{importedAccounts.map((a) => (
							<AccountRow key={a.id} account={a} />
						))}
					</div>
				)}

				{importErrors.length > 0 && (
					<div className="mb-6 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
						{importErrors.map((err, i) => (
							<p key={`err-${i}`} className="text-xs text-destructive">{err}</p>
						))}
					</div>
				)}

				<Button className="w-full" onClick={() => onComplete(importedAccounts)}>
					Continue
				</Button>
			</CenteredContainer>
		)
	}

	// ---- Importing ----
	if (step === 'importing') {
		return (
			<CenteredContainer>
				<div className="text-center">
					<Loader2 className="size-8 animate-spin text-primary mx-auto mb-4" />
					<p className="text-sm font-medium text-foreground">Importing...</p>
					<p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
				</div>
			</CenteredContainer>
		)
	}

	// ---- Mnemonic input ----
	if (step === 'mnemonic') {
		return (
			<CenteredContainer>
				<div className="flex flex-col items-center mb-6">
					<KeyRound className="size-8 text-muted-foreground mb-3" />
					<h2 className="text-lg font-semibold text-foreground">Enter Recovery Phrase</h2>
					<p className="text-sm text-muted-foreground mt-1 text-center">
						Enter your 12 or 24 word mnemonic
					</p>
				</div>

				<textarea
					autoFocus
					value={inputData}
					onChange={(e) => setInputData(e.target.value)}
					placeholder="word1 word2 word3 ..."
					rows={3}
					className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm mb-4 resize-none"
				/>

				{error && <p className="text-sm text-destructive mb-4 text-center">{error}</p>}

				<div className="flex gap-3">
					<Button variant="outline" className="flex-1" onClick={() => { setStep('choose'); setInputData(''); setError(null) }}>
						<ChevronLeft className="size-4" />
						Back
					</Button>
					<Button
						className="flex-1"
						disabled={!inputData.trim()}
						onClick={() => handleImport(inputData.trim(), '')}
					>
						Import
					</Button>
				</div>
			</CenteredContainer>
		)
	}

	// ---- File password ----
	if (step === 'file-password') {
		return (
			<CenteredContainer>
				<div className="flex flex-col items-center mb-6">
					<FileKey className="size-8 text-primary mb-3" />
					<h2 className="text-lg font-semibold text-foreground">Enter Password</h2>
					{fileName && (
						<p className="text-xs text-muted-foreground mt-1 font-mono">{fileName}</p>
					)}
				</div>

				<input
					type="password"
					autoFocus
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && password) handleImport(inputData, password)
					}}
					placeholder="Backup password"
					className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary mb-4"
				/>

				{error && <p className="text-sm text-destructive mb-4 text-center">{error}</p>}

				<div className="flex gap-3">
					<Button variant="outline" className="flex-1" onClick={() => { setStep('choose'); setInputData(''); setPassword(''); setError(null) }}>
						<ChevronLeft className="size-4" />
						Back
					</Button>
					<Button className="flex-1" disabled={!password} onClick={() => handleImport(inputData, password)}>
						Decrypt & Import
					</Button>
				</div>
			</CenteredContainer>
		)
	}

	// ---- Choose method ----
	return (
		<CenteredContainer>
			<div className="flex flex-col items-center mb-8">
				<Upload className="size-8 text-muted-foreground mb-3" />
				<h2 className="text-lg font-semibold text-foreground">Use Backup</h2>
				<p className="text-sm text-muted-foreground mt-1 text-center">
					Import from a backup file or recovery phrase
				</p>
			</div>

			{error && <p className="text-sm text-destructive mb-4 text-center">{error}</p>}

			<div className="flex flex-col gap-3">
				<Button className="w-full" size="lg" onClick={handlePickFile}>
					<Upload className="size-4" />
					Choose Backup File
				</Button>
				<Button variant="secondary" className="w-full" size="lg" onClick={() => setStep('mnemonic')}>
					<KeyRound className="size-4" />
					Enter Recovery Phrase
				</Button>
				<Button variant="outline" className="w-full" onClick={onCancel}>
					<ChevronLeft className="size-4" />
					Back
				</Button>
			</div>
		</CenteredContainer>
	)
}

function CenteredContainer({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen flex flex-col items-center justify-center select-none">
			<div className="max-w-sm w-full px-6">{children}</div>
		</div>
	)
}

function AccountRow({ account }: { account: AccountInfo }) {
	const initials = account.displayName
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
	return (
		<div className="flex items-center gap-3 p-3 bg-card rounded-lg">
			<div className={`w-8 h-8 rounded-full bg-${account.color}-500 flex items-center justify-center text-xs font-bold text-white`}>
				{initials}
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium truncate">{account.displayName}</p>
				<p className="text-[10px] text-muted-foreground font-mono truncate">
					{account.identityKey.slice(0, 16)}...
				</p>
			</div>
		</div>
	)
}
