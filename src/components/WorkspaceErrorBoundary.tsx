/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
  sectionLabel?: string;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export default class WorkspaceErrorBoundary extends React.Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[WorkspaceErrorBoundary] Caught render error:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps: WorkspaceErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-rose-500/35 bg-slate-950/90 text-slate-100 p-8 max-w-xl mx-auto my-8 shadow-2xl space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-500/35 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-base font-bold text-white tracking-tight">
                {this.props.sectionLabel ? `${this.props.sectionLabel} encountered an error` : 'This module encountered an unexpected error'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                The rest of the workspace and navigation remain active. You can retry loading this view or reload the page.
              </p>
              {this.state.errorMessage && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-rose-300 break-words">
                  {this.state.errorMessage}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry View</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
