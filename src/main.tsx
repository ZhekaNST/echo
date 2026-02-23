// Buffer polyfill for Solana libraries (must be before any imports)
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

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

function renderFatalBootError(message: string) {
  const root = document.getElementById('root')
  if (!root) return

  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:white;padding:24px;font-family:Inter,system-ui,sans-serif;">
      <div style="max-width:720px;text-align:center;line-height:1.5;">
        <h1 style="font-size:28px;margin:0 0 12px;">App failed to start</h1>
        <p style="opacity:.8;margin:0 0 16px;">The app crashed while loading. Open DevTools Console to see details.</p>
        <pre style="text-align:left;white-space:pre-wrap;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;opacity:.95;">${message}</pre>
      </div>
    </div>
  `
}

function installGlobalCrashHandlers() {
  if (typeof window === 'undefined') return

  const renderFromUnknown = (err: unknown) => {
    const message =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string'
          ? err
          : JSON.stringify(err)
    renderFatalBootError(message)
  }

  window.addEventListener('error', (event) => {
    renderFromUnknown(event.error || event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    renderFromUnknown(event.reason)
  })
}

async function bootstrap() {
  try {
    installGlobalCrashHandlers()
    normalizeHashRoute()

    const rootEl = document.getElementById('root')
    if (!rootEl) {
      throw new Error('Root element #root not found')
    }

    const root = createRoot(rootEl)
    const mod = await import('./App.tsx')
    const App = mod.default

    root.render(
      <StrictMode>
        <div className="app-shell">
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </div>
      </StrictMode>,
    )
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error('Fatal boot error:', error)
    renderFatalBootError(message)
  }
}

bootstrap()
