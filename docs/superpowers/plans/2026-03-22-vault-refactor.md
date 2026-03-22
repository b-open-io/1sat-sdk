# Vault Provider Abstraction + Core Cleanup + Sigma Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a platform-agnostic vault interface from the current macOS-only implementation, move macOS-specific code (Secure Enclave, deposit window) into `wallet-mac`, remove the dead `core` package, and audit sigma-protocol coverage before removing the dependency.

**Architecture:** The vault becomes an interface + types package with zero platform code. Each `wallet-<platform>` package implements `VaultProvider` for its OS. The Swift binary (`se-helper`) is renamed to `enclave` and moves into `wallet-mac`. The `core` package is removed entirely — its js-1sat-ord re-exports are dead code, its template re-exports are unnecessary, and its sigma wrapper uses the old `sigma-protocol` library. The sigma-protocol features (targetVout, sigmaInstance, remoteSign) are audited against existing implementations in `templates` and `actions` to ensure nothing is lost before removing the dependency.

**Tech Stack:** TypeScript, Swift (CryptoKit), Bun, @bsv/sdk

---

## Phase 1: Vault Provider Abstraction

### Task 1: Define VaultProvider and VaultStorage interfaces

**Files:**
- Create: `packages/vault/src/provider.ts`
- Create: `packages/vault/src/storage.ts`
- Modify: `packages/vault/src/types.ts`

- [ ] **Step 1: Write VaultProvider interface**

```typescript
// packages/vault/src/provider.ts

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
```

- [ ] **Step 2: Write VaultStorage interface**

```typescript
// packages/vault/src/storage.ts

import type { VaultEntry, VaultSummary } from './types'

export interface VaultStorage {
  read(label: string): VaultEntry | null
  write(label: string, entry: VaultEntry): void
  remove(label: string): void
  list(): VaultSummary[]
}
```

- [ ] **Step 3: Update types.ts — remove HelperResult (macOS-specific), keep domain types**

Remove `HelperResult` and `SEAvailability` from `types.ts` — these are macOS implementation details. Keep `VaultEntry`, `VaultSummary`, `UnlockResult`, `ProtectResult`, `VaultConfig`.

- [ ] **Step 4: Commit**

```bash
git add packages/vault/src/provider.ts packages/vault/src/storage.ts packages/vault/src/types.ts
git commit -m "feat(vault): define VaultProvider and VaultStorage interfaces"
```

### Task 2: Rewrite vault.ts to accept a provider

**Files:**
- Modify: `packages/vault/src/vault.ts`

- [ ] **Step 1: Rewrite vault.ts as a factory that takes a VaultProvider + VaultStorage**

```typescript
// packages/vault/src/vault.ts

import type { VaultProvider } from './provider'
import type { VaultStorage } from './storage'
import type { ProtectResult, UnlockResult, VaultSummary } from './types'

const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

function validateLabel(label: string): void {
  if (!SAFE_LABEL.test(label)) {
    throw new Error(
      `Invalid label "${label}". Labels must be 1-63 chars, alphanumeric start, then alphanumeric/hyphens/underscores/dots.`
    )
  }
}

export interface Vault {
  protectSecret(label: string, plaintext: string, metadata?: Record<string, string>): Promise<ProtectResult>
  unlockSecret(label: string): Promise<UnlockResult>
  removeSecret(label: string): Promise<void>
  listSecrets(): VaultSummary[]
}

export function createVault(provider: VaultProvider, storage: VaultStorage): Vault {
  return {
    async protectSecret(label, plaintext, metadata) {
      validateLabel(label)
      const { publicKey } = await provider.generateKey(label)
      const ciphertext = await provider.encrypt(label, plaintext)
      storage.write(label, {
        ciphertext,
        metadata,
        publicKey,
        createdAt: new Date().toISOString(),
      })
      return { publicKey }
    },

    async unlockSecret(label) {
      validateLabel(label)
      const entry = storage.read(label)
      if (!entry) throw new Error(`No vault entry for "${label}"`)
      const plaintext = await provider.decrypt(label, entry.ciphertext)
      return { plaintext, metadata: entry.metadata }
    },

    async removeSecret(label) {
      validateLabel(label)
      await provider.deleteKey(label)
      storage.remove(label)
    },

    listSecrets() {
      return storage.list()
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/vault/src/vault.ts
git commit -m "refactor(vault): createVault takes provider + storage instead of hardcoded Secure Enclave"
```

### Task 3: Add FileVaultStorage (shared default for macOS/Linux)

**Files:**
- Create: `packages/vault/src/file-storage.ts`

- [ ] **Step 1: Extract filesystem storage from current vault.ts**

```typescript
// packages/vault/src/file-storage.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { VaultEntry, VaultSummary } from './types'
import type { VaultStorage } from './storage'

export class FileVaultStorage implements VaultStorage {
  constructor(private readonly dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
  }

  private entryPath(label: string): string {
    return resolve(this.dir, `${label}.vault.json`)
  }

  read(label: string): VaultEntry | null {
    const path = this.entryPath(label)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  }

  write(label: string, entry: VaultEntry): void {
    writeFileSync(this.entryPath(label), JSON.stringify(entry, null, '\t'), { mode: 0o600 })
  }

  remove(label: string): void {
    const path = this.entryPath(label)
    if (existsSync(path)) unlinkSync(path)
  }

  list(): VaultSummary[] {
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.vault.json'))
      .map(f => {
        const label = f.replace('.vault.json', '')
        const entry: VaultEntry = JSON.parse(readFileSync(resolve(this.dir, f), 'utf-8'))
        return { label, metadata: entry.metadata, createdAt: entry.createdAt }
      })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/vault/src/file-storage.ts
git commit -m "feat(vault): add FileVaultStorage for filesystem-backed vault entries"
```

### Task 4: Update vault index.ts — export interfaces and factory

**Files:**
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Rewrite index.ts to export the abstract API only**

```typescript
// packages/vault/src/index.ts

// Vault factory
export { createVault, type Vault } from './vault'

// Provider interface (implement per-platform)
export type { VaultProvider, VaultAvailability } from './provider'

// Storage interface + default filesystem implementation
export type { VaultStorage } from './storage'
export { FileVaultStorage } from './file-storage'

// Domain types
export type {
  ProtectResult,
  UnlockResult,
  VaultConfig,
  VaultEntry,
  VaultSummary,
} from './types'
```

- [ ] **Step 2: Remove old files that are now macOS-specific**

Delete `packages/vault/src/enclave.ts` and `packages/vault/src/platform.ts` — these move to `wallet-mac` in Phase 2.

- [ ] **Step 3: Remove `swift/` directory references from package.json files array**

Update `packages/vault/package.json`:
- Remove `"swift/Sources/main.swift"` and `"swift/build.sh"` from `files`
- Remove `"build:swift"` and `"postinstall"` scripts
- Update description to `"Platform-agnostic vault interface for protecting secrets with hardware-backed encryption"`

- [ ] **Step 4: Run build to verify**

```bash
bun run --filter '@1sat/vault' build
```

- [ ] **Step 5: Commit**

```bash
git add packages/vault/
git commit -m "refactor(vault): vault is now a platform-agnostic interface package"
```

---

## Phase 2: Create wallet-mac

### Task 5: Scaffold wallet-mac package

**Files:**
- Create: `packages/wallet-mac/package.json`
- Create: `packages/wallet-mac/tsconfig.json`
- Create: `packages/wallet-mac/src/index.ts`
- Create: `packages/wallet-mac/src/secure-enclave-provider.ts`
- Create: `packages/wallet-mac/src/platform.ts`
- Create: `packages/wallet-mac/src/deposit-window.ts`
- Move: `packages/vault/swift/` → `packages/wallet-mac/swift/`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@1sat/wallet-mac",
  "version": "0.0.1",
  "description": "macOS wallet runtime with Secure Enclave and native UI",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "swift/Sources/main.swift", "swift/build.sh"],
  "scripts": {
    "build": "tsc",
    "build:swift": "./swift/build.sh",
    "postinstall": "./swift/build.sh",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "license": "MIT",
  "dependencies": {
    "@1sat/vault": "workspace:*"
  },
  "peerDependencies": {
    "@bsv/sdk": "^2.0.6"
  },
  "devDependencies": {
    "@bsv/sdk": "^2.0.6",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Move swift/ directory**

```bash
mv packages/vault/swift packages/wallet-mac/swift
```

- [ ] **Step 3: Create platform.ts (moved from vault)**

```typescript
// packages/wallet-mac/src/platform.ts

import { arch, platform } from 'node:os'

export function isMacOS(): boolean {
  return platform() === 'darwin' && arch() === 'arm64'
}

export function assertMacOS(): void {
  const p = platform()
  const a = arch()
  if (p !== 'darwin') {
    throw new Error(`@1sat/wallet-mac requires macOS (current: ${p}).`)
  }
  if (a !== 'arm64') {
    throw new Error(`@1sat/wallet-mac requires Apple Silicon arm64 (current: ${a}).`)
  }
}
```

- [ ] **Step 4: Create secure-enclave-provider.ts — implements VaultProvider**

Move the logic from `enclave.ts` into a class implementing `VaultProvider`. Rename `callHelper` → `callEnclave`, rename the binary reference from `se-helper` → `enclave`. Rename the Swift binary in `swift/build.sh` to output `enclave` instead of `se-helper`.

The `configureVault({ name })` pattern moves here as a constructor option:

```typescript
// packages/wallet-mac/src/secure-enclave-provider.ts

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VaultAvailability, VaultProvider } from '@1sat/vault'
import { assertMacOS, isMacOS } from './platform'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface EnclaveResult {
  success: boolean
  data?: string
  error?: string
  meta?: Record<string, string>
}

export class SecureEnclaveProvider implements VaultProvider {
  readonly platform = 'darwin-arm64'
  private readonly displayName: string

  constructor(options?: { name?: string }) {
    this.displayName = options?.name ?? '@1sat/wallet-mac'
  }

  isSupported(): boolean {
    return isMacOS()
  }

  async checkAvailability(): Promise<VaultAvailability> {
    const r = await this.callEnclave(['check'])
    return {
      supported: r.meta?.secureEnclave === 'true',
      biometryType: (r.meta?.biometryType as VaultAvailability['biometryType']) ?? 'None',
      biometryAvailable: r.meta?.biometryAvailable === 'true',
    }
  }

  async generateKey(label: string): Promise<{ publicKey: string }> {
    const r = await this.callEnclave(['generate', label])
    if (!r.data) throw new Error(`${this.displayName}: no data from generate`)
    return { publicKey: r.data }
  }

  async encrypt(label: string, plaintext: string): Promise<string> {
    const r = await this.callEnclave(['encrypt', label], plaintext)
    if (!r.data) throw new Error(`${this.displayName}: no data from encrypt`)
    return r.data
  }

  async decrypt(label: string, ciphertext: string): Promise<string> {
    const r = await this.callEnclave(['decrypt', label, ciphertext, this.displayName])
    if (!r.data) throw new Error(`${this.displayName}: no data from decrypt`)
    return r.data
  }

  async deleteKey(label: string): Promise<void> {
    await this.callEnclave(['delete', label])
  }

  async listKeys(): Promise<Array<{ label: string; publicKey: string }>> {
    const r = await this.callEnclave(['list'])
    if (!r.data || r.data === '[]') return []
    return JSON.parse(r.data)
  }

  private getEnclavePath(): string {
    return resolve(__dirname, '../swift/enclave')
  }

  private async callEnclave(args: string[], stdin?: string): Promise<EnclaveResult> {
    assertMacOS()
    const enclavePath = this.getEnclavePath()

    if (!existsSync(enclavePath)) {
      const buildScript = resolve(__dirname, '../swift/build.sh')
      if (!existsSync(buildScript)) {
        throw new Error(`${this.displayName}: Secure Enclave bridge not found. Run: cd node_modules/@1sat/wallet-mac && ./swift/build.sh`)
      }
      const build = Bun.spawnSync(['sh', buildScript], {
        cwd: resolve(__dirname, '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (build.exitCode !== 0 || !existsSync(enclavePath)) {
        const err = new TextDecoder().decode(build.stderr)
        throw new Error(`${this.displayName}: Failed to compile Secure Enclave bridge. ${err}`)
      }
    }

    const proc = Bun.spawn([enclavePath, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin ? new Response(stdin) : undefined,
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    if (!stdout.trim()) {
      const hint = stderr ? ` stderr: ${stderr.trim()}` : ''
      throw new Error(`${this.displayName}: bridge produced no output.${hint}`)
    }

    const result: EnclaveResult = JSON.parse(stdout.trim())
    if (!result.success) throw new Error(result.error ?? 'Unknown Secure Enclave error')
    return result
  }
}
```

- [ ] **Step 5: Create deposit-window.ts (moved from enclave.ts)**

```typescript
// packages/wallet-mac/src/deposit-window.ts

import { assertMacOS } from './platform'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function showDepositWindow(
  address: string,
  amountSats?: number,
): { pid: number; waitForClose: () => Promise<'funded' | 'cancelled'> } {
  assertMacOS()
  const enclavePath = resolve(__dirname, '../swift/enclave')
  const args = ['deposit', address]
  if (amountSats != null) args.push(String(amountSats))

  const proc = Bun.spawn([enclavePath, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    pid: proc.pid,
    async waitForClose(): Promise<'funded' | 'cancelled'> {
      const stdout = await new Response(proc.stdout).text()
      await proc.exited
      try {
        const result = JSON.parse(stdout.trim())
        if (result.success && result.data === 'funded') return 'funded'
      } catch {}
      return 'cancelled'
    },
  }
}

export function signalDepositReceived(pid: number): void {
  try {
    process.kill(pid, 'SIGUSR1')
  } catch {}
}
```

- [ ] **Step 6: Create index.ts**

```typescript
// packages/wallet-mac/src/index.ts

export { SecureEnclaveProvider } from './secure-enclave-provider'
export { showDepositWindow, signalDepositReceived } from './deposit-window'
export { isMacOS, assertMacOS } from './platform'
```

- [ ] **Step 7: Rename Swift binary output**

In `packages/wallet-mac/swift/build.sh`, change the output binary name from `se-helper` to `enclave`. Also update the Swift source (`main.swift`) if it references its own name in help text.

- [ ] **Step 8: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Build and verify**

```bash
bun run --filter '@1sat/wallet-mac' build
```

- [ ] **Step 10: Commit**

```bash
git add packages/wallet-mac/
git commit -m "feat: add @1sat/wallet-mac with SecureEnclaveProvider and deposit window"
```

### Task 6: Update vault README

**Files:**
- Modify: `packages/vault/README.md`

- [ ] **Step 1: Rewrite README to reflect the new interface-based architecture**

The README should document:
- The `VaultProvider` and `VaultStorage` interfaces
- `createVault(provider, storage)` factory
- `FileVaultStorage` as the default storage
- Point to `@1sat/wallet-mac` for the macOS implementation
- Include a usage example showing the provider pattern
- Keep the infographic banner

- [ ] **Step 2: Commit**

```bash
git add packages/vault/README.md
git commit -m "docs(vault): update README for provider-based architecture"
```

---

## Phase 3: Remove @1sat/core

### Task 7: Verify core has zero consumers and remove it

**Files:**
- Delete: `packages/core/` (entire directory)
- Modify: root `package.json` workspaces if core is explicitly listed

- [ ] **Step 1: Verify no internal imports**

```bash
cd /Users/satchmo/code/1sat-sdk
# Should return nothing:
grep -r "from '@1sat/core'" packages/ --include='*.ts' | grep -v node_modules | grep -v packages/core/
grep -r '"@1sat/core"' packages/ --include='package.json' | grep -v packages/core/
```

- [ ] **Step 2: Remove the package directory**

```bash
rm -rf packages/core
```

- [ ] **Step 3: Remove js-1sat-ord and sigma-protocol from root if present**

```bash
# Check root package.json for these deps
grep -E 'js-1sat-ord|sigma-protocol' package.json
```

- [ ] **Step 4: Run full build to confirm nothing breaks**

```bash
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead @1sat/core package (js-1sat-ord re-exports, zero consumers)"
```

---

## Phase 4: Sigma Protocol Audit

### Task 8: Audit sigma-protocol feature coverage

The `sigma-protocol` library provides transaction-level signing with granular control. Before removing it, verify that all its capabilities are covered between `@1sat/templates` (Sigma ScriptTemplate) and `@1sat/actions` (applySigma).

**sigma-protocol features to verify:**

| Feature | sigma-protocol | Where it should live | Status |
|---------|---------------|---------------------|--------|
| `targetVout` (sign specific output) | `constructor(tx, targetVout)` | `actions/signing/sigma.ts` — `applySigma` already has `targetVout` param | Verify |
| `sigmaInstance` (multiple sigs per output) | `setSigmaInstance(n)`, `getSigInstanceCount()`, `getSigInstancePosition()` | `templates/bitcom/sigma.ts` — `Sigma.decode()` already parses multiple instances | Verify coverage |
| `refVin` (reference input for hash) | `constructor(tx, vout, instance, refVin)` | `actions/signing/sigma.ts` — `applySigma` already has `refVin` param | Verify |
| `remoteSign(keyHost, authToken)` | Full HTTP POST to remote signer | NOT ported — lives only in `core/sigma/index.ts` | Must port or document removal |
| `sign(privateKey, algorithm, verifier)` | BSM + BRC-77 | `templates/bitcom/sigma.ts` — `Sigma.sign()` supports both | Verify parity |
| `verify(recipientPrivateKey?)` | BSM + BRC-77 | `templates/bitcom/sigma.ts` — `Sigma.verifyWithHashes()` + SigmaIndexer | Verify parity |
| Transaction mutation (apply sig to output) | `_applySignature()` modifies tx output | `actions/signing/sigma.ts` — `applySigma` builds script directly | Verify equivalence |
| Auto hash computation | `setHashes()`, `getInputHash()`, `getDataHash()` | `actions/signing/sigma.ts` — `getInputHash()`, `getDataHash()`, `getMessageHash()` | Verify identical hash computation |

**Files to compare:**
- `packages/actions/src/signing/sigma.ts` — the `applySigma` function
- `packages/actions/test/sigma.test.ts` — existing compatibility tests
- `packages/templates/src/bitcom/sigma.ts` — the Sigma ScriptTemplate
- `packages/wallet/src/indexers/SigmaIndexer.ts` — indexer verification
- `node_modules/sigma-protocol/dist/index.module.js` — original source

- [ ] **Step 1: Run existing sigma compatibility tests**

```bash
bun test packages/actions/test/sigma.test.ts
```

These tests already verify output is "verifiable by sigma-protocol" — confirm they pass.

- [ ] **Step 2: Verify hash computation is identical**

Compare `getInputHash`, `getDataHash`, `getMessageHash` between:
- `sigma-protocol` source (minified in `node_modules/sigma-protocol/dist/index.module.js`)
- `packages/actions/src/signing/sigma.ts`

Both must produce: `SHA256(txidBytes || voutLE)` for input hash, `SHA256(scriptBinary)` for data hash, `SHA256(inputHash || dataHash)` for message hash. Confirm the actions implementation matches.

- [ ] **Step 3: Verify multi-instance support**

The `sigma-protocol` library supports multiple sigma instances per output (`sigmaInstance` parameter) and computes `getDataHash` by slicing the script up to the Nth SIGMA marker. Verify that:
- `SigmaIndexer.parse()` already handles multiple sigmas per output (it does — the loop)
- `Sigma.decode()` in templates handles multiple sigmas (it does — the loop)
- If `applySigma` is called multiple times on the same output, the data hash must be computed against the script *before* the new sigma marker (not the whole script including previous sigmas)

- [ ] **Step 4: Document remoteSign gap**

The `remoteSign` feature (HTTP POST to a key host) exists only in `core/sigma/index.ts` which wraps `sigma-protocol`. Since `core` is being removed and `remoteSign` has zero consumers in the monorepo, document this as a known gap. If remote signing is needed later, it should be a standalone action in `packages/actions/src/signing/` that uses the BRC-100 wallet's `createSignature` (like `applySigma` already does) rather than raw private key HTTP exchange.

- [ ] **Step 5: Remove sigma-protocol dependency from templates**

The only import is `import { Algorithm } from 'sigma-protocol'` in `packages/templates/src/bitcom/sigma.ts`. Replace with a local enum:

```typescript
// Replace: import { Algorithm } from 'sigma-protocol'
// With:
export enum SigmaAlgorithm {
  BSM = 'BSM',
  BRC77 = 'BRC77',
}
```

Update all references from `Algorithm` to `SigmaAlgorithm` within the file. Update the re-export in `templates/src/index.ts`.

- [ ] **Step 6: Remove sigma-protocol from package.json files**

```bash
# templates
cd packages/templates && grep -n 'sigma-protocol' package.json
# cli
cd packages/cli && grep -n 'sigma-protocol' package.json
```

Remove from `dependencies`, `peerDependencies`, `optionalDependencies`, and `devDependencies` in both.

- [ ] **Step 7: Run full build + tests**

```bash
bun run build
bun test
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove sigma-protocol dependency, inline Algorithm enum"
```

---

## Phase 5: Validation

### Task 9: Full repo validation

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules bun.lock
bun install
```

- [ ] **Step 2: Build all packages**

```bash
bun run build
```

- [ ] **Step 3: Lint**

```bash
bun run lint
```

- [ ] **Step 4: Run tests**

```bash
bun test
```

- [ ] **Step 5: Verify dependency graph is clean**

Confirm no package depends on `@1sat/core`, `js-1sat-ord`, or `sigma-protocol`:

```bash
grep -r 'js-1sat-ord\|sigma-protocol\|@1sat/core' packages/ --include='package.json' | grep -v node_modules
```

- [ ] **Step 6: Final commit if any fixups needed**

---

## Future Platform Providers (not implemented now)

For reference when implementing other platforms:

### Linux — `@1sat/wallet-linux`

**Backend options:**
- **libsecret** (GNOME Keyring / KDE KWallet) via D-Bus — most universal
- **TPM 2.0** via `tpm2-tools` — hardware-bound like Secure Enclave but not biometric
- **pass** (GPG-based) — common among developers

The `VaultProvider` interface already supports this — implement `encrypt`/`decrypt`/`generateKey` using whichever backend, biometryType returns `'None'` unless fingerprint readers are configured.

### Windows — `@1sat/wallet-windows`

**Backend options:**
- **DPAPI** (Data Protection API) — user-bound encryption, no hardware requirement
- **Windows Hello** (TPM 2.0 + biometrics) — closest to Secure Enclave
- **Credential Manager** — simpler key-value store

biometryType returns `'WindowsHello'` when available.

### Key design constraints for all providers:
- `VaultProvider` implementations must be self-contained (no cross-platform imports)
- `FileVaultStorage` works on all POSIX systems; Windows may need a `RegistryVaultStorage`
- The vault interface (`@1sat/vault`) stays dependency-free and platform-free
