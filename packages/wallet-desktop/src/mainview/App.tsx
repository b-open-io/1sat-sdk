import { BigBlocksProvider } from '@/components/blocks/bigblocks-provider'
import { PermissionApproval } from '@/components/blocks/permission-approval'
import { onPermissionRequest, rpc } from './rpc'
import { BrowserLayout } from './components/layout/browser-layout'
import { useWallet } from './hooks/use-wallet'

function App() {
	const { status } = useWallet()

	return (
		<BigBlocksProvider>
			<BrowserLayout walletStatus={status} />
			<PermissionApproval
				subscribe={onPermissionRequest}
				resolve={(params) => rpc.request.resolvePermission(params)}
			/>
		</BigBlocksProvider>
	)
}

export default App
