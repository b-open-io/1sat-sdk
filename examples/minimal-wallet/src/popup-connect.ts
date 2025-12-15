/**
 * Connect approval popup script
 */
import './popup' // Load popup utilities

async function init() {
	const { getApprovalData, sendApprovalResponse } = window.popup

	const data = await getApprovalData<{ origin?: string }>()
	if (!data) {
		document.getElementById('origin')!.textContent = 'Unknown'
		return
	}

	document.getElementById('origin')!.textContent =
		data.params?.origin || 'Unknown'

	document.getElementById('approve')!.addEventListener('click', () => {
		sendApprovalResponse(data.requestId, true)
	})

	document.getElementById('reject')!.addEventListener('click', () => {
		sendApprovalResponse(data.requestId, false)
	})
}

init()
