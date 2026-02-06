'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './button';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in component tree, displays fallback UI,
 * and logs error information for debugging.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary onError={(error) => console.error(error)}>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to error reporting service
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Call custom error handler
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error boundary when resetKey changes
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="flex items-center justify-center min-h-[400px] px-4">
          <div className="text-center space-y-4 max-w-md">
            <div className="flex justify-center">
              <div className="p-3 rounded-full bg-error/10">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
            </div>

            <h2 className="text-xl font-semibold text-foreground">
              Something went wrong
            </h2>

            <p className="text-tertiary">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>

            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button variant="ghost" onClick={() => (window.location.href = '/')}>
                Go Home
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left mt-4">
                <summary className="cursor-pointer text-sm text-tertiary">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-error/5 p-3 rounded overflow-auto max-h-40">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based Error Boundary wrapper (for convenience)
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.ComponentType<P> {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
