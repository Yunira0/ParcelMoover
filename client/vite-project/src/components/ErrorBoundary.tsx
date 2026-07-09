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

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
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
