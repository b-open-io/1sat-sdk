'use client'

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react'
import { ConnectDialog, type ConnectDialogRenderProps } from './ConnectDialog'
import { useWallet } from './wallet-context'

interface ConnectDialogContextValue {
	openConnectDialog: () => void
}

const ConnectDialogCtx = createContext<ConnectDialogContextValue | null>(null)

/**
 * Hook to open the connect wallet dialog from any component.
 */
export function useConnectDialog(): ConnectDialogContextValue {
	const ctx = useContext(ConnectDialogCtx)
	if (!ctx) {
		throw new Error(
			'useConnectDialog must be used within ConnectDialogProvider',
		)
	}
	return ctx
}

export interface ConnectDialogProviderProps {
	children: ReactNode
	/** Custom render for the dialog content */
	renderDialog?: (props: ConnectDialogRenderProps) => ReactNode
}

/**
 * Provides the connect dialog and useConnectDialog() hook to the app.
 *
 * Place inside WalletProvider. Login buttons call openConnectDialog()
 * to show the provider selector.
 */
export function ConnectDialogProvider({
	children,
	renderDialog,
}: ConnectDialogProviderProps) {
	const { status } = useWallet()
	const [open, setOpen] = useState(false)

	// Auto-open when wallet status becomes 'selecting' (auto-detect found nothing)
	useEffect(() => {
		if (status === 'selecting') {
			setOpen(true)
		}
	}, [status])

	const openConnectDialog = useCallback(() => {
		setOpen(true)
	}, [])

	return (
		<ConnectDialogCtx.Provider value={{ openConnectDialog }}>
			{children}
			<ConnectDialog open={open} onOpenChange={setOpen}>
				{renderDialog}
			</ConnectDialog>
		</ConnectDialogCtx.Provider>
	)
}
