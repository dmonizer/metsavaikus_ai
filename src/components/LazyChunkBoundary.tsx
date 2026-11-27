import React from 'react';
import { t } from '../i18n/i18n';

export interface LazyLoaderHandle<TProps> {
  Component: React.FC<TProps>;
  reset: () => void;
}

/**
 * Wraps React.lazy with a resettable loader so chunk load failures can genuinely
 * re-attempt the dynamic import when the user retries.
 */
export function makeLazyComponent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TComponent extends React.ComponentType<any>,
>(
  loader: () => Promise<{ default: TComponent }>
): LazyLoaderHandle<React.ComponentProps<TComponent>> {
  let LazyTarget = React.lazy(loader);
  const Component: React.FC<React.ComponentProps<TComponent>> = (props) => {
    const Target = LazyTarget as React.ComponentType<React.ComponentProps<TComponent>>;
    return <Target {...props} />;
  };
  return {
    Component,
    reset: () => {
      LazyTarget = React.lazy(loader);
    },
  };
}

interface LazyChunkBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
  onRetry?: () => void;
  onClose?: () => void;
  testId?: string;
}

interface LazyChunkBoundaryState {
  error: Error | null;
}

export class LazyChunkBoundary extends React.Component<
  LazyChunkBoundaryProps,
  LazyChunkBoundaryState
> {
  state: LazyChunkBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LazyChunkBoundaryState {
    return { error };
  }

  private handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alertdialog"
          aria-modal="true"
          data-testid={this.props.testId ?? 'lazy-chunk-error'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#060907]/82 p-6"
        >
          <div className="w-full max-w-sm rounded-lg bg-[#101813] border border-[#b96b5c]/45 p-6 shadow-[0_18px_46px_rgba(0,0,0,0.72)]">
            <p className="text-sm font-medium text-[#f2eae3]">{t('lazy.loadFailed')}</p>
            <p className="mt-1.5 font-mono text-xs text-[#e0a89b] break-words">
              {this.state.error.message}
            </p>
            <div className="mt-4 flex items-center gap-2.5">
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-4 py-2 text-xs font-semibold rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] cursor-pointer"
              >
                {t('lazy.retry')}
              </button>
              {this.props.onClose && (
                <button
                  type="button"
                  onClick={this.props.onClose}
                  className="px-4 py-2 text-xs font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 cursor-pointer"
                >
                  {t('lazy.close')}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return <React.Suspense fallback={this.props.fallback}>{this.props.children}</React.Suspense>;
  }
}

export const LazyOverlayLoadingFallback: React.FC<{ label?: string }> = ({ label }) => (
  <div
    role="status"
    aria-live="polite"
    data-testid="lazy-overlay-loading"
    className="fixed inset-0 z-40 flex items-center justify-center bg-[#070b09]/55 pointer-events-auto"
  >
    <div className="rounded-md bg-[#0e1611]/95 border border-white/14 px-4 py-2.5 text-xs font-medium tracking-wide text-[#dbe6d9] shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
      {label ?? t('lazy.loading')}
    </div>
  </div>
);
