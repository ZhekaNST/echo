// Buffer polyfill for Solana libraries (must be before any imports)
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function normalizeHashRoute() {
  if (typeof window === 'undefined') return

  const hash = window.location.hash || ''
  if (!hash) {
    window.location.hash = '/'
    return
  }

  const route = hash.slice(1)
  if (!route.startsWith('/')) {
    window.location.hash = `/${route.replace(/^\/+/, '')}`
  }
}

type BoundaryState = { hasError: boolean }

class AppErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('App crashed during render:', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen w-screen bg-[#020617] text-white flex items-center justify-center px-6">
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-white/70">The app hit a runtime error. Click Home to recover.</p>
          <button
            type="button"
            onClick={() => {
              window.location.hash = '/'
              window.location.reload()
            }}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500"
          >
            Go Home
          </button>
        </div>
      </div>
    )
  }
}

normalizeHashRoute()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-shell">
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </div>
  </StrictMode>,
)
