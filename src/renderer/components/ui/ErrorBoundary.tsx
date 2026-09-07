// 魔导书 Grimoire v7 — 错误边界
import React, { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from './Button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    // Log to main process
    try {
      window.api?.error?.log(error.message, error.stack || '', errorInfo.componentStack || '')
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-[var(--color-bg-primary)] p-8 text-[var(--color-text-primary)]">
          <div className="ui-dialog-surface max-w-lg p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 text-[var(--color-danger)]" size={28} aria-hidden='true' />
            <h1 className="mb-3 text-xl font-semibold">应用出错</h1>
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{this.state.error?.message}</p>
            <pre className="mb-4 max-h-40 overflow-auto rounded bg-[var(--color-bg-primary)] p-3 text-left text-xs text-[var(--color-text-secondary)]">
              {this.state.error?.stack?.slice(0, 500)}
            </pre>
            <div className="flex justify-center gap-2"><Button variant="primary" icon={RotateCcw} onClick={() => this.setState({ hasError: false, error: null })}>重试</Button><Button icon={RefreshCw} onClick={() => window.location.reload()}>重新加载</Button></div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
