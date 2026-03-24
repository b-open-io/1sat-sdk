import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './rpc'
import App from './App'
import { ErrorBoundary } from './error-boundary'

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
)
