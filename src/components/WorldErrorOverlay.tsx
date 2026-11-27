import { useLanguage } from '../i18n/i18n';

export interface WorldErrorOverlayProps {
  message: string;
  onRetry: () => void;
  onNewMap: () => void;
}

export function WorldErrorOverlay({ message, onRetry, onNewMap }: WorldErrorOverlayProps) {
  const { t } = useLanguage();

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="world-error-title"
      data-testid="world-error-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060907]/90 p-6"
    >
      <div className="w-full max-w-md rounded-lg bg-[#101813] border border-[#b96b5c]/45 p-7 shadow-[0_22px_54px_rgba(0,0,0,0.75)]">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#e09d8e]">
          {t('worldError.eyebrow')}
        </div>
        <h2
          id="world-error-title"
          className="mt-1.5 font-display text-2xl text-[#f3ede6] tracking-wide"
        >
          {t('worldError.title')}
        </h2>
        <p className="mt-2.5 text-sm text-[#c4d0c2] leading-relaxed">
          {t('worldError.desc')}
        </p>
        <div className="mt-4 rounded bg-[#0a100c] border border-white/10 px-3.5 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#8fa28e]">
            {t('worldError.detailsLabel')}
          </div>
          <p
            data-testid="world-error-message"
            className="mt-1 font-mono text-xs text-[#ecc4ba] break-words"
          >
            {message}
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            data-testid="world-error-retry"
            onClick={onRetry}
            className="flex-1 min-w-[10rem] py-2.5 px-4 text-sm font-semibold rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] transition-colors cursor-pointer"
          >
            {t('worldError.retry')}
          </button>
          <button
            type="button"
            data-testid="world-error-new-map"
            onClick={onNewMap}
            className="py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
          >
            {t('worldError.newMap')}
          </button>
        </div>
      </div>
    </div>
  );
}
