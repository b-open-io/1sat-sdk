/**
 * Sign message approval popup script
 */
import './popup' // Load popup utilities

async function init() {
	const { getApprovalData, sendApprovalResponse } = window.popup

	const data = await getApprovalData<{ origin?: string; message?: string }>()
	if (!data) {
		document.getElementById('origin')!.textContent = 'Unknown'
		document.getElementById('message')!.textContent = 'Unknown'
		return
	}

	document.getElementById('origin')!.textContent =
		data.params?.origin || 'Unknown'
	document.getElementById('message')!.textContent = data.params?.message || ''

	document.getElementById('approve')!.addEventListener('click', () => {
		sendApprovalResponse(data.requestId, true)
	})

	document.getElementById('reject')!.addEventListener('click', () => {
		sendApprovalResponse(data.requestId, false)
	})
}

init()
