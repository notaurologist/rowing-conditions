import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// The root error boundary. A render error shows a message and a reload button instead of
// a blank page. Saved data is in localStorage, so reloading loses nothing.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <h1>Something went wrong</h1>
        <p>The page hit an error and stopped. Your saved locations and rule sets are kept.</p>
        <pre className="error-detail">{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
