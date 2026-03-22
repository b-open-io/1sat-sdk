#!/bin/sh
# Build the Secure Enclave helper binary.
# Exits 0 on non-macOS so CI installs don't break.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$SCRIPT_DIR/enclave"
SOURCE="$SCRIPT_DIR/Sources/main.swift"

# Skip on non-macOS (Linux CI, etc.)
if [ "$(uname -s)" != "Darwin" ]; then
	echo "@1sat/wallet-mac: Skipping Swift build (not macOS). Secure Enclave unavailable on this platform."
	exit 0
fi

# Check for swiftc
if ! command -v swiftc >/dev/null 2>&1; then
	echo "@1sat/wallet-mac: swiftc not found. Install Xcode Command Line Tools: xcode-select --install"
	exit 1
fi

# Compile (no signing or entitlements needed for CryptoKit SE)
swiftc -O -parse-as-library -o "$OUTPUT" "$SOURCE" -framework CryptoKit -framework LocalAuthentication
echo "@1sat/wallet-mac: Built enclave at $OUTPUT"
