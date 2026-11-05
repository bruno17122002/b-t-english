import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps a crashing page from taking down the whole app; offers a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-lg rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
        <h2 className="font-display text-xl font-semibold">Đã có lỗi hiển thị · Something went wrong</h2>
        <p className="mt-2 text-sm text-muted">{this.state.error.message}</p>
        <button
          className="mt-4 rounded-xl bg-surface-3 px-4 py-2 text-sm font-medium hover:bg-surface-2"
          onClick={() => this.setState({ error: null })}
        >
          Thử lại · Try again
        </button>
      </div>
    )
  }
}
