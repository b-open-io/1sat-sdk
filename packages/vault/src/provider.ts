export interface VaultAvailability {
	supported: boolean
	biometryType: 'TouchID' | 'FaceID' | 'WindowsHello' | 'None'
	biometryAvailable: boolean
}

export interface VaultProvider {
	readonly platform: string
	isSupported(): boolean
	checkAvailability(): Promise<VaultAvailability>
	generateKey(label: string): Promise<{ publicKey: string }>
	encrypt(label: string, plaintext: string): Promise<string>
	decrypt(label: string, ciphertext: string): Promise<string>
	deleteKey(label: string): Promise<void>
	listKeys(): Promise<Array<{ label: string; publicKey: string }>>
}
