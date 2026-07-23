import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from './Button';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// A render-time exception anywhere in the tree unmounts the whole app with no
// boundary to catch it, leaving a blank white screen. This is the last line
// of defense, mounted once at the root in main.tsx.
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  // After a deploy, a tab opened on the previous version still references the
  // old hashed chunk files, which no longer exist — lazy route imports then
  // fail (404 / "not a valid JavaScript MIME type"). These signatures cover
  // Chrome, Firefox, and Safari wording for that failure.
  static isStaleChunkError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      msg.includes('dynamically imported module') ||
      msg.includes('is not a valid JavaScript MIME type') ||
      msg.includes('Importing a module script failed')
    );
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    // Stale-deploy chunk failure: one forced reload fetches the new
    // index.html with the current chunk names. The sessionStorage guard
    // stops a reload loop when the failure has a different cause.
    if (ErrorBoundary.isStaleChunkError(error) && sessionStorage.getItem('chunk-reloaded') !== '1') {
      sessionStorage.setItem('chunk-reloaded', '1');
      window.location.reload();
      return;
    }
    console.error('Unhandled error in component tree:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <AlertTriangle size={48} strokeWidth={1.5} />
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please try reloading the page.</p>
          <Button variant="primary" onClick={this.handleReload}>
            <RefreshCw size={16} /> Reload
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
