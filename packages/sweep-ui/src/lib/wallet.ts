import { connectWallet as connect, type ConnectWalletResult } from "@1sat/connect";
import type { WalletInterface } from "@bsv/sdk";

let connection: ConnectWalletResult | null = null;

export async function connectWallet(): Promise<ConnectWalletResult> {
	const result = await connect();
	if (!result) throw new Error("No wallet available");
	connection = result;
	return result;
}

export function getWallet(): WalletInterface | null {
	return connection?.wallet ?? null;
}

export function getIdentityKey(): string | null {
	return connection?.identityKey ?? null;
}

export function getProvider(): string | null {
	return connection?.provider ?? null;
}

export function disconnectWallet(): void {
	connection?.disconnect();
	connection = null;
}

export function isConnected(): boolean {
	return connection !== null;
}
