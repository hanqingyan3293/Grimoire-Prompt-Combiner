// 魔导书 Grimoire v7 — 错误边界
import React, { Component, ReactNode } from 'react'

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
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white p-8">
          <div className="max-w-lg text-center">
            <h1 className="text-2xl font-bold text-red-400 mb-4">应用出错</h1>
            <p className="text-gray-400 mb-2">{this.state.error?.message}</p>
            <pre className="text-xs text-gray-500 bg-gray-800 p-3 rounded overflow-auto max-h-40 mb-4 text-left">
              {this.state.error?.stack?.slice(0, 500)}
            </pre>
            <button
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </button>
            <button
              className="px-4 py-2 ml-2 bg-gray-700 text-white rounded hover:bg-gray-600"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
