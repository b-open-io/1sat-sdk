import { deriveIdentityKey } from '@1sat/utils'
import {
	type DecryptedBackup,
	decryptBackup,
	getBackupType,
	isOneSatBackup,
	isWifBackup,
	isYoursWalletBackup,
} from 'bitcoin-backup'
import { KeyRound, Loader2, Search, Upload, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { deriveAddress } from '../lib/scanner'
import type { LegacyKeys } from '../types'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

interface Props {
	onScan: (keys: LegacyKeys) => void
	scanning: boolean
	disabled: boolean
}

type InputMode = 'choose' | 'backup' | 'wif'

function withIdentityKey(keys: LegacyKeys): LegacyKeys {
	if (keys.identityPk) return keys
	return {
		...keys,
		identityPk: deriveIdentityKey(keys.payPk, keys.ordPk).toWif(),
	}
}

function extractKeys(backup: DecryptedBackup): LegacyKeys | null {
	if (isOneSatBackup(backup)) {
		return withIdentityKey({
			payPk: backup.payPk,
			ordPk: backup.ordPk,
			identityPk: backup.identityPk,
		})
	}
	if (isYoursWalletBackup(backup)) {
		return withIdentityKey({
			payPk: backup.payPk,
			ordPk: backup.ordPk,
			identityPk: backup.identityPk,
		})
	}
	if (isWifBackup(backup)) {
		return withIdentityKey({
			payPk: backup.wif,
			ordPk: backup.wif,
		})
	}
	return null
}

function tryParseBackup(text: string): LegacyKeys | null {
	try {
		const parsed = JSON.parse(text)
		if (parsed.payPk && parsed.ordPk) {
			return withIdentityKey({
				payPk: parsed.payPk,
				ordPk: parsed.ordPk,
				identityPk: parsed.identityPk,
			})
		}
		if (parsed.accounts && parsed.selectedAccount) {
			const account = parsed.accounts[parsed.selectedAccount]
			if (account?.encryptedKeys) {
				return null
			}
		}
	} catch {
		// Not JSON
	}
	return null
}

function looksEncrypted(text: string): boolean {
	if (text.startsWith('{')) return false
	if (text.startsWith('5') || text.startsWith('K') || text.startsWith('L'))
		return false
	return text.length > 50
}

export function WifInput({ onScan, scanning, disabled }: Props) {
	const [mode, setMode] = useState<InputMode>('choose')
	const [keys, setKeys] = useState<LegacyKeys | null>(null)
	const [backupText, setBackupText] = useState('')
	const [password, setPassword] = useState('')
	const [needsPassword, setNeedsPassword] = useState(false)
	const [decrypting, setDecrypting] = useState(false)
	const [error, setError] = useState('')
	const [backupType, setBackupType] = useState('')
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [payWif, setPayWif] = useState('')
	const [ordWif, setOrdWif] = useState('')
	const [sameKey, setSameKey] = useState(true)

	const handleReset = useCallback(() => {
		setKeys(null)
		setBackupText('')
		setPassword('')
		setNeedsPassword(false)
		setError('')
		setBackupType('')
		setMode('choose')
		setPayWif('')
		setOrdWif('')
	}, [])

	const processBackupText = useCallback(async (text: string) => {
		setError('')
		setBackupText(text)

		const directKeys = tryParseBackup(text)
		if (directKeys) {
			setKeys(directKeys)
			setBackupType('JSON')
			return
		}

		try {
			const parsed = JSON.parse(text)
			if (parsed.encryptedBackup) {
				setBackupText(parsed.encryptedBackup)
				setNeedsPassword(true)
				return
			}
			if (parsed.encryptedKeys) {
				setBackupText(parsed.encryptedKeys)
				setNeedsPassword(true)
				return
			}
			if (parsed.accounts && parsed.selectedAccount) {
				const account = parsed.accounts[parsed.selectedAccount]
				if (account?.encryptedKeys) {
					setBackupText(account.encryptedKeys)
					setNeedsPassword(true)
					return
				}
			}
		} catch {
			// Not JSON
		}

		if (looksEncrypted(text)) {
			setNeedsPassword(true)
			return
		}

		setError('Unrecognized backup format')
	}, [])

	const handleDecrypt = useCallback(async () => {
		if (!backupText || !password) return
		setDecrypting(true)
		setError('')

		try {
			const decrypted = await decryptBackup(backupText, password)
			const extracted = extractKeys(decrypted)
			if (!extracted) {
				setError(`Unsupported backup type: ${getBackupType(decrypted)}`)
				return
			}
			setKeys(extracted)
			setBackupType(getBackupType(decrypted))
			setNeedsPassword(false)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Decryption failed')
		} finally {
			setDecrypting(false)
		}
	}, [backupText, password])

	const handleFileUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0]
			if (!file) return
			const reader = new FileReader()
			reader.onload = () => {
				processBackupText((reader.result as string).trim())
			}
			reader.readAsText(file)
			e.target.value = ''
		},
		[processBackupText],
	)

	const handleScan = useCallback(() => {
		if (keys) {
			onScan(keys)
		} else if (mode === 'wif') {
			const pay = payWif.trim()
			const ord = sameKey ? pay : ordWif.trim()
			if (pay) onScan({ payPk: pay, ordPk: ord })
		}
	}, [keys, mode, payWif, ordWif, sameKey, onScan])

	if (keys) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							Legacy Keys
						</CardTitle>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0"
							onClick={handleReset}
						>
							<X className="h-3 w-3" />
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					{backupType && (
						<span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
							{backupType}
						</span>
					)}
					<div className="space-y-1 text-xs text-muted-foreground font-mono">
						<div>Pay: {deriveAddress(keys.payPk)}</div>
						{keys.ordPk !== keys.payPk && (
							<div>Ord: {deriveAddress(keys.ordPk)}</div>
						)}
						{keys.identityPk && keys.identityPk !== keys.payPk && (
							<div>ID: {deriveAddress(keys.identityPk)}</div>
						)}
					</div>
					<Button
						onClick={handleScan}
						disabled={disabled || scanning}
						className="w-full"
					>
						{scanning ? (
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
						) : (
							<Search className="h-4 w-4 mr-2" />
						)}
						{scanning ? 'Scanning...' : 'Scan for Assets'}
					</Button>
				</CardContent>
			</Card>
		)
	}

	if (mode === 'choose') {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound className="h-5 w-5" />
						Legacy Keys
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<input
						ref={fileInputRef}
						type="file"
						accept=".json,.bep,.txt"
						className="hidden"
						onChange={handleFileUpload}
					/>
					<Button
						variant="outline"
						className="w-full gap-2"
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload className="h-4 w-4" />
						Import Backup File
					</Button>
					<Button
						variant="outline"
						className="w-full gap-2"
						onClick={() => setMode('backup')}
					>
						Paste Backup Data
					</Button>
					<Button
						variant="ghost"
						className="w-full text-xs text-muted-foreground"
						onClick={() => setMode('wif')}
					>
						Enter WIF keys manually
					</Button>
				</CardContent>
			</Card>
		)
	}

	if (mode === 'backup') {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							Import Backup
						</CardTitle>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0"
							onClick={handleReset}
						>
							<X className="h-3 w-3" />
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					{!needsPassword ? (
						<>
							<textarea
								placeholder="Paste backup JSON or encrypted data..."
								className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono resize-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
								onChange={(e) => processBackupText(e.target.value.trim())}
							/>
							<input
								ref={fileInputRef}
								type="file"
								accept=".json,.bep,.txt"
								className="hidden"
								onChange={handleFileUpload}
							/>
							<Button
								variant="outline"
								size="sm"
								className="w-full gap-2"
								onClick={() => fileInputRef.current?.click()}
							>
								<Upload className="h-4 w-4" />
								Or upload a file
							</Button>
						</>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								This backup is encrypted. Enter the password to decrypt.
							</p>
							<Input
								type="password"
								placeholder="Backup password..."
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleDecrypt()
								}}
							/>
							<Button
								onClick={handleDecrypt}
								disabled={!password || decrypting}
								className="w-full"
							>
								{decrypting ? (
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
								) : null}
								{decrypting ? 'Decrypting...' : 'Decrypt'}
							</Button>
						</>
					)}
					{error && <p className="text-sm text-destructive">{error}</p>}
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2">
						<KeyRound className="h-5 w-5" />
						Manual WIF Entry
					</CardTitle>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0"
						onClick={handleReset}
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<label className="text-sm font-medium">
						{sameKey ? 'Private Key (WIF)' : 'Pay Key (WIF)'}
					</label>
					<Input
						type="password"
						placeholder="Enter WIF private key..."
						value={payWif}
						onChange={(e) => setPayWif(e.target.value)}
						disabled={disabled || scanning}
					/>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={sameKey}
						onChange={(e) => setSameKey(e.target.checked)}
						disabled={disabled || scanning}
					/>
					Same key for pay and ordinals
				</label>
				{!sameKey && (
					<div className="space-y-2">
						<label className="text-sm font-medium">Ordinals Key (WIF)</label>
						<Input
							type="password"
							placeholder="Enter ordinals WIF..."
							value={ordWif}
							onChange={(e) => setOrdWif(e.target.value)}
							disabled={disabled || scanning}
						/>
					</div>
				)}
				<Button
					onClick={handleScan}
					disabled={disabled || scanning || !payWif.trim()}
					className="w-full"
				>
					{scanning ? (
						<Loader2 className="h-4 w-4 animate-spin mr-2" />
					) : (
						<Search className="h-4 w-4 mr-2" />
					)}
					{scanning ? 'Scanning...' : 'Scan for Assets'}
				</Button>
			</CardContent>
		</Card>
	)
}
