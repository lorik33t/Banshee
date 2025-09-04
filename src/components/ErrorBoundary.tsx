import React from 'react'

type Props = { children: React.ReactNode }

type State = { hasError: boolean; error?: Error; info?: React.ErrorInfo }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log error for diagnostics
    console.error('UI ErrorBoundary caught error:', error, info)
    this.setState({ info })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
          </pre>
          {this.state.info && (
            <details>
              <summary>Stack trace</summary>
              <pre>{this.state.error?.stack}</pre>
            </details>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
