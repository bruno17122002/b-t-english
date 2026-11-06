import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { toApiError } from './lib/api'
import { useApp } from './lib/store'
import './styles.css'

// Safety net: a failed action that a component forgot to catch shows an error toast instead of failing
// silently. It is still logged as an error so the E2E suites catch the missing handler.
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  const err = toApiError(e.reason)
  // db_closed: a backup is being restored and the app is about to restart – nothing to report.
  if (err.code === 'db_closed') return
  console.error('Unhandled rejection:', err.message)
  if ((e.reason as Error | undefined)?.name !== 'AbortError')
    useApp.getState().toast({ kind: 'error', title: err.message.slice(0, 300) })
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
