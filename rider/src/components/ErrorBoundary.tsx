import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import Button from './Button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

// A render-time exception anywhere in the tree unmounts the whole app with no
// boundary to catch it, leaving a blank white screen. This is the last line
// of defense, mounted once at the root in main.tsx.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error('Unhandled error in component tree:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col flex-1 items-center justify-center gap-4 px-6 text-center bg-bg min-h-dvh">
          <AlertTriangle size={48} strokeWidth={1.5} className="text-error" />
          <h1 className="text-xl font-bold text-text-primary">Something went wrong</h1>
          <p className="text-sm text-text-secondary">
            An unexpected error occurred. Please try reloading the app.
          </p>
          <Button size="md" className="w-auto px-8" onClick={this.handleReload}>
            <RefreshCw size={16} /> Reload
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
