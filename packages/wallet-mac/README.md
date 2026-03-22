# @1sat/wallet-mac

![1sat vault — Hardware Security for BSV](../../assets/vault-infographic.png)

macOS wallet runtime with Secure Enclave, Touch ID, and a native deposit window. This is the macOS implementation of the [`@1sat/vault`](../vault/) interface.

---

## Installation

```bash
bun add @1sat/wallet-mac @1sat/vault
```

---

## Quick Start

```typescript
import { createVault, FileVaultStorage } from '@1sat/vault'
import { SecureEnclaveProvider } from '@1sat/wallet-mac'

const vault = createVault(
  new SecureEnclaveProvider({ name: 'My App' }),
  new FileVaultStorage('~/.my-vault'),
)

// Encrypt — no biometric prompt
await vault.protectSecret('wif-key', 'L3p8oAf...', { wallet: 'main' })

// Decrypt — triggers Touch ID
const { plaintext } = await vault.unlockSecret('wif-key')
```

---

## SecureEnclaveProvider

Implements `VaultProvider` from `@1sat/vault`. Communicates with a bundled Swift binary that calls Apple's Security framework directly.

### Constructor

```typescript
import { SecureEnclaveProvider } from '@1sat/wallet-mac'

const provider = new SecureEnclaveProvider({ name: 'My App' })
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `'@1sat/wallet-mac'` | Display name shown in the Touch ID prompt |

### Methods

All methods from the `VaultProvider` interface:

| Method | Description |
|--------|-------------|
| `isSupported()` | Returns `true` on macOS arm64, `false` otherwise |
| `checkAvailability()` | Queries the Secure Enclave and biometry status |
| `generateKey(label)` | Creates a P-256 key pair in the Secure Enclave. Returns the public key |
| `encrypt(label, plaintext)` | Encrypts with ECIES using the key's public component. No biometric prompt |
| `decrypt(label, ciphertext)` | Decrypts via the Secure Enclave private key. Triggers Touch ID |
| `deleteKey(label)` | Removes the key pair from the Secure Enclave |
| `listKeys()` | Lists all key pairs managed by this provider |

---

## Deposit Window

A native macOS window that displays a QR code for receiving funds. The window stays open until the caller signals that a deposit was received or the user closes it.

### `showDepositWindow(address, amountSats?)`

Opens the deposit window and returns a handle.

```typescript
import { showDepositWindow, signalDepositReceived } from '@1sat/wallet-mac'

const deposit = showDepositWindow('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 50_000)

// Later, when you detect the deposit on-chain:
signalDepositReceived(deposit.pid)

const result = await deposit.waitForClose()
// 'funded' if signalDepositReceived was called, 'cancelled' if the user closed the window
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `string` | BSV address to display as a QR code |
| `amountSats` | `number` (optional) | Suggested deposit amount in satoshis |

**Returns:** `{ pid: number; waitForClose(): Promise<'funded' | 'cancelled'> }`

### `signalDepositReceived(pid)`

Sends `SIGUSR1` to the deposit window process, causing it to close with a `'funded'` result.

---

## Platform Utilities

```typescript
import { isMacOS, assertMacOS } from '@1sat/wallet-mac'

isMacOS()     // true on darwin arm64, false otherwise
assertMacOS() // throws if not darwin arm64
```

---

## Platform Requirements

- **macOS** on **Apple Silicon (arm64)** -- Intel Macs are not supported
- **Xcode Command Line Tools** -- the Swift binary auto-compiles on first use if not already built
- **Secure Enclave** -- present on all Apple Silicon Macs
- No code signing or entitlements required

---

## Security Model

- **P-256 ECIES** -- keys are generated inside the Secure Enclave using Apple's `kSecAttrTokenIDSecureEnclave`. Encryption uses the public key component (no biometric gate). Decryption requires the private key, which never leaves the hardware, and triggers Touch ID.
- **Hardware-bound keys** -- the Secure Enclave private key cannot be exported, backed up, or transferred. If you lose the machine, you lose the key.
- **Touch ID for decrypt only** -- encrypting data and listing keys do not prompt for biometrics. Only `decrypt` (and by extension `vault.unlockSecret`) requires Touch ID.
- **File permissions** -- `FileVaultStorage` creates its directory with mode `0o700` and writes entries with mode `0o600`.

---

## Architecture

```
@1sat/vault (interface + factory)
    |
    +-- VaultProvider (interface)
    +-- VaultStorage  (interface)
    +-- FileVaultStorage (filesystem storage)
    +-- createVault()

@1sat/wallet-mac (macOS implementation)
    |
    +-- SecureEnclaveProvider (implements VaultProvider)
    +-- showDepositWindow / signalDepositReceived (native UI)
    +-- swift/enclave (compiled Swift binary)
```

`@1sat/vault` owns the interfaces and factory. `@1sat/wallet-mac` provides the macOS-specific `SecureEnclaveProvider` that talks to a Swift binary for Secure Enclave operations. Other platforms will get their own provider packages.

---

## Non-Portability Warning

Keys created by `SecureEnclaveProvider` are bound to the specific Mac hardware they were generated on. They cannot be exported, synced via iCloud Keychain, or migrated to another machine. If you protect a secret on one Mac, you can only unlock it on that same Mac. Plan your key management accordingly.

---

## License

MIT
