import { useCallback } from 'react'
import {
	InscribeFile,
	type InscribeParams,
	type InscribeResult,
} from '@/components/blocks/inscribe-file'
import { rpc } from '../../rpc'

export function InscribeView() {
	const handleInscribe = useCallback(
		async (params: InscribeParams): Promise<InscribeResult> => {
			if (params.type === 'file') {
				if (!params.base64Content) {
					return { error: 'No file content provided' }
				}
				try {
					const res = await rpc.request.inscribeFile({
						base64Content: params.base64Content,
						contentType: params.contentType,
						map:
							Object.keys(params.map).length > 0
								? params.map
								: undefined,
					})
					return res
				} catch (err) {
					return {
						error:
							err instanceof Error
								? err.message
								: 'Inscription failed',
					}
				}
			}

			// BSV20/BSV21 inscription types not yet supported via desktop RPC
			return { error: `${params.type} inscriptions are not yet supported in the desktop wallet` }
		},
		[],
	)

	return (
		<div className="p-6 max-w-2xl">
			<InscribeFile
				onInscribe={handleInscribe}
				onSuccess={(result) => {
					console.log('Inscription created:', result.txid)
				}}
			/>
		</div>
	)
}
