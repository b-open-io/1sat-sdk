import { Button } from '@/components/ui/button'
import { ChevronLeft, FileKey, Loader2, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AccountInfo } from '../../../shared/types'
import { rpc } from '../../rpc'

interface ImportBackupProps {
	onComplete: (accounts: AccountInfo[]) => void
	onCancel: () => void
}

export function ImportBackup({ onComplete, onCancel }: ImportBackupProps) {
	const [step, setStep] = useState<'file' | 'password' | 'importing' | 'done'>('file')
	const [fileData, setFileData] = useState<string | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	const [password, setPassword] = useState('')
	const [progress, setProgress] = useState<string>('')
	const [error, setError] = useState<string | null>(null)
	const [importedAccounts, setImportedAccounts] = useState<AccountInfo[]>([])
	const [importErrors, setImportErrors] = useState<string[]>([])

	const handlePickFile = useCallback(async () => {
		setError(null)
		const result = await rpc.request.pickFile({ allowedFileTypes: '*' })
		if ('error' in result) {
			if (result.error !== 'No file selected') {
				setError(result.error)
			}
			return
		}
		setFileName(result.filename)
		// The file is base64 — we need the raw text content for encrypted backups
		// Decode base64 to get the encrypted string
		try {
			const bytes = Uint8Array.from(atob(result.base64Content), (c) => c.charCodeAt(0))
			const text = new TextDecoder().decode(bytes)
			setFileData(text)
			setStep('password')
		} catch {
			setError('Failed to read backup file')
		}
	}, [])

	const handleImport = useCallback(async () => {
		if (!fileData) return
		setError(null)
		setStep('importing')
		setProgress('Decrypting backup...')

		try {
			const result = await rpc.request.importBackup({
				encryptedData: fileData,
				password,
			})
			if (!result.success) {
				setError(result.errors[0] ?? 'Import failed')
				setStep('password')
				return
			}
			setImportedAccounts(result.accounts)
			setImportErrors(result.errors)
			setStep('done')
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setStep('password')
		}
	}, [fileData, password])

	if (step === 'done') {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center select-none">
				<div className="max-w-sm w-full px-6">
					<div className="flex flex-col items-center mb-8">
						<div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
							<FileKey className="size-8 text-green-500" />
						</div>
						<h2 className="text-lg font-semibold text-foreground">
							Import Complete
						</h2>
						<p className="text-sm text-muted-foreground mt-1 text-center">
							{importedAccounts.length === 1
								? '1 account imported'
								: `${importedAccounts.length} accounts imported`}
						</p>
					</div>

					{importedAccounts.length > 0 && (
						<div className="space-y-2 mb-6">
							{importedAccounts.map((a) => (
								<div
									key={a.id}
									className="flex items-center gap-3 p-3 bg-card rounded-lg"
								>
									<div
										className={`w-8 h-8 rounded-full bg-${a.color}-500 flex items-center justify-center text-xs font-bold text-white`}
									>
										{a.displayName
											.split(/\s+/)
											.map((w) => w[0])
											.join('')
											.toUpperCase()
											.slice(0, 2)}
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium truncate">{a.displayName}</p>
										<p className="text-[10px] text-muted-foreground font-mono truncate">
											{a.identityKey.slice(0, 16)}...
										</p>
									</div>
								</div>
							))}
						</div>
					)}

					{importErrors.length > 0 && (
						<div className="mb-6 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
							{importErrors.map((err, i) => (
								<p key={`err-${i}`} className="text-xs text-destructive">
									{err}
								</p>
							))}
						</div>
					)}

					<Button className="w-full" onClick={() => onComplete(importedAccounts)}>
						Continue
					</Button>
				</div>
			</div>
		)
	}

	if (step === 'importing') {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center select-none">
				<div className="max-w-sm w-full px-6 text-center">
					<Loader2 className="size-8 animate-spin text-primary mx-auto mb-4" />
					<p className="text-sm font-medium text-foreground">{progress}</p>
					<p className="text-xs text-muted-foreground mt-1">
						This may take a moment...
					</p>
				</div>
			</div>
		)
	}

	if (step === 'password') {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center select-none">
				<div className="max-w-sm w-full px-6">
					<div className="flex flex-col items-center mb-8">
						<div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
							<FileKey className="size-8 text-primary" />
						</div>
						<h2 className="text-lg font-semibold text-foreground">
							Enter Backup Password
						</h2>
						<p className="text-sm text-muted-foreground mt-1 text-center">
							{fileName && (
								<span className="font-mono text-xs">{fileName}</span>
							)}
						</p>
					</div>

					<div className="mb-6">
						<input
							type="password"
							autoFocus
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && password) handleImport()
							}}
							placeholder="Backup password"
							className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
						/>
					</div>

					{error && (
						<p className="text-sm text-destructive mb-4 text-center">{error}</p>
					)}

					<div className="flex gap-3">
						<Button
							variant="outline"
							className="flex-1"
							onClick={() => {
								setStep('file')
								setPassword('')
								setError(null)
							}}
						>
							<ChevronLeft className="size-4" />
							Back
						</Button>
						<Button
							className="flex-1"
							disabled={!password}
							onClick={handleImport}
						>
							Decrypt & Import
						</Button>
					</div>
				</div>
			</div>
		)
	}

	// step === 'file'
	return (
		<div className="min-h-screen flex flex-col items-center justify-center select-none">
			<div className="max-w-sm w-full px-6">
				<div className="flex flex-col items-center mb-8">
					<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
						<Upload className="size-8 text-muted-foreground" />
					</div>
					<h2 className="text-lg font-semibold text-foreground">
						Import Backup
					</h2>
					<p className="text-sm text-muted-foreground mt-1 text-center">
						Select an encrypted backup file to import your identities and wallets.
					</p>
				</div>

				{error && (
					<p className="text-sm text-destructive mb-4 text-center">{error}</p>
				)}

				<div className="flex flex-col gap-3">
					<Button className="w-full" size="lg" onClick={handlePickFile}>
						<Upload className="size-4" />
						Choose Backup File
					</Button>
					<Button variant="outline" className="w-full" onClick={onCancel}>
						<ChevronLeft className="size-4" />
						Back
					</Button>
				</div>
			</div>
		</div>
	)
}
